import type { ConversationRuntime as Runtime } from '../src/features/conversations/runtime';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(),
}));
const { ipcRenderer } = jest.requireMock('electron');
const { ensureBulkLibrary } = jest.requireMock(
  '../src/features/accountTools/bulkRuntime',
);
const { ConversationRuntime } = jest.requireActual<
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
  const service = (id: string) => ({
    id,
    name: id,
    recipe: { id: 'whatsapp' },
    isEnabled: true,
    accountSnapshot: { nickname: id },
    webview: {
      executeJavaScript: jest.fn(async (code: string) =>
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
        summaries: { '10001@c.us': { remarkName: 'VIP' } },
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
  it('indexes accounts separately without initializing SDKs or waking accounts', async () => {
    stores.services.all.push({ ...service('sleeping'), isHibernating: true });
    await runtime.refresh();
    expect(runtime.rows).toHaveLength(2);
    expect(new Set(runtime.rows.map(r => r.key)).size).toBe(2);
    expect(runtime.rows.find(r => r.accountId === 'A')?.accountRemark).toBe(
      '蓝二号',
    );
    expect(runtime.rows[0].remark).toBe('VIP');
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
  it('discards reads finishing after the sidebar is closed', async () => {
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
