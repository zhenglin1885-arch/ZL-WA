/* eslint-disable max-classes-per-file -- Fresh native media and audio decoder fixtures per test. */
import { configureWhatsAppVoice } from '../src/features/accounts/voice';

describe('final native WhatsApp voice preparation and dispatch', () => {
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let page: any;
  let NativePrep: any;
  let prepare: jest.Mock;
  let dispatch: jest.Mock;
  let decode: jest.Mock;
  let blob: any;
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Fixture factory stays beside its isolated decoder and native classes.
  const model = (type: string, mediaBlob: any) => ({
    type,
    mediaBlob,
    set(fields: any) {
      Object.assign(this, fields);
    },
  });
  beforeEach(() => {
    dispatch = jest.fn((media, params) => ({
      type: params.options?.type || media.type,
      media,
      params,
    }));
    NativePrep = class NativeMediaPrep {
      _mediaData: any;

      constructor(media: any) {
        this._mediaData = media;
      }

      async waitForPrep() {
        return this._mediaData;
      }

      async sendToChat(params: any) {
        return dispatch(this._mediaData, params);
      }
    };
    prepare = jest.fn(
      (data, options) =>
        new NativePrep({
          ...model(options.isPtt && !options.isAudio ? 'ptt' : 'audio', data),
          ...options.precomputedFields,
        }),
    );
    const exports = Object.freeze({ prepRawMedia: prepare });
    const mediaExports = Object.freeze({ MediaPrep: NativePrep });
    page = {
      require: jest.fn((name: string) =>
        name === 'WAWebPrepRawMedia'
          ? exports
          : name === 'WAWebMediaPrep'
            ? mediaExports
            : undefined,
      ),
    };
    decode = jest.fn(async () => ({
      duration: 3.25,
      getChannelData: () =>
        Float32Array.from({ length: 256 }, (_v, i) => (i % 32) / 32),
    }));
    blob = { forceToBlob: () => new Blob(['encoded source audio']) };
    class Decoder {
      decodeAudioData = decode;
    }
    for (const [key, value] of Object.entries({
      window: page,
      location: { hostname: 'web.whatsapp.com' },
      OfflineAudioContext: Decoder,
    })) {
      globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    globals.clear();
  });
  it('converts the native Audio upload at final dispatch despite immutable module exports and explicit audio overrides', async () => {
    expect(configureWhatsAppVoice()).toBe(true);
    const source = model('audio', blob);
    const upload = new NativePrep(source);
    const quote = { id: 'quoted-message' };
    const raw = Object.freeze({ type: 'audio', id: 'outgoing-id' });
    const options = Object.freeze({
      type: 'audio',
      quotedMsg: quote,
      productMsgOptions: raw,
      mentionedJidList: ['member'],
      isViewOnce: true,
    });
    const result = await upload.sendToChat({
      chat: { id: 'group@g.us' },
      options,
    });
    expect(result.type).toBe('ptt');
    expect(result.media.type).toBe('ptt');
    expect(result.media.waveform).toBeInstanceOf(Uint8Array);
    expect(result.media.waveform).toHaveLength(64);
    expect(Math.max(...result.media.waveform)).toBe(100);
    expect(new Set(result.media.waveform).size).toBeGreaterThan(1);
    expect(result.media.duration).toBe(3);
    expect(result.params.options).toEqual({
      ...options,
      type: 'ptt',
      productMsgOptions: { ...raw, type: 'ptt' },
    });
    expect(result.params.options.quotedMsg).toBe(quote);
    expect(prepare.mock.calls[0][1]).not.toHaveProperty('isAudio');
    expect(prepare.mock.calls[0][1].isPtt).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(source.type).toBe('audio');
    expect(options.type).toBe('audio');
  });
  it('retains native audio data while the preview closes during asynchronous preparation', async () => {
    configureWhatsAppVoice();
    let held = 0;
    const nativeBlob = {
      ...blob,
      retain: jest.fn(() => {
        held += 1;
      }),
      autoreleaseWhenPromiseCompletes: jest.fn((task: Promise<unknown>) => {
        return task.then(
          () => {
            held -= 1;
          },
          () => {
            held -= 1;
          },
        );
      }),
      forceToBlob: () => {
        if (!held) throw new Error('Released audio');
        return new Blob(['native bytes']);
      },
    };
    const result = await new NativePrep(model('audio', nativeBlob)).sendToChat({
      chat: 'chat',
    });
    expect(result.type).toBe('ptt');
    expect(nativeBlob.retain).toHaveBeenCalledTimes(1);
    expect(nativeBlob.autoreleaseWhenPromiseCompletes).toHaveBeenCalledTimes(1);
    expect(held).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('preserves the modern native send signature length used by WA-JS', () => {
    const arity = NativePrep.prototype.sendToChat.length;
    configureWhatsAppVoice();
    expect(NativePrep.prototype.sendToChat.length).toBe(arity);
  });
  it('preserves legacy two-argument sends including quotes', async () => {
    NativePrep.prototype.sendToChat = async function legacy(
      chat: any,
      options: any,
    ) {
      return dispatch(this._mediaData, { chat, options });
    };
    configureWhatsAppVoice();
    expect(NativePrep.prototype.sendToChat.length).toBe(2);
    const result = await new NativePrep(model('audio', blob)).sendToChat(
      'group@g.us',
      { type: 'audio', quotedMsg: 'quote' },
    );
    expect(result.params).toEqual({
      chat: 'group@g.us',
      options: { type: 'ptt', quotedMsg: 'quote' },
    });
    expect(result.type).toBe('ptt');
  });
  it.each(['image', 'video', 'document', 'ptt'])(
    'retains native %s sends without decoding or converting',
    async type => {
      configureWhatsAppVoice();
      const source = model(type, blob);
      const result = await new NativePrep(source).sendToChat({
        chat: 'chat',
        options: { type },
      });
      expect(result.media).toBe(source);
      expect(prepare).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps an explicit document upload as a document even when its media mime is audio', async () => {
    configureWhatsAppVoice();
    const source = model('audio', blob);
    const result = await new NativePrep(source).sendToChat({
      chat: 'chat',
      options: { type: 'document' },
    });
    expect(result.type).toBe('document');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('repairs a PTT prepared by bulk/reply adapters when final options override it to audio', async () => {
    configureWhatsAppVoice();
    const result = await new NativePrep(model('ptt', blob)).sendToChat({
      chat: 'chat',
      options: { type: 'audio', quotedMsg: 'quote' },
    });
    expect(result.type).toBe('ptt');
    expect(result.media.waveform).toHaveLength(64);
    expect(result.params.options.quotedMsg).toBe('quote');
    expect(prepare).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('stops instead of sending ordinary audio if the native voice encoder does not produce PTT', async () => {
    configureWhatsAppVoice();
    prepare.mockImplementation(() => new NativePrep(model('audio', blob)));
    await expect(
      new NativePrep(model('audio', blob)).sendToChat({
        chat: 'chat',
        options: { type: 'audio' },
      }),
    ).rejects.toThrow('PTT');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('stops on decoding failure without retry or ordinary-audio fallback', async () => {
    configureWhatsAppVoice();
    decode.mockRejectedValue(new Error('Unsupported codec'));
    await expect(
      new NativePrep(model('audio', blob)).sendToChat({ chat: 'chat' }),
    ).rejects.toThrow('Unsupported codec');
    expect(dispatch).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('preserves real silence as 64 zero samples without non-finite waveform values', async () => {
    configureWhatsAppVoice();
    decode.mockResolvedValue({
      duration: 2,
      getChannelData: () => new Float32Array(256),
    });
    const result = await new NativePrep(model('audio', blob)).sendToChat({
      chat: 'chat',
    });
    expect([...result.media.waveform]).toEqual(
      Array.from({ length: 64 }).fill(0),
    );
    expect(result.media.duration).toBe(2);
  });
  it('includes audible stereo channels when the first channel is silent', async () => {
    configureWhatsAppVoice();
    decode.mockResolvedValue({
      duration: 2,
      numberOfChannels: 2,
      getChannelData: (index: number) =>
        index
          ? Float32Array.from({ length: 256 }, (_v, i) => (i % 32) / 32)
          : new Float32Array(256),
    });
    const result = await new NativePrep(model('audio', blob)).sendToChat({
      chat: 'chat',
    });
    expect(Math.max(...result.media.waveform)).toBe(100);
    expect(new Set(result.media.waveform).size).toBeGreaterThan(1);
  });
  it('does not stack wrappers after repeated polls or a live upgrade from revision one', async () => {
    page.__zlVoiceMessages = {
      revision: 1,
      wrappers: new WeakSet(),
      ready: true,
    };
    configureWhatsAppVoice();
    const wrapped = NativePrep.prototype.sendToChat;
    configureWhatsAppVoice();
    expect(NativePrep.prototype.sendToChat).toBe(wrapped);
    await new NativePrep(model('audio', blob)).sendToChat({ chat: 'chat' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(page.__zlVoiceMessages.revision).toBe(2);
  });
  it('retries installation when the native modules become available', () => {
    const { require } = page;
    page.require = () => {};
    expect(configureWhatsAppVoice()).toBe(false);
    page.require = require;
    expect(configureWhatsAppVoice()).toBe(true);
  });
  it('does not alter locked native methods or other services', () => {
    Object.freeze(NativePrep.prototype);
    expect(configureWhatsAppVoice()).toBe(false);
    (globalThis.location as any).hostname = 'example.com';
    page.require.mockClear();
    expect(configureWhatsAppVoice()).toBe(false);
    expect(page.require).not.toHaveBeenCalled();
  });
});
