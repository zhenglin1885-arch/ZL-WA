/* eslint-disable no-continue -- Skip non-audio and offscreen message nodes. */
// Serialized into the account webview. No credentials or privileged IPC here.
export interface VoiceTranslationJob {
  id: string;
  token: string;
}
export function voiceTranslationTick(
  enabled: boolean,
  signature: string,
  drain = true,
): VoiceTranslationJob[] {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return [];
  const page = window as any;
  let state = page.__zlVoiceTranslation;
  if (!state) {
    state = {
      token: crypto.randomUUID(),
      records: new Map(),
      queue: [],
      enabled,
      signature,
    };
    page.__zlVoiceTranslation = state;
  }
  if (state.signature !== signature || !enabled) {
    for (const record of state.records.values()) record.container.remove();
    state.records.clear();
    state.queue = [];
    state.token = crypto.randomUUID();
  }
  state.signature = signature;
  state.enabled = enabled;
  const chat = page.__zlTranslation?.chatKey?.() || '';
  for (const [id, record] of state.records) {
    if (
      !record.bubble.isConnected ||
      record.chat !== chat ||
      record.bubble.dataset.id !== id
    ) {
      record.container.remove();
      state.records.delete(id);
    }
  }
  if (!enabled || !chat) return [];
  for (const bubble of document.querySelectorAll<HTMLElement>(
    '#main [data-id]',
  )) {
    const id = bubble.dataset.id || '';
    const identity = id.match(/^(?:true|false)_([^_]+)_/);
    if (
      !identity ||
      identity[1] !== chat ||
      state.records.has(id) ||
      !bubble.querySelector(
        'audio, [data-testid="audio-play"], [data-testid="ptt-play"], [data-icon="audio-play"], [data-icon="ptt-play"], [data-icon="audio-download"], [data-icon="ptt-download"], [data-testid="audio-player"], [data-testid="ptt-message"]',
      )
    )
      continue;
    const rect = bubble.getBoundingClientRect();
    if (!rect.height || rect.bottom < 0 || rect.top > window.innerHeight + 80)
      continue;
    const container = document.createElement('div');
    container.dataset.zlVoiceTranslation = 'true';
    container.style.cssText =
      'clear:both;max-width:100%;padding:5px 8px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 sans-serif';
    const label = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '语音翻译';
    button.title =
      '点击将这条音频提交给 Google Cloud 语音识别（可能产生费用），再按接收翻译设置翻译；最长 10 分钟';
    button.style.cssText =
      'border:0;border-radius:5px;background:#175aff;color:white;padding:5px 9px;cursor:pointer';
    container.append(label, button);
    // Append inside this exact message, never to the conversation or its quote.
    const record = {
      bubble,
      container,
      label,
      button,
      chat,
      pending: false,
      transcript: '',
    };
    state.records.set(id, record);
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]) {
      button.addEventListener(
        type,
        event => {
          event.stopImmediatePropagation();
          if (type !== 'click') return;
          event.preventDefault();
          if (
            record.pending ||
            !state.enabled ||
            page.__zlTranslation?.chatKey?.() !== chat ||
            state.records.get(id) !== record
          )
            return;
          if ([...state.records.values()].some((item: any) => item.pending)) {
            page.__zlTranslation?.notice?.('正在处理另一条语音，请稍候');
            return;
          }
          record.pending = true;
          button.disabled = true;
          button.textContent = '语音识别中…';
          state.queue.push({ id, token: state.token });
        },
        true,
      );
    }
    const mount =
      bubble.querySelector<HTMLElement>('[data-testid="msg-container"]') ||
      bubble;
    if (page.__zlTranslation?.withScroll)
      page.__zlTranslation.withScroll(bubble, () => mount.append(container));
    else mount.append(container);
  }
  return drain ? state.queue.splice(0) : [];
}
export async function readVoiceTranslationAudio(
  job: VoiceTranslationJob,
): Promise<{ audio?: string; transcript?: string }> {
  const page = window as any;
  const state = page.__zlVoiceTranslation;
  const record = state?.records.get(job.id);
  let expired = false;
  const valid = () =>
    !expired &&
    state === page.__zlVoiceTranslation &&
    state?.enabled &&
    state.token === job.token &&
    record?.pending &&
    record.bubble.isConnected &&
    record.bubble.dataset.id === job.id &&
    page.__zlTranslation?.chatKey?.() === record.chat;
  if (!valid()) throw new Error('聊天或语音已变化，请重新选择');
  if (record.transcript) return { transcript: record.transcript };
  if (!page.WPP?.isReady || !page.WPP.chat?.downloadMedia)
    throw new Error('语音读取接口未就绪，请稍后重试');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let context: AudioContext | undefined;
  try {
    return await Promise.race([
      (async () => {
        const message = await page.WPP.chat.getMessageById(job.id);
        const id =
          typeof message?.id === 'string'
            ? message.id
            : message?.id?._serialized;
        if (id !== job.id || !['audio', 'ptt'].includes(message?.type))
          throw new Error('该消息不是可读取的语音');
        if (!valid()) throw new Error('聊天或语音已变化，请重新选择');
        const blob = await page.WPP.chat.downloadMedia(job.id);
        if (!valid()) throw new Error('聊天或语音已变化，请重新选择');
        if (
          !(blob instanceof Blob) ||
          blob.size === 0 ||
          blob.size > 20_000_000
        )
          throw new Error('语音为空或超过 20 MB');
        context = new AudioContext();
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        if (!valid()) throw new Error('聊天或语音已变化，请重新选择');
        if (
          !audio.numberOfChannels ||
          !Number.isFinite(audio.duration) ||
          audio.duration <= 0 ||
          audio.duration > 600
        )
          throw new Error('语音须在 10 分钟以内');
        // Decode OGG/Opus as well as ordinary uploads, then send supported PCM WAV.
        const length = Math.floor(audio.duration * 16_000);
        const offline = new OfflineAudioContext(1, length, 16_000);
        const source = offline.createBufferSource();
        source.buffer = audio;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        const pcm = rendered.getChannelData(0);
        if (!valid()) throw new Error('聊天或语音已变化，请重新选择');
        const wav = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(wav);
        const word = (offset: number, text: string) => {
          for (let i = 0; i < text.length; i += 1)
            view.setUint8(offset + i, text.codePointAt(i)!);
        };
        word(0, 'RIFF');
        view.setUint32(4, wav.byteLength - 8, true);
        word(8, 'WAVEfmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 16_000, true);
        view.setUint32(28, 32_000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        word(36, 'data');
        view.setUint32(40, pcm.length * 2, true);
        for (const [i, element] of pcm.entries()) {
          const sample = Math.max(-1, Math.min(1, element));
          view.setInt16(
            44 + i * 2,
            sample < 0 ? sample * 32_768 : sample * 32_767,
            true,
          );
        }
        let binary = '';
        const bytes = new Uint8Array(wav);
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCodePoint(
            ...bytes.subarray(offset, offset + 8192),
          );
        return { audio: btoa(binary) };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('读取语音超时，请点击重试')),
          30_000,
        );
      }),
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
    await context?.close();
  }
}
export function voiceTranslationResult(
  job: VoiceTranslationJob,
  result: {
    text?: string;
    transcript?: string;
    error?: boolean;
    message?: string;
  },
): boolean {
  const page = window as any;
  const state = page.__zlVoiceTranslation;
  const record = state?.records.get(job.id);
  if (
    !state?.enabled ||
    state.token !== job.token ||
    !record?.pending ||
    !record.bubble.isConnected ||
    record.bubble.dataset.id !== job.id ||
    page.__zlTranslation?.chatKey?.() !== record.chat
  )
    return false;
  record.pending = false;
  if (result.transcript) record.transcript = result.transcript;
  record.button.disabled = false;
  record.button.textContent = result.error ? '重试语音翻译' : '再次翻译';
  const text = result.error
    ? result.message || '语音翻译失败，请重试'
    : `原文：${record.transcript}\n译文：${result.text || ''}`;
  const render = () => {
    record.label.textContent = text;
  };
  if (page.__zlTranslation?.withScroll)
    page.__zlTranslation.withScroll(record.bubble, render);
  else render();
  return true;
}

export function voiceTranslationCurrent(job: VoiceTranslationJob): boolean {
  const page = window as any;
  const state = page.__zlVoiceTranslation;
  const record = state?.records.get(job.id);
  return Boolean(
    state?.enabled &&
      state.token === job.token &&
      record?.pending &&
      record.bubble.isConnected &&
      record.bubble.dataset.id === job.id &&
      page.__zlTranslation?.chatKey?.() === record.chat,
  );
}
