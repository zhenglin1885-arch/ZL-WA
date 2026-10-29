import {
  accountStatus,
  markAllWhatsAppRead,
  readWhatsAppSnapshot,
  mergeAccountSnapshot,
} from '../src/features/accounts/whatsapp';

describe('WhatsApp account adapter', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let modules: Record<string, any>;
  let selectors: Set<string>;

  beforeEach(() => {
    modules = {};
    selectors = new Set();
    const globals = {
      window: { require: (name: string) => modules[name] },
      document: {
        querySelector: (selector: string) =>
          selectors.has(selector) ? {} : null,
      },
      navigator: { onLine: true },
      location: { hostname: 'web.whatsapp.com' },
      localStorage: { getItem: () => null },
    };
    for (const [key, value] of Object.entries(globals)) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });

  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  it('never treats an ordinary loaded page as a logged-in WhatsApp account', async () => {
    const snapshot1 = await readWhatsAppSnapshot();
    expect(snapshot1.status).toBe('loading');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: 'example.com' },
    });
    const snapshot2 = await readWhatsAppSnapshot();
    expect(snapshot2.status).toBe('error');
  });
  it('does not treat a cached sidebar as online while the socket is reconnecting', async () => {
    selectors.add('#pane-side, #side');
    modules.WAWebSocketModel = { Socket: { state: 'OPENING' } };
    await expect(readWhatsAppSnapshot()).resolves.toMatchObject({
      status: 'loading',
    });
    modules.WAWebSocketModel.Socket.state = 'CONNECTED';
    await expect(readWhatsAppSnapshot()).resolves.toMatchObject({
      status: 'online',
    });
  });
  it('waits for linked-device synchronisation even after the socket connects', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    (window as any).WPP = { isReady: true, conn: { isMainReady: () => false } };
    await expect(readWhatsAppSnapshot()).resolves.toMatchObject({
      status: 'loading',
    });
    (window as any).WPP.conn.isMainReady = () => true;
    await expect(readWhatsAppSnapshot()).resolves.toMatchObject({
      status: 'online',
    });
  });

  it('identifies logout, connected and conflicting sessions from actual socket state', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'UNPAIRED' } };
    const snapshot3 = await readWhatsAppSnapshot();
    expect(snapshot3.status).toBe('logged-out');
    modules.WAWebSocketModel.Socket.state = 'CONNECTED';
    modules.WAWebConnModel = { Conn: { pushname: '本人昵称' } };
    modules.WAWebUserPrefsMeUser = {
      getMaybeMePnUser: () => ({ user: '8613800000000' }),
    };
    expect(await readWhatsAppSnapshot()).toMatchObject({
      status: 'online',
      nickname: '本人昵称',
      phone: '8613800000000',
    });
    modules.WAWebSocketModel.Socket.state = 'CONFLICT';
    const snapshot4 = await readWhatsAppSnapshot();
    expect(snapshot4.status).toBe('error');
  });

  it('prioritizes abnormal socket states over a remaining login QR code', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'TOS_BLOCK' } };
    selectors.add(
      '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
    );
    const snapshot = await readWhatsAppSnapshot();
    expect(snapshot.status).toBe('error');
  });

  it('does not mistake WhatsApp opaque LIDs for phone numbers', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    modules.WAWebConnModel = {
      Conn: { wid: { user: '12345678901234', server: 'lid' } },
    };
    const snapshot5 = await readWhatsAppSnapshot();
    expect(snapshot5.phone).toBeUndefined();
  });

  it('loads own imgFull and keeps it when the thumbnail temporarily disappears', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    modules.WAWebUserPrefsMeUser = {
      getMaybeMePnUser: () => ({ user: '8613800000001', server: 'c.us' }),
    };
    const get = jest
      .fn()
      .mockReturnValue({ imgFull: 'data:image/png;base64,b3du' });
    modules.WAWebProfilePicThumbCollection = { ProfilePicThumb: { get } };
    const first = await readWhatsAppSnapshot();
    expect(first.avatar).toBe('data:image/png;base64,b3du');
    get.mockReset();
    const remounted = await readWhatsAppSnapshot();
    expect(remounted.avatar).toBe(first.avatar);
    modules.WAWebUserPrefsMeUser.getMaybeMePnUser = () => ({
      user: '8613800000002',
      server: 'c.us',
    });
    const other = await readWhatsAppSnapshot();
    expect(other.avatar).toBeUndefined();
  });
  it('queries an unloaded own thumbnail at most once a minute', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    modules.WAWebUserPrefsMeUser = {
      getMaybeMePnUser: () => ({ user: '8613800000001', server: 'c.us' }),
    };
    const find = jest
      .fn()
      .mockResolvedValue({ img: 'data:image/png;base64,b3du' });
    modules.WAWebProfilePicThumbCollection = { ProfilePicThumb: { find } };
    const first = await readWhatsAppSnapshot();
    const second = await readWhatsAppSnapshot();
    expect(first.avatar).toBe('data:image/png;base64,b3du');
    expect(second.avatar).toBe(first.avatar);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      user: '8613800000001',
      server: 'c.us',
    });
  });
  it('retains the last confirmed identity on logout, errors and incomplete observations', () => {
    const previous = {
      status: 'online' as const,
      ownerId: 'one@c.us',
      nickname: 'Last user',
      phone: '8613800000001',
      unreadMessages: 8,
      avatar: 'data:image/png;base64,b3du',
    };
    expect(
      mergeAccountSnapshot(previous, { status: 'online', ownerId: 'one@c.us' })
        .avatar,
    ).toBe(previous.avatar);
    expect(
      mergeAccountSnapshot(previous, { status: 'online', ownerId: 'two@c.us' })
        .avatar,
    ).toBeUndefined();
    for (const status of [
      'logged-out',
      'loading',
      'error',
      'online',
    ] as const) {
      const next = mergeAccountSnapshot(previous, { status });
      expect(next).toMatchObject({
        status,
        ownerId: 'one@c.us',
        nickname: 'Last user',
        phone: '8613800000001',
        avatar: previous.avatar,
      });
      expect(next.unreadMessages).toBeUndefined();
    }
    const replaced = mergeAccountSnapshot(previous, {
      status: 'online',
      ownerId: 'two@c.us',
      phone: '8613800000002',
      nickname: 'New user',
    });
    expect(replaced).toMatchObject({
      phone: '8613800000002',
      nickname: 'New user',
    });
    expect(replaced.avatar).toBeUndefined();
  });
  it('recognizes the same account across its confirmed phone and LID identities', () => {
    const previous = {
      status: 'logged-out' as const,
      ownerId: '8613800000001@c.us',
      ownerIds: ['8613800000001@c.us', '90001@lid'],
      nickname: 'Known',
      phone: '8613800000001',
      avatar: 'data:image/png;base64,b3du',
    };
    const resumed = mergeAccountSnapshot(previous, {
      status: 'online',
      ownerId: '90001@lid',
    });
    expect(resumed).toMatchObject({
      status: 'online',
      nickname: 'Known',
      phone: previous.phone,
      avatar: previous.avatar,
    });
    expect(
      mergeAccountSnapshot(previous, { status: 'online', ownerId: '90002@lid' })
        .phone,
    ).toBeUndefined();
  });
  it('counts actual unread messages in unmuted, unarchived groups and private chats only', async () => {
    modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    // eslint-disable-next-line unicorn/consistent-function-scoping -- Local synthetic collection builder.
    const chat = (server: string, count: number, extra = {}) => ({
      id: { server },
      unreadCount: count,
      ...extra,
    });
    modules.WAWebCollections = {
      Chat: {
        getModelsArray: () => [
          chat('c.us', 3),
          chat('g.us', 4),
          chat('lid', 2),
          chat('c.us', 1, { muteExpiration: Date.now() / 1000 - 60 }),
          chat('g.us', 100, { archive: true }),
          chat('c.us', 100, { isArchived: true }),
          chat('g.us', 100, { muteExpiration: -1 }),
          chat('c.us', 100, { muteExpiration: Date.now() / 1000 + 3600 }),
          chat('c.us', 100, { isMuted: true }),
          chat('g.us', 100, { isAutoMuted: true }),
          chat('newsletter', 100),
          chat('broadcast', 100),
          chat('c.us', 100, { isPSA: true }),
          chat('c.us', -1),
          chat('g.us', Number.NaN),
        ],
      },
    };
    const snapshot = await readWhatsAppSnapshot();
    expect(snapshot.unreadMessages).toBe(11);
  });

  it('sends real read receipts only for unread chats and reports partial failures', async () => {
    const unread = { id: 'a', unreadCount: 3 };
    const manualUnread = { id: 'b', unreadCount: -1 };
    const read = { id: 'c', unreadCount: 0 };
    const sendSeen = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('offline'));
    modules.WAWebCollections = {
      Chat: { getModelsArray: () => [unread, manualUnread, read] },
    };
    modules.WAWebUpdateUnreadChatAction = { sendSeen };
    expect(await markAllWhatsAppRead()).toEqual({ read: 1, failed: 1 });
    expect(sendSeen).toHaveBeenCalledTimes(2);
    expect(sendSeen).toHaveBeenCalledWith({
      chat: unread,
      threadId: undefined,
    });
    expect(read.unreadCount).toBe(0);
  });

  it('reports unsupported read APIs instead of pretending badges were cleared', async () => {
    await expect(markAllWhatsAppRead()).rejects.toThrow('不支持全部已读');
  });

  it('overrides a previously green state when a service is disabled, loading or failed', () => {
    const service = {
      isEnabled: true,
      isLoading: false,
      isError: false,
      hasCrashed: false,
      isHibernating: false,
      accountSnapshot: { status: 'online' as const },
    };
    expect(accountStatus(service)).toBe('online');
    expect(accountStatus({ ...service, isError: true })).toBe('error');
    expect(accountStatus({ ...service, isEnabled: false })).toBe('logged-out');
    expect(accountStatus({ ...service, isHibernating: true })).toBe('sleeping');
    expect(accountStatus({ ...service, isLoading: true })).toBe('loading');
  });
});
