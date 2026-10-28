import {
  defaultTools,
  parseProxy,
  proxyRules,
  proxyNeedsReload,
} from '../src/features/accountTools/config';
import {
  listRecipients,
  sendTextToChat,
} from '../src/features/accountTools/guest';

describe('per-account proxy configuration', () => {
  it('reloads after password-only edits, including clearing a saved password, but not translation-only changes', () => {
    const proxy = { ...defaultTools().proxy, hasPassword: true };
    expect(
      proxyNeedsReload(
        proxy,
        { ...proxy },
        { ...proxy, password: 'new-secret' },
      ),
    ).toBe(true);
    expect(
      proxyNeedsReload(proxy, { ...proxy }, { ...proxy, password: '' }),
    ).toBe(true);
    expect(proxyNeedsReload(proxy, { ...proxy }, { ...proxy })).toBe(false);
    expect(proxyNeedsReload(proxy, { ...proxy, host: 'new.test' }, proxy)).toBe(
      true,
    );
  });
  it('disabling a proxy follows the system network without validating unused manual fields', () => {
    expect(proxyRules(defaultTools().proxy)).toEqual({ mode: 'system' });
    expect(
      proxyRules({ ...defaultTools().proxy, enabled: true, mode: 'system' }),
    ).toEqual({ mode: 'system' });
  });
  it.each(['http', 'https', 'socks5'] as const)(
    'creates explicit %s rules',
    protocol => {
      expect(
        proxyRules({
          ...defaultTools().proxy,
          enabled: true,
          host: '127.0.0.1',
          port: '8080',
          protocol,
        }),
      ).toMatchObject({ proxyRules: `${protocol}://127.0.0.1:8080` });
    },
  );
  it.each(['0', '65536', '80abc', '-1', ''])(
    'rejects invalid port %s',
    port => {
      expect(() =>
        proxyRules({
          ...defaultTools().proxy,
          enabled: true,
          host: 'localhost',
          port,
        }),
      ).toThrow();
    },
  );
  it('rejects injected rules and accepts bridge-supported authenticated SOCKS5', () => {
    expect(() =>
      proxyRules({
        ...defaultTools().proxy,
        enabled: true,
        host: 'evil;direct://',
        port: '80',
      }),
    ).toThrow();
    expect(() =>
      proxyRules({
        ...defaultTools().proxy,
        enabled: true,
        host: 'localhost',
        port: '1080',
        protocol: 'socks5',
        username: 'test',
      }),
    ).not.toThrow();
  });
  it('parses credentials, IPv6 and URL encoded passwords without losing colons', () => {
    expect(parseProxy('localhost:8080:user:pass:extra')).toMatchObject({
      host: 'localhost',
      port: '8080',
      username: 'user',
      password: 'pass:extra',
    });
    expect(parseProxy('[::1]:8080')).toMatchObject({
      host: '[::1]',
      port: '8080',
    });
    expect(parseProxy('http://host.test:80')).toMatchObject({ port: '80' });
    expect(parseProxy('http://user:p%40ss@host.test:8080')).toMatchObject({
      protocol: 'http',
      password: 'p@ss',
    });
    expect(() => parseProxy('not-a-proxy')).toThrow();
  });
});

