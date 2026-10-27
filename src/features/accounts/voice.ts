/* eslint-disable no-continue -- Skip unavailable native media modules and already installed adapters. */
// Serialized guest adapter: let WhatsApp prepare uploaded audio as native PTT.
export function configureWhatsAppVoice(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  page.__zlVoiceMessages ??= {
    revision: 1,
    wrappers: new WeakSet(),
    ready: false,
  };
  const state = page.__zlVoiceMessages;
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Keep the factory inside the serialized guest function.
  const wrap = (original: any) =>
    function prepareVoice(this: unknown, ...args: any[]) {
      const [data, options] = args;
      let mime = '';
      try {
        mime = String(
          typeof data?.type === 'function' ? data.type() : data?.type || '',
        );
      } catch {
        // Unknown media must retain its native preparation and error handling.
      }
      if (
        !options?.asDocument &&
        !options?.asSticker &&
        !options?.asGif &&
        !options?.isPtt &&
        (mime.startsWith('audio/') ||
          (options?.isAudio === true &&
            (!mime || mime === 'application/octet-stream')))
      )
        return Reflect.apply(original, this, [
          data,
          { ...options, isPtt: true, isAudio: true },
          ...args.slice(2),
        ]);
      return Reflect.apply(original, this, args);
    };
  let ready = false;
  for (const name of ['WAWebPrepRawMedia', 'WAWebMediaPrep']) {
    let module: any;
    let original: any;
    try {
      module = page.require?.(name);
      original = module?.prepRawMedia;
    } catch {
      continue;
    }
    if (typeof original !== 'function') continue;
    if (state.wrappers.has(original)) {
      ready = true;
      continue;
    }
    const wrapped = wrap(original);
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        module,
        'prepRawMedia',
      );
      if (descriptor?.configurable)
        Object.defineProperty(module, 'prepRawMedia', {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: true,
          value: wrapped,
        });
      else if (!Reflect.set(module, 'prepRawMedia', wrapped)) continue;
      if (module.prepRawMedia === wrapped) {
        state.wrappers.add(wrapped);
        ready = true;
      }
    } catch {
      // Retry on later account polls if this WhatsApp build replaces exports.
    }
  }
  state.ready = ready;
  return ready;
}
