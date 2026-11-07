import type { ConversationRuntime as Runtime } from '../src/features/conversations/runtime';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(),
}));
const { ipcRenderer } = jest.requireMock('electron');
const { ensureBulkLibrary } = jest.requireMock(
  '../src/features/accountTools/bulkRuntime',
);
const { ConversationRuntime, getConversationRuntime } = jest.requireActual<
  typeof import('../src/features/conversations/runtime')
>('../src/features/conversations/runtime');
describe('aggregate account isolation and lifecycle', () => {
  let stores: any;
  let runtime: Runtime;
  const item = {
    id: '10001@c.us',
    aliases: ['10001@c.us'],
    name: 'Alice',
    group: false,
  };
  const indexedWithUnread = (value: number) => ({
    context: { owners: ['A@c.us'] },
    index: { rows: [{ ...item, unread: value }], contactsReady: true },
  });
  const service = (id: string) => ({
    id,
    name: id,
    recipe: { id: 'whatsapp' },
    isEnabled: true,
    accountSnapshot: { nickname: id, status: 'online', ownerId: `${id}@c.us` },
    webview: {
      executeJavaScript: jest.fn(
        async (code: string): Promise<unknown> =>
          code.includes('index:')
            ? {
                context: { owners: [`${id}@c.us`] },
                index: { rows: [item], contactsReady: true },
              }
            : true,
      ),
    },
  });
  beforeEach(() => {
    jest.resetAllMocks();
    ipcRenderer.invoke.mockImplementation(
      async (_channel: string, owners: string[]) => ({
        owner: owners[0],
        ownerAliases: owners,
        aliases: {},
        summaries: {
          '10001@c.us': { remarkName: 'VIP', flags: ['priority', 'signup'] },
        },
      }),
    );
    stores = {
      settings: {
        app: { accountSidebar: { accounts: { A: { remark: '蓝二号' } } } },
      },
      services: { all: [service('A'), service('B')], _awake: jest.fn() },
    };
    runtime = new ConversationRuntime(stores, jest.fn());
    (runtime as any).active = true;
  });
  afterEach(() => runtime.dispose());
  it('skips unready accounts without spending guest-read slots or waiting for their timeouts, and includes them once ready', async () => {
    jest.useFakeTimers();
    try {
      const pending = service('pending');
      pending.accountSnapshot.status = 'loading';
      const unidentified = service('unidentified');
      unidentified.accountSnapshot.ownerId = '';
      const sleeping = { ...service('sleeping'), isHibernating: true };
      const loading = { ...service('loading'), isLoading: true };
      const failed = { ...service('failed'), isError: true };
      const loggedOut = service('logged-out');
      loggedOut.accountSnapshot.status = 'logged-out';
      const skipped = [
        pending,
        unidentified,
        sleeping,
        loading,
        failed,
        loggedOut,
      ];
      skipped.forEach(account =>
        account.webview.executeJavaScript.mockImplementation(
          () => new Promise(() => {}),
        ),
      );
      const ready = service('ready');
      stores.services.all = [...skipped, ready];
      stores.services.active = pending;
      runtime.warm(pending as any);
      runtime.warm(unidentified as any);
      const refreshing = runtime.refresh();
      await jest.advanceTimersByTimeAsync(0);
      expect(runtime.refreshing).toBe(false);
      await refreshing;
      expect(runtime.total).toBe(1);
      expect(runtime.rows.map(row => row.accountId)).toEqual(['ready']);
      skipped.forEach(account =>
        expect(account.webview.executeJavaScript).not.toHaveBeenCalled(),
      );
      expect(stores.services._awake).not.toHaveBeenCalled();
      expect(ensureBulkLibrary).not.toHaveBeenCalled();

      pending.accountSnapshot.status = 'online';
      pending.webview.executeJavaScript.mockResolvedValue({
        context: { owners: ['pending@c.us'] },
        index: { rows: [item], contactsReady: true },
      });
      await runtime.refresh();
      expect(runtime.rows.map(row => row.accountId)).toEqual([
        'pending',
        'ready',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
  it('discards an in-flight result when its account starts loading, and does not bind notes or fetch avatars', async () => {
    const account = { ...service('A'), isLoading: false };
    stores.services.all = [account];
    let finish!: (value: any) => void;
    account.webview.executeJavaScript.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const refreshing = runtime.refresh();
    account.isLoading = true;
    finish(indexedWithUnread(3));
    await refreshing;
    expect(runtime.rows).toHaveLength(0);
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
  it('retains usable conversations when an online account is only finishing contact synchronization', async () => {
    stores.services.all = [service('A')];
    stores.services.all[0].webview.executeJavaScript.mockResolvedValue({
      context: { owners: ['A@c.us'] },
      index: { rows: [item], contactsReady: false },
    });
    await runtime.refresh();
    expect(runtime.rows).toHaveLength(1);
    expect(runtime.errors.get('A')).toContain('通讯录仍在同步');
  });
  it('warms before opening, reuses the same store cache and throttles background reads', async () => {
    jest.useFakeTimers();
    try {
      runtime.dispose();
      runtime = getConversationRuntime(stores);
      for (const account of stores.services.all) {
        Object.assign(account.accountSnapshot, { status: 'online' });
        account.accountSnapshot.ownerId = `${account.id}@c.us`;
        runtime.warm(account);
      }
      await jest.advanceTimersByTimeAsync(300);
      expect(runtime.rows).toHaveLength(2);
      expect(getConversationRuntime(stores)).toBe(runtime);
      const metadataCalls = () =>
        stores.services.all
          .flatMap(
            (account: any) => account.webview.executeJavaScript.mock.calls,
          )
          .filter((args: string[]) => args[0].includes('index:')).length;
      const before = metadataCalls();
      for (const account of stores.services.all) runtime.warm(account);
      await jest.advanceTimersByTimeAsync(300);
      expect(metadataCalls()).toBe(before);
      runtime.start();
      expect(runtime.rows).toHaveLength(2);
      runtime.pause();
      expect(runtime.rows).toHaveLength(2);
      await jest.advanceTimersByTimeAsync(0);
      expect(ensureBulkLibrary).not.toHaveBeenCalled();
      expect(stores.services._awake).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('preserves loaded photos across panel pauses and processes a new visible batch during an existing fetch', async () => {
    await runtime.refresh();
    const [a, b] = runtime.rows;
    let complete!: (value: any) => void;
    stores.services.all[0].webview.executeJavaScript.mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    stores.services.all[1].webview.executeJavaScript.mockResolvedValue({
      [b.id]: 'data:image/jpeg;base64,AA==',
    });
    const first = runtime.loadAvatars([a]);
    await runtime.loadAvatars([b]);
    complete({ [a.id]: 'data:image/jpeg;base64,AA==' });
    await first;
    expect(runtime.avatars.size).toBe(2);
    runtime.pause();
    expect(runtime.avatars.size).toBe(2);
    expect(runtime.rows).toHaveLength(2);
  });
  it('hides stale account data immediately and rejects photos finishing after invalidation', async () => {
    await runtime.refresh();
    const a = runtime.rows[0];
    let complete!: (value: any) => void;
    stores.services.all[0].webview.executeJavaScript.mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    const photos = runtime.loadAvatars([a]);
    runtime.invalidate('A');
    complete({ [a.id]: 'data:image/jpeg;base64,AA==' });
    await photos;
    expect(runtime.avatars.has(a.key)).toBe(false);
    expect(runtime.rows.map(row => row.accountId)).toEqual(['B']);
    stores.services.all[1].accountSnapshot.ownerId = 'another@c.us';
    expect(runtime.rows).toHaveLength(0);
  });
  it('does not attach old-owner photos after the same document is rebound to another account', async () => {
    await runtime.refresh();
    const old = runtime.rows[0];
    let complete!: (value: any) => void;
    stores.services.all[0].webview.executeJavaScript.mockImplementation(
      (code: string) =>
        code.includes('image/jpeg')
          ? new Promise(resolve => {
              complete = resolve;
            })
          : Promise.resolve({
              context: { owners: ['new@c.us'] },
              index: { rows: [item], contactsReady: true },
            }),
    );
    const photo = runtime.loadAvatars([old]);
    runtime.invalidate('A');
    stores.services.all[0].accountSnapshot.ownerId = 'new@c.us';
    await runtime.refresh();
    complete({ [old.id]: 'data:image/jpeg;base64,AA==' });
    await photo;
    expect(runtime.rows.find(row => row.accountId === 'A')?.owner).toBe(
      'new@c.us',
    );
    expect(runtime.avatars.has(old.key)).toBe(false);
  });
  it('shares at most three metadata readers when warming overlaps entering the panel', async () => {
    jest.useFakeTimers();
    try {
      runtime.pause();
      let reading = 0;
      let maximum = 0;
      stores.services.all = Array.from({ length: 6 }, (_, i) =>
        service(String(i)),
      );
      stores.services.all.forEach((account: any) => {
        Object.assign(account.accountSnapshot, { status: 'online' });
        account.webview.executeJavaScript.mockImplementation(
          async (code: string) => {
            if (!code.includes('index:')) return {};
            reading += 1;
            maximum = Math.max(maximum, reading);
            await new Promise(resolve => {
              setTimeout(resolve, 1000);
            });
            reading -= 1;
            return {
              context: { owners: [`${account.id}@c.us`] },
              index: { rows: [item], contactsReady: true },
            };
          },
        );
        runtime.warm(account);
      });
      await jest.advanceTimersByTimeAsync(251);
      runtime.start();
      await jest.advanceTimersByTimeAsync(4000);
      runtime.pause();
      expect(maximum).toBeLessThanOrEqual(3);
      expect(runtime.rows).toHaveLength(6);
    } finally {
      jest.useRealTimers();
    }
  });
  it('indexes accounts separately without initializing SDKs or waking accounts', async () => {
    stores.services.all.push({ ...service('sleeping'), isHibernating: true });
    await runtime.refresh();
    expect(runtime.rows).toHaveLength(2);
    expect(new Set(runtime.rows.map(r => r.key)).size).toBe(2);
    expect(runtime.rows.find(r => r.accountId === 'A')?.accountRemark).toBe(
      '蓝二号',
    );
    expect(runtime.rows[0].remark).toBe('VIP');
    expect(runtime.rows[0].name).toBe('Alice');
    expect(runtime.rows[0].flags).toEqual(['priority', 'signup']);
    expect(ensureBulkLibrary).not.toHaveBeenCalled();
    expect(stores.services._awake).not.toHaveBeenCalled();
    expect(runtime.errors.get('sleeping')).toContain('休眠');
    expect(
      stores.services.all[2].webview.executeJavaScript,
    ).not.toHaveBeenCalled();
  });
  it('marks only supplied conversations on their own account without loading SDKs', async () => {
    await runtime.refresh();
    stores.services.all[0].webview.executeJavaScript.mockImplementation(
      async (code: string) =>
        code.includes('WAWebUpdateUnreadChatAction')
          ? { read: 1, failed: 0, halted: false }
          : {
              context: { owners: ['A@c.us'] },
              index: { rows: [item], contactsReady: true },
            },
    );
    const result = await runtime.markRead(
      runtime.rows.filter(row => row.accountId === 'A'),
    );
    expect(result).toEqual({ read: 1, failed: 0 });
    const callsA = stores.services.all[0].webview.executeJavaScript.mock.calls
      .map((args: string[]) => args[0])
      .filter((code: string) => code.includes('WAWebUpdateUnreadChatAction'));
    expect(callsA).toHaveLength(1);
    expect(callsA[0]).toContain('["10001@c.us"],["A@c.us"]');
    expect(
      stores.services.all[1].webview.executeJavaScript.mock.calls.some(
        (args: string[]) => args[0].includes('WAWebUpdateUnreadChatAction'),
      ),
    ).toBe(false);
    expect(ensureBulkLibrary).not.toHaveBeenCalled();
    expect(stores.services._awake).not.toHaveBeenCalled();
  });
  it('rereads unread state after a mark-read action instead of reusing a pre-action scan', async () => {
    stores.services.all = [service('A')];
    await runtime.refresh();
    let release!: (value: any) => void;
    let scans = 0;
    let unread = 5;
    stores.services.all[0].webview.executeJavaScript.mockImplementation(
      async (code: string) => {
        if (code.includes('WAWebUpdateUnreadChatAction')) {
          unread = 0;
          return { read: 1, failed: 0, halted: false };
        }
        scans += 1;
        if (scans === 1)
          return new Promise(resolve => {
            release = resolve;
          });
        return indexedWithUnread(unread);
      },
    );
    const refresh = runtime.refresh();
    const marking = runtime.markRead(runtime.rows);
    await Promise.resolve();
    release(indexedWithUnread(5));
    await Promise.all([refresh, marking]);
    expect(scans).toBe(2);
    expect(runtime.rows[0].unread).toBe(0);
  });
  it('uses a verified phone alias when an unsaved LID contact has no native phone yet', async () => {
    stores.services.all = [service('A')];
    stores.services.all[0].webview.executeJavaScript.mockResolvedValue({
      context: { owners: ['A@c.us'] },
      index: {
        rows: [
          {
            ...item,
            id: '90001@lid',
            aliases: ['90001@lid'],
            name: '号码待同步',
          },
        ],
        contactsReady: true,
      },
    });
    ipcRenderer.invoke.mockResolvedValue({
      owner: 'A@c.us',
      ownerAliases: ['A@c.us'],
      aliases: { '90001@lid': '551234567@c.us' },
      summaries: {},
    });
    await runtime.refresh();
    expect(runtime.rows[0].name).toBe('551234567');
    expect(runtime.rows[0].phone).toBe('551234567');
  });
  it('clears a logged-out account instead of retaining its previous contacts', async () => {
    await runtime.refresh();
    stores.services.all[0].webview.executeJavaScript.mockResolvedValue({
      context: { owners: [] },
      index: { rows: [], contactsReady: false },
    });
    await runtime.refresh();
    expect(runtime.rows.map(r => r.accountId)).toEqual(['B']);
  });
  it('bounds a stalled account and still indexes other accounts', async () => {
    jest.useFakeTimers();
    try {
      stores.services.all[0].webview.executeJavaScript.mockReturnValue(
        new Promise(() => {}),
      );
      const refresh = runtime.refresh();
      await jest.advanceTimersByTimeAsync(6001);
      await refresh;
      expect(runtime.rows.map(r => r.accountId)).toEqual(['B']);
      expect(runtime.errors.get('A')).toContain('超时');
    } finally {
      jest.useRealTimers();
    }
  });
  it('discards reads finishing after cache disposal', async () => {
    let complete!: (value: any) => void;
    stores.services.all = [service('A')];
    stores.services.all[0].webview.executeJavaScript.mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    const refresh = runtime.refresh();
    runtime.dispose();
    complete({
      context: { owners: ['A@c.us'] },
      index: { rows: [item], contactsReady: true },
    });
    await refresh;
    expect(runtime.rows).toHaveLength(0);
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});
