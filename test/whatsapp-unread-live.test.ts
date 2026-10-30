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
      document: { querySelector: () => null },
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
    expect(collection.on).toHaveBeenCalledTimes(9);
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
