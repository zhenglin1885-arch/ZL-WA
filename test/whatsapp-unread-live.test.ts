import { watchWhatsAppUnread } from '../src/features/accounts/unread';

describe('live WhatsApp unread signals', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let chats: any[];
  let listeners: Map<string, () => void>;
  let page: any;
  let collection: any;
  beforeEach(() => {
    listeners = new Map();
    chats = [{ id: { _serialized: '10001@g.us' }, unreadCount: 1 }];
    collection = {
      getModelsArray: () => chats,
      on: jest.fn((name, fn) => listeners.set(name, fn)),
      off: jest.fn((name, fn) => {
        if (listeners.get(name) === fn) listeners.delete(name);
      }),
    };
    page = {
      ferdium: { pushWhatsAppUnread: jest.fn() },
      addEventListener: jest.fn(),
      require: name =>
        ({
          WAWebCollections: { Chat: collection },
          WAWebUserPrefsMeUser: {
            getMaybeMePnUser: () => '8613800000001@c.us',
          },
          WAWebSocketModel: { Socket: { state: 'CONNECTED' } },
        })[name],
    };
    for (const [key, value] of Object.entries({
      window: page,
      location: { hostname: 'web.whatsapp.com' },
      document: {
        querySelector: (selector: string) =>
          selector === '#pane-side, #side, #main' ? {} : null,
      },
      setInterval: jest.fn(() => 123),
      clearInterval: jest.fn(),
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    page.__zlWaUnread?.dispose();
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('keeps a new message candidate when its unread event arrives after the message event', () => {
    chats[0].unreadCount = 0;
    watchWhatsAppUnread();
    chats[0].lastMessage = {
      id: { _serialized: 'ordered', fromMe: false },
      t: Date.now() / 1000,
    };
    page.__zlWaUnread.tick();
    chats[0].unreadCount = 1;
    page.__zlWaUnread.tick();
    expect(page.ferdium.pushWhatsAppUnread.mock.calls.at(-1)[0].notify).toBe(
      true,
    );
  });

  it('signals fresh incoming messages once, without startup backlog, muted chats or resume sounds', () => {
    const now = Date.now() / 1000;
    chats[0].lastMessage = {
      id: { _serialized: 'old', fromMe: false },
      t: now,
    };
    watchWhatsAppUnread();
    expect(
      page.ferdium.pushWhatsAppUnread.mock.calls.at(-1)[0].notify,
    ).toBeUndefined();
    chats[0].lastMessage = {
      id: { _serialized: 'new', fromMe: false },
      t: now,
    };
    page.__zlWaUnread.tick();
    expect(page.ferdium.pushWhatsAppUnread.mock.calls.at(-1)[0].notify).toBe(
      true,
    );
    const count = page.ferdium.pushWhatsAppUnread.mock.calls.length;
    page.__zlWaUnread.tick();
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenCalledTimes(count);
    chats[0].isMuted = true;
    chats[0].lastMessage = {
      id: { _serialized: 'muted', fromMe: false },
      t: now,
    };
    page.__zlWaUnread.tick();
    expect(
      page.ferdium.pushWhatsAppUnread.mock.calls.at(-1)[0].notify,
    ).toBeUndefined();
    chats[0].isMuted = false;
    chats[0].lastMessage = {
      id: { _serialized: 'resume', fromMe: false },
      t: now,
    };
    page.__zlWaUnread.soundAt -= 60;
    page.__zlWaUnread.tick();
    expect(
      page.ferdium.pushWhatsAppUnread.mock.calls.at(-1)[0].notify,
    ).toBeUndefined();
  });

  it('pushes a changed message total in the same event turn without polling or profile/avatar work', async () => {
    expect(watchWhatsAppUnread()).toBe(true);
    chats[0].unreadCount = 9;
    listeners.get('change:unreadCount')!();
    await Promise.resolve();
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenLastCalledWith({
      ownerId: '8613800000001@c.us',
      count: 9,
    });
  });
  it('coalesces burst events, clears read messages and respects mute/archive/PSA rules', async () => {
    watchWhatsAppUnread();
    chats.push(
      { id: { server: 'c.us' }, unreadCount: 5, muteExpiration: -1 },
      { id: { server: 'g.us' }, unreadCount: 10, archive: true },
      { id: { server: 'c.us' }, unreadCount: 20, isPSA: true },
    );
    chats[0].unreadCount = 0;
    listeners.get('change:unreadCount')!();
    listeners.get('add')!();
    await Promise.resolve();
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenLastCalledWith({
      ownerId: '8613800000001@c.us',
      count: 0,
    });
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenCalledTimes(2);
  });
  it('counts a manually marked unread chat as one reminder and clears it when read', async () => {
    chats[0].unreadCount = 0;
    watchWhatsAppUnread();
    chats[0].unreadCount = -1;
    listeners.get('change:unreadCount')!();
    await Promise.resolve();
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenLastCalledWith({
      ownerId: '8613800000001@c.us',
      count: 1,
    });
    chats[0].unreadCount = 0;
    listeners.get('change:unreadCount')!();
    await Promise.resolve();
    expect(page.ferdium.pushWhatsAppUnread).toHaveBeenLastCalledWith({
      ownerId: '8613800000001@c.us',
      count: 0,
    });
  });
  it('does not install duplicate subscriptions and removes them on page disposal', () => {
    watchWhatsAppUnread();
    watchWhatsAppUnread();
    expect(collection.on).toHaveBeenCalledTimes(10);
    page.__zlWaUnread.dispose();
    expect(listeners.size).toBe(0);
    expect(clearInterval).toHaveBeenCalledWith(123);
  });
  it('sends a lightweight unchanged heartbeat so legacy database polling can stay idle', () => {
    watchWhatsAppUnread();
    page.ferdium.pushWhatsAppUnread.mockClear();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11_000);
    try {
      page.__zlWaUnread.tick();
      expect(page.ferdium.pushWhatsAppUnread).toHaveBeenCalledTimes(1);
      expect(page.ferdium.pushWhatsAppUnread).toHaveBeenCalledWith({
        ownerId: '8613800000001@c.us',
        count: 1,
      });
    } finally {
      clock.mockRestore();
    }
  });
});