describe('WhatsApp recipient/send adapter (synthetic modules, no real messages)', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let modules: Record<string, any>;
  let chat: any;
  let submit: jest.Mock;
  beforeEach(() => {
    chat = {
      id: { _serialized: '123@g.us', server: 'g.us', user: '123' },
      name: 'Test group',
    };
    class MsgKey {
      static newId = async () => 'synthetic-key';

      _serialized = 'synthetic-key';

      constructor(public fields: any) {}
    }
    submit = jest.fn(() => [Promise.resolve({}), Promise.resolve('success')]);
    modules = {
      WAWebCollections: {
        Chat: {
          getModelsArray: () => [chat, { id: { server: 'newsletter' } }],
          get: (id: string) => (id === chat.id._serialized ? chat : undefined),
        },
      },
      WAWebSocketModel: { Socket: { state: 'CONNECTED' } },
      WAWebUserPrefsMeUser: {
        getMaybeMePnUser: () => 'me-pn',
        getMaybeMeLidUser: () => 'me-lid',
      },
      WAWebMsgKey: MsgKey,
      WAWebWidFactory: { asUserWidOrThrow: (id: string) => id },
      WAWebGetEphemeralFieldsMsgActionsUtils: {
        getEphemeralFields: () => ({ ephemeralDuration: 60 }),
      },
      WAWebSendMsgChatAction: { addAndSendMsgToChat: submit },
    };
    for (const [key, value] of Object.entries({
      location: { hostname: 'web.whatsapp.com' },
      window: {
        require: (name: string) => {
          if (!modules[name]) throw new Error('unsupported');
          return modules[name];
        },
      },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('lists only writable groups/private chats actually loaded in this account', () => {
    expect(listRecipients()).toEqual([
      {
        id: '123@g.us',
        name: 'Test group',
        group: true,
        archived: false,
        contact: false,
      },
    ]);
    chat.isReadOnly = true;
    expect(listRecipients()).toEqual([]);
  });
  it('keeps native message IDs when MsgKey exposes toString instead of _serialized', async () => {
    modules.WAWebMsgKey = Object.assign(
      jest.fn(() => ({ toString: () => 'true_123@g.us_native-key' })),
      { newId: async () => 'native-key' },
    );
    expect(await sendTextToChat('123@g.us', 'hello')).toEqual({
      messageId: 'true_123@g.us_native-key',
      confirmed: true,
    });
  });
  it('does not report success without a recoverable message ID even after acceptance', async () => {
    modules.WAWebMsgKey = Object.assign(jest.fn(), {
      newId: async () => 'native-key',
    });
    expect(await sendTextToChat('123@g.us', 'hello')).toMatchObject({
      messageId: '',
      confirmed: false,
      error: expect.stringContaining('未取得消息编号'),
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('submits a text payload and waits for server acceptance', async () => {
    expect(await sendTextToChat('123@g.us', 'hello')).toEqual({
      messageId: 'synthetic-key',
      confirmed: true,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1]).toMatchObject({
      body: 'hello',
      type: 'chat',
      from: 'me-pn',
      ephemeralDuration: 60,
    });
  });
  it.each(['OK', { messageSendResult: 'OK' }])(
    'recognizes current WhatsApp acceptance result %p',
    async result => {
      submit.mockReturnValue([Promise.resolve({}), Promise.resolve(result)]);
      expect(await sendTextToChat('123@g.us', 'hello')).toEqual({
        messageId: 'synthetic-key',
        confirmed: true,
      });
    },
  );
  it('preserves the allocated message ID when the acceptance promise rejects after dispatch', async () => {
    submit.mockReturnValue([
      Promise.resolve({}),
      Promise.reject(new Error('receipt lost')),
    ]);
    expect(await sendTextToChat('123@g.us', 'hello')).toMatchObject({
      messageId: 'synthetic-key',
      confirmed: false,
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('keeps the allocated message ID when waiting for a receipt times out', async () => {
    jest.useFakeTimers();
    try {
      submit.mockReturnValue([Promise.resolve({}), new Promise(() => {})]);
      const request = sendTextToChat('123@g.us', 'hello');
      await jest.advanceTimersByTimeAsync(30_001);
      expect(await request).toMatchObject({
        messageId: 'synthetic-key',
        confirmed: false,
        timedOut: true,
      });
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('uses the correct sender for LID-addressed groups', async () => {
    chat.groupMetadata = { isLidAddressingMode: true };
    await sendTextToChat('123@g.us', 'hello');
    expect(submit.mock.calls[0][1]).toMatchObject({ from: 'me-lid' });
  });
  it('never reports a failed/unknown server result as success or retries it', async () => {
    submit.mockReturnValue([Promise.resolve({}), Promise.resolve('unknown')]);
    expect(await sendTextToChat('123@g.us', 'hello')).toMatchObject({
      messageId: 'synthetic-key',
      confirmed: false,
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('rejects offline, read-only, unknown recipient and empty text before sending', async () => {
    await expect(sendTextToChat('other@g.us', 'hello')).rejects.toThrow();
    await expect(sendTextToChat('123@g.us', '')).rejects.toThrow();
    chat.isReadOnly = true;
    await expect(sendTextToChat('123@g.us', 'hello')).rejects.toThrow();
    chat.isReadOnly = false;
    modules.WAWebSocketModel.Socket.state = 'UNPAIRED';
    await expect(sendTextToChat('123@g.us', 'hello')).rejects.toThrow('未连接');
    expect(submit).not.toHaveBeenCalled();
  });
  it('does not execute adapter operations on another origin', async () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'example.com' },
    });
    expect(() => listRecipients()).toThrow('不是 WhatsApp');
    await expect(sendTextToChat('123@g.us', 'hello')).rejects.toThrow(
      '不是 WhatsApp',
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
