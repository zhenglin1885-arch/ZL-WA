import { configureWhatsAppVoice } from '../src/features/accounts/voice';

describe('native WhatsApp voice upload preparation', () => {
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let page: any;
  let native: any;
  let module: any;
  beforeEach(() => {
    native = jest.fn(function nativePreparation(this: unknown, ...args: any[]) {
      return { receiver: this, args };
    });
    module = { prepRawMedia: native };
    page = {
      require: jest.fn((name: string) =>
        name === 'WAWebPrepRawMedia' ? module : undefined,
      ),
    };
    for (const [name, value] of Object.entries({
      window: page,
      location: { hostname: 'web.whatsapp.com' },
    })) {
      globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    globals.clear();
  });
  it.each([
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg; codecs=opus',
    'audio/wav',
    'audio/webm',
  ])(
    'prepares %s as PTT while retaining other options and the native return value',
    mime => {
      expect(configureWhatsAppVoice()).toBe(true);
      const data = { type: () => mime };
      const options = Object.freeze({
        isPtt: false,
        filename: '录音',
        isViewOnce: true,
        precomputedFields: { waveform: [1, 2] },
      });
      const result = module.prepRawMedia(data, options, 'extra');
      expect(result.receiver).toBe(module);
      expect(result.args).toEqual([
        data,
        { ...options, isPtt: true, isAudio: true },
        'extra',
      ]);
      expect(native).toHaveBeenCalledTimes(1);
      expect(options.isPtt).toBe(false);
    },
  );
  it.each([
    [{ type: () => 'image/jpeg' }, {}],
    [{ type: () => 'video/mp4' }, {}],
    [{ type: () => 'application/pdf' }, {}],
    [{ type: () => 'audio/mp4' }, { asDocument: true }],
    [{ type: () => 'audio/ogg' }, { isPtt: true }],
    [{ type: () => 'audio/mpeg' }, { asSticker: true }],
  ])(
    'preserves native preparation for other media and already recorded voice',
    (data, options) => {
      configureWhatsAppVoice();
      const result = module.prepRawMedia(data, options);
      expect(result.args[0]).toBe(data);
      expect(result.args[1]).toBe(options);
      expect(native).toHaveBeenCalledTimes(1);
    },
  );
  it('supports native isAudio detection for an untyped Blob without guessing other attachments', () => {
    configureWhatsAppVoice();
    expect(
      module.prepRawMedia(
        { type: 'application/octet-stream' },
        { isAudio: true },
      ).args[1].isPtt,
    ).toBe(true);
    expect(module.prepRawMedia({ type: '' }).args[1]).toBeUndefined();
  });
  it('does not stack wrappers across polls and repairs a replaced native export', () => {
    configureWhatsAppVoice();
    const wrapped = module.prepRawMedia;
    configureWhatsAppVoice();
    expect(module.prepRawMedia).toBe(wrapped);
    module.prepRawMedia({ type: 'audio/mpeg' });
    expect(native).toHaveBeenCalledTimes(1);
    const replacement = jest.fn();
    module.prepRawMedia = replacement;
    expect(configureWhatsAppVoice()).toBe(true);
    module.prepRawMedia({ type: 'audio/ogg' });
    expect(replacement).toHaveBeenCalledWith(
      { type: 'audio/ogg' },
      { isPtt: true, isAudio: true },
    );
  });
  it('retries after modules load and supports the older media preparation export', () => {
    page.require = () => {};
    expect(configureWhatsAppVoice()).toBe(false);
    page.require = (name: string) =>
      name === 'WAWebMediaPrep' ? module : undefined;
    expect(configureWhatsAppVoice()).toBe(true);
  });
  it('leaves a locked export intact and exposes the unavailable state', () => {
    Object.freeze(module);
    expect(configureWhatsAppVoice()).toBe(false);
    expect(module.prepRawMedia).toBe(native);
    expect(page.__zlVoiceMessages.ready).toBe(false);
  });
  it('preserves native errors and does not attempt a second send or preparation', () => {
    const failure = new Error('Audio decoding failed');
    native.mockImplementation(() => {
      throw failure;
    });
    configureWhatsAppVoice();
    expect(() => module.prepRawMedia({ type: 'audio/mpeg' })).toThrow(failure);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('does not install on other services', () => {
    (globalThis.location as any).hostname = 'example.com';
    expect(configureWhatsAppVoice()).toBe(false);
    expect(page.require).not.toHaveBeenCalled();
  });
});
