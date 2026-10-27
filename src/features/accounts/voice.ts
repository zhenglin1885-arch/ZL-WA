/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest adapters keep their helpers local. */
// The native upload UI can override preparation flags at send time. Convert
// through native PTT preparation and validate the final media before dispatch.
export function configureWhatsAppVoice(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  const previous = page.__zlVoiceMessages;
  if (previous?.revision !== 2) {
    if (previous?.capture && typeof document !== 'undefined')
      for (const event of ['pointerdown', 'click', 'keydown'])
        document.removeEventListener(event, previous.capture, true);
    page.__zlVoiceMessages = {
      revision: 2,
      wrappers: new WeakSet(),
      ready: false,
    };
  }
  const state = page.__zlVoiceMessages;
  // Media modules can load only after the Audio picker opens. Retry before
  // native send handlers run, rather than waiting for the next account poll.
  if (!state.capture && typeof document !== 'undefined') {
    state.capture = () => configureWhatsAppVoice();
    for (const event of ['pointerdown', 'click', 'keydown'])
      document.addEventListener(event, state.capture, true);
  }
  const module = (name: string) => {
    try {
      return page.require?.(name);
    } catch {
      return null;
    }
  };
  const native = module('WAWebMediaPrep');
  const prepare =
    module('WAWebPrepRawMedia')?.prepRawMedia || native?.prepRawMedia;
  const prototype = (native?.MediaPrep || page.WPP?.whatsapp?.MediaPrep)
    ?.prototype;
  const original = prototype?.sendToChat;
  if (typeof prepare !== 'function' || typeof original !== 'function') {
    state.ready = false;
    return false;
  }
  if (state.wrappers.has(original)) {
    state.ready = true;
    return true;
  }
  state.ready = false;
  const mediaOf = (prep: any) => prep?._mediaData || prep?.mediaData;
  const waveformOf = async (media: any) => {
    const opaque = media?.mediaBlob;
    const blob =
      opaque instanceof Blob ? opaque : await opaque?.forceToBlob?.();
    if (!(blob instanceof Blob))
      throw new Error('无法读取上传音频，未发送普通音频');
    const decoder = new OfflineAudioContext(1, 1, 48_000);
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0)
      throw new Error('音频时长无效，未发送');
    const channels = Array.from(
      { length: decoded.numberOfChannels || 1 },
      (_value, index) => decoded.getChannelData(index),
    );
    const samples = channels[0];
    const values = Array.from({ length: 64 }, (_value, index) => {
      const start = Math.floor((index * samples.length) / 64);
      const end = Math.floor(((index + 1) * samples.length) / 64);
      let total = 0;
      for (const channel of channels)
        for (let i = start; i < end; i += 1) total += Math.abs(channel[i]);
      return total / Math.max(1, (end - start) * channels.length);
    });
    const peak = Math.max(...values);
    return {
      duration: Math.floor(decoded.duration),
      waveform: Uint8Array.from(values, value =>
        peak ? Math.round((value / peak) * 100) : 0,
      ),
    };
  };
  const wrapped = function sendVoice(this: any, ...args: any[]) {
    const modern = args.length === 1 && args[0] && 'chat' in args[0];
    const options = (modern ? args[0].options : args[1]) || {};
    const initial = mediaOf(this);
    if (
      options.type === 'document' ||
      !['audio', 'ptt'].includes(initial?.type) ||
      (initial.type === 'ptt' &&
        options.type !== 'audio' &&
        options.productMsgOptions?.type !== 'audio')
    )
      return Reflect.apply(original, this, args);
    state.last = { stage: 'preparing', sourceType: initial.type };
    const opaque = initial.mediaBlob;
    const retained =
      typeof opaque?.retain === 'function' &&
      typeof opaque?.autoreleaseWhenPromiseCompletes === 'function';
    if (retained) opaque.retain();
    const sending = (async () => {
      await this.waitForPrep();
      const source = mediaOf(this);
      if (!['audio', 'ptt'].includes(source?.type))
        throw new Error('音频准备状态已变化，未发送');
      const fields = await waveformOf({ mediaBlob: opaque });
      // isAudio belongs to ordinary audio uploads. Do not propagate it into
      // the native voice-note encoder, or the result can remain type=audio.
      const voice =
        source.type === 'audio'
          ? prepare(opaque, {
              isPtt: true,
              precomputedFields: fields,
            })
          : this;
      if (voice !== this) await voice.waitForPrep();
      const prepared = mediaOf(voice);
      if (prepared?.type !== 'ptt')
        throw new Error('未能生成 PTT 语音消息，已停止发送');
      if (typeof prepared.set === 'function') prepared.set(fields);
      else Object.assign(prepared, fields);
      const { waveform } = prepared;
      if (
        !waveform ||
        waveform.length !== 64 ||
        ![...waveform].every(
          value =>
            Number.isFinite(value) &&
            Number(value) >= 0 &&
            Number(value) <= 100,
        )
      )
        throw new Error('未能生成语音波形，已停止发送');
      const sendOptions = {
        ...options,
        type: 'ptt',
        ...(options.productMsgOptions
          ? { productMsgOptions: { ...options.productMsgOptions, type: 'ptt' } }
          : {}),
      };
      const sendArgs = modern
        ? [{ ...args[0], options: sendOptions }]
        : [args[0], sendOptions, ...args.slice(2)];
      state.last = {
        stage: 'sending',
        sourceType: source.type,
        preparedType: prepared.type,
        finalType: sendOptions.type,
        waveformSamples: waveform.length,
        duration: fields.duration,
      };
      const result = await Reflect.apply(original, voice, sendArgs);
      state.last = { ...state.last, stage: 'submitted' };
      return result;
    })().catch(error => {
      state.last = {
        ...state.last,
        stage: 'failed',
        error: String(error?.message || error).slice(0, 240),
      };
      throw error;
    });
    // The upload preview can close while decoding. Keep its native data alive
    // until preparation and the one original dispatch have settled.
    if (retained) opaque.autoreleaseWhenPromiseCompletes(sending);
    return sending;
  };
  // WA-JS chooses its modern/legacy call signature using this arity.
  Object.defineProperty(wrapped, 'length', { value: original.length });
  try {
    if (!Reflect.set(prototype, 'sendToChat', wrapped)) return false;
    state.wrappers.add(wrapped);
    state.ready = prototype.sendToChat === wrapped;
  } catch {
    state.ready = false;
  }
  return state.ready;
}
