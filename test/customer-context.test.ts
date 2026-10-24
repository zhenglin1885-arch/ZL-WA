import { readCustomerContext } from '../src/features/customers/guest';

describe('customer conversation identity fallback', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let modules: Record<string, any>;
  let chats: any[];
  let title: string;
  let messageKey: string;
  let header: boolean;
  beforeEach(() => {
    title = 'Test contact';
    messageKey = '';
    header = true;
    chats = [{ id: { _serialized: '10001@c.us' }, name: title }];
    modules = {
      WAWebUserPrefsMeUser: {
        getMaybeMePnUser: () => ({ user: '8613800000001', server: 'c.us' }),
      },
      WAWebCollections: { Chat: { getModelsArray: () => chats } },
    };
    const values = {
      location: { hostname: 'web.whatsapp.com' },
      window: { require: (name: string) => modules[name] },
      crypto: { randomUUID: () => 'test-document' },
      document: {
        querySelector: (selector: string) =>
          selector === '#main header'
            ? header
              ? {
                  querySelector: (query: string) =>
                    query === '[title]' ? { getAttribute: () => title } : null,
                }
              : null
            : selector === '#main [data-id]' && messageKey
              ? { getAttribute: () => messageKey }
              : null,
      },
    };
    for (const [key, value] of Object.entries(values)) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('uses the active native chat when the getter no longer exists', () => {
    title = 'Truncated name…';
    chats[0].active = true;
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('uses an exact message remote when active-getter and title data are unavailable', () => {
    title = '';
    messageKey = 'true_10002@lid_message-key';
    expect(readCustomerContext().chat?.id).toBe('10002@lid');
    expect(readCustomerContext().chat?.phone).toBe('');
  });
  it('uses a unique native model with the same full header title', () => {
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('never guesses between two contacts with the same name', () => {
    chats.push({ id: { _serialized: '10002@c.us' }, name: title });
    expect(readCustomerContext().chat).toBeUndefined();
  });
  it('falls back safely when the native getter throws during a view transition', () => {
    modules.WAWebChatGetters = {
      getActiveChat: () => {
        throw new Error('transition');
      },
    };
    chats[0].active = true;
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('keeps an available owner when another login getter is still synchronizing', () => {
    modules.WAWebUserPrefsMeUser.getMaybeMeLidUser = () => {
      throw new Error('LID not synchronized');
    };
    expect(readCustomerContext().owners).toEqual(['8613800000001@c.us']);
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('does not merge stale connection/helper owners into a newly logged-in account', () => {
    modules.WAWebConnModel = { Conn: { wid: '9999999999@c.us' } };
    (window as any).WPP = {
      isReady: true,
      conn: { getMyUserId: () => '8888888888@c.us' },
    };
    expect(readCustomerContext().owners).toEqual(['8613800000001@c.us']);
  });
  it('normalizes device-qualified current owner IDs without reading stale local storage', () => {
    modules.WAWebUserPrefsMeUser = {
      getMeUser: () => ({ _serialized: '8613800000001:7@c.us' }),
    };
    expect(readCustomerContext().owners).toEqual(['8613800000001@c.us']);
    expect((window as any).__zlCustomerAdapter.owners()).toEqual([
      '8613800000001@c.us',
    ]);
  });
  it('supports a separately exported chat collection with keyed models', () => {
    modules.WAWebCollections = undefined;
    modules.WAWebChatCollection = {
      ChatCollection: { models: { first: chats[0] } },
    };
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('uses the ready helper store after a native collection throws', () => {
    modules.WAWebCollections.Chat.getModelsArray = () => {
      throw new Error('collection syncing');
    };
    modules.WAWebUserPrefsMeUser = undefined;
    (window as any).WPP = {
      isReady: true,
      conn: { getMyUserId: () => ({ _serialized: '8613800000001@c.us' }) },
      whatsapp: { ChatStore: { _models: chats } },
    };
    const context = readCustomerContext();
    expect(context.owners).toEqual(['8613800000001@c.us']);
    expect(context.chat?.id).toBe('10001@c.us');
    expect(context.needsLibrary).toBe(false);
  });
  it('keeps a working native collection when an optional helper export throws', () => {
    (window as any).WPP = {
      isReady: true,
      whatsapp: Object.defineProperty({}, 'ChatStore', {
        get() {
          throw new Error('lazy helper export unavailable');
        },
      }),
    };
    expect(readCustomerContext().chat?.id).toBe('10001@c.us');
  });
  it('never infers account ownership from the current contact and rejects logged-out owners', () => {
    modules.WAWebUserPrefsMeUser = undefined;
    expect(readCustomerContext().owners).toEqual([]);
    expect(readCustomerContext().needsLibrary).toBe(true);
    modules.WAWebUserPrefsMeUser = { getMeUser: () => '8613800000001@c.us' };
    modules.WAWebSocketModel = { Socket: { state: 'UNPAIRED' } };
    expect(readCustomerContext().owners).toEqual([]);
  });
  it('does not show a client form without an opened conversation', () => {
    header = false;
    expect(readCustomerContext().chat).toBeUndefined();
  });
  it('retains group identity for local list notes without treating it as a private client', () => {
    chats[0].id._serialized = '10001@g.us';
    chats[0].active = true;
    expect(readCustomerContext().chat?.group).toBe(true);
  });
});
