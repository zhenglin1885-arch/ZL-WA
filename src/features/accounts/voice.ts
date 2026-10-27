/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest adapters keep their helpers local. */
// The native upload UI can override preparation flags at send time. Convert
// through native PTT preparation and validate the final media before dispatch.
export function configureWhatsAppVoice(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  const previous = page.__zlVoiceMessages;
  if (previous?.revision !== 3) {
    if (previous?.capture && typeof document !== 'undefined')
      for (const event of ['pointerdown', 'click', 'keydown'])
        document.removeEventListener(event, previous.capture, true);
    page.__zlVoiceMessages = {
      revision: 3,
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
  const optional = (read: () => any) => {
    try {
      return read();
    } catch {
      // Optional lazy WA-JS exports can throw before their modules are ready.
      return null;
    }
  };
  const prepare =
    module('WAWebPrepRawMedia')?.prepRawMedia ||
    native?.prepRawMedia ||
    optional(() => page.WPP?.whatsapp?.functions?.prepRawMedia);
  const prototype = [
    native?.MediaPrep,
    native?.default,
    optional(() => page.WPP?.whatsapp?.MediaPrep),
  ]
    .map(value => value?.prototype)
    .find(value => typeof value?.sendToChat === 'function');
  const original = prototype?.sendToChat;
  if (typeof prepare !== 'function' || typeof original !== 'function') {
    state.ready = false;
    state.unavailable =
      typeof prepare === 'function'
        ? 'send-interface'
        : 'preparation-interface';
    return false;
  }
  if (state.wrappers.has(original)) {
    state.ready = true;
    state.unavailable = null;
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
      (initial?.type && !['audio', 'ptt'].includes(initial.type)) ||
      (initial?.type === 'ptt' &&
        options.type !== 'audio' &&
        options.productMsgOptions?.type !== 'audio')
    )
      return Reflect.apply(original, this, args);
    let voiceTask = ['audio', 'ptt'].includes(initial?.type);
    if (voiceTask)
      state.last = { stage: 'preparing', sourceType: initial.type };
    let retained: any;
    const retain = (data: any) => {
      if (
        !retained &&
        typeof data?.retain === 'function' &&
        typeof data?.autoreleaseWhenPromiseCompletes === 'function'
      ) {
        data.retain();
        retained = data;
      }
    };
    retain(initial?.mediaBlob);
    const sending = (async () => {
      // waitForPrep() is the public native contract. Internal fields are
      // optional and may not exist at all on a real Audio upload instance.
      const source = (await this.waitForPrep()) || mediaOf(this);
      if (voiceTask && !['audio', 'ptt'].includes(source?.type))
        throw new Error('音频准备状态已变化，未发送');
      if (
        !['audio', 'ptt'].includes(source?.type) ||
        (source.type === 'ptt' &&
          options.type !== 'audio' &&
          options.productMsgOptions?.type !== 'audio')
      )
        return Reflect.apply(original, this, args);
      voiceTask = true;
      state.last = { stage: 'preparing', sourceType: source.type };
      const opaque = source.mediaBlob;
      retain(opaque);
      const fields = await waveformOf(source);
      // isAudio belongs to ordinary audio uploads. Do not propagate it into
      // the native voice-note encoder, or the result can remain type=audio.
      const voice =
        source.type === 'audio'
          ? prepare(opaque, {
              isPtt: true,
              precomputedFields: fields,
            })
          : this;
      const prepared = (await voice.waitForPrep()) || mediaOf(voice);
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
      if (voiceTask)
        state.last = {
          ...state.last,
          stage: 'failed',
          error: String(error?.message || error).slice(0, 240),
        };
      throw error;
    });
    // The upload preview can close while decoding. Keep its native data alive
    // until preparation and the one original dispatch have settled.
    // The data may become available only after waitForPrep resolves.
    return sending.finally(() => {
      retained?.autoreleaseWhenPromiseCompletes(Promise.resolve());
    });
  };
  // WA-JS chooses its modern/legacy call signature using this arity.
  Object.defineProperty(wrapped, 'length', { value: original.length });
  try {
    if (!Reflect.set(prototype, 'sendToChat', wrapped)) {
      state.unavailable = 'locked-send-interface';
      return false;
    }
    state.wrappers.add(wrapped);
    state.ready = prototype.sendToChat === wrapped;
    state.unavailable = state.ready ? null : 'locked-send-interface';
  } catch {
    state.ready = false;
    state.unavailable = 'locked-send-interface';
  }
  return state.ready;
}
