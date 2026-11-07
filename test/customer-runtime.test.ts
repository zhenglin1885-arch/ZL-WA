import type { CustomerRuntime as CustomerRuntimeType } from '../src/features/customers/runtime';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(),
}));

const { ipcRenderer } = jest.requireMock('electron');
const { ensureBulkLibrary } = jest.requireMock(
  '../src/features/accountTools/bulkRuntime',
);
const { CustomerRuntime } = jest.requireActual<
  typeof import('../src/features/customers/runtime')
>('../src/features/customers/runtime');

describe('customer initialization after a new login', () => {
  let runtime: CustomerRuntimeType;
  let context: any;
  let stores: any;
  let view: any;
  const ready = {
    token: 'new-document',
    owners: ['8613800000001@c.us'],
    needsLibrary: false,
  };
  const tick = () => (runtime as any).tick();
  beforeEach(() => {
    jest.resetAllMocks();
    context = {
      token: 'new-document',
      owners: [],
      needsLibrary: true,
      canInitialize: true,
    };
    view = {
      executeJavaScript: jest.fn(async (code: string) =>
        code.includes('function readCustomerContext') ? context : [],
      ),
    };
    stores = {
      services: {
        active: {
          id: 'account',
          recipe: { id: 'whatsapp' },
          webview: view,
          accountSnapshot: { status: 'online' },
        },
      },
    };
    runtime = new CustomerRuntime(stores);
    (ipcRenderer.invoke as jest.Mock).mockResolvedValue({
      owner: ready.owners[0],
      revision: 1,
      aliases: {},
      summaries: {},
      pins: [],
    });
  });
  it('positions the aggregate remark editor below its guest header across scaled webviews', async () => {
    context = ready;
    await tick();
    const profile = { remarkName: 'Existing remark' } as any;
    jest.spyOn(runtime, 'profile').mockResolvedValue(profile);
    view.getBoundingClientRect = () => ({
      left: 360,
      top: 32,
      width: 450,
      height: 400,
    });
    await (runtime as any).handle(
      {
        id: 91,
        chatId: '10002@c.us',
        action: 'remark',
        value: JSON.stringify({
          left: 20,
          top: 84,
          viewportWidth: 900,
          viewportHeight: 800,
        }),
      },
      view,
      ready.owners[0],
    );
    expect(runtime.editor?.anchor).toEqual({ left: 370, top: 74 });
    expect(runtime.editor?.profile).toBe(profile);
    await (runtime as any).handle(
      { id: 92, chatId: '10002@c.us', action: 'remark' },
      view,
      ready.owners[0],
    );
    expect(runtime.editor?.anchor).toBeUndefined();
  });
  it('loads the adapter automatically, rereads live identity and binds before rendering', async () => {
    (ensureBulkLibrary as jest.Mock).mockImplementation(async () => {
      context = ready;
    });
    await tick();
    expect(ensureBulkLibrary).toHaveBeenCalledWith(view);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'customers-bind',
      ready.owners,
    );
    expect(runtime.current).toEqual(ready);
    expect(runtime.bundle?.owner).toBe(ready.owners[0]);
  });
  it('backs off failed helper initialization while continuing to detect native recovery', async () => {
    (ensureBulkLibrary as jest.Mock).mockRejectedValue(new Error('not ready'));
    await tick();
    await tick();
    expect(ensureBulkLibrary).toHaveBeenCalledTimes(1);
    expect(runtime.error).toContain('自动重试');
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    context = ready;
    await tick();
    expect(runtime.bundle?.owner).toBe(ready.owners[0]);
    expect(runtime.error).toBe('');
  });
  it('does not bind a different account selected during helper loading', async () => {
    (ensureBulkLibrary as jest.Mock).mockImplementation(async () => {
      context = ready;
      stores.services.active = { id: 'another-account' };
    });
    await tick();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(runtime.bundle).toBeUndefined();
  });
  it('retries immediately for a new document after refreshing the same webview', async () => {
    (ensureBulkLibrary as jest.Mock).mockRejectedValue(new Error('not ready'));
    await tick();
    context = { ...context, token: 'refreshed-document' };
    await tick();
    expect(ensureBulkLibrary).toHaveBeenCalledTimes(2);
  });
  it('initializes from live page readiness while outer loading/status is stale', async () => {
    stores.services.active.isLoading = true;
    stores.services.active.accountSnapshot.status = 'loading';
    (ensureBulkLibrary as jest.Mock).mockImplementation(async () => {
      context = ready;
    });
    await tick();
    expect(ensureBulkLibrary).toHaveBeenCalledWith(view);
    expect(runtime.current).toEqual(ready);
    expect(runtime.bundle?.owner).toBe(ready.owners[0]);
  });
  it('does not load the helper on a login screen even with a stale online card', async () => {
    context.canInitialize = false;
    await tick();
    expect(ensureBulkLibrary).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });
  it('restores missing guest state and clears a transient error without changing chats', async () => {
    context = ready;
    await tick();
    runtime.error = 'temporary page error';
    const listener = jest.fn();
    runtime.listeners.add(listener);
    view.executeJavaScript.mockClear();
    await tick();
    const code = view.executeJavaScript.mock.calls[1][0];
    expect(code).toContain(JSON.stringify(runtime.bundle));
    expect(runtime.error).toBe('');
    expect(listener).toHaveBeenCalled();
    context = { ...ready, installed: { owner: ready.owners[0], revision: 1 } };
    view.executeJavaScript.mockClear();
    await tick();
    expect(view.executeJavaScript.mock.calls[1][0]).toContain(')(undefined,');
  });
  it('discards a completed alias lookup after switching accounts', async () => {
    context = {
      ...ready,
      chat: { id: '12345@lid', aliases: ['12345@lid'] },
    };
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'customers-link') {
        stores.services.active = { id: 'another-account' };
      }
      return {
        owner: ready.owners[0],
        revision: 1,
        aliases: {},
        summaries: {},
        pins: [],
      };
    });
    await tick();
    expect(runtime.current).toBeUndefined();
    expect(runtime.bundle).toBeUndefined();
    expect(view.executeJavaScript).toHaveBeenCalledTimes(1);
  });
  it('rebinds late login identities even when the phone owner already has a cached empty bundle', async () => {
    context = { ...ready };
    await tick();
    ipcRenderer.invoke.mockClear();
    context = { ...ready, owners: [...ready.owners, '123456@lid'] };
    ipcRenderer.invoke.mockResolvedValue({
      owner: ready.owners[0],
      revision: 2,
      aliases: {},
      pins: [],
      summaries: {
        '10002@c.us': { remarkName: 'restored saved note', flags: [] },
      },
    });
    await tick();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'customers-bind',
      context.owners,
    );
    expect(runtime.bundle?.summaries['10002@c.us'].remarkName).toBe(
      'restored saved note',
    );
  });
  it('reloads persisted account data for a replacement window instead of reusing its stale empty cache', async () => {
    context = { ...ready };
    await tick();
    ipcRenderer.invoke.mockClear();
    context = { ...ready, token: 'replacement-window-document' };
    stores.services.active.id = 'new-service-id';
    await tick();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'customers-bind',
      ready.owners,
    );
  });
  it('does not let a hung old account block a newly selected healthy account', async () => {
    let resolveOld!: (value: unknown) => void;
    view.executeJavaScript.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOld = resolve;
        }),
    );
    const oldTick = tick();
    const next = { ...ready, token: 'other-document' };
    const nextView = {
      executeJavaScript: jest.fn(async (code: string) =>
        code.includes('function readCustomerContext') ? next : [],
      ),
    };
    stores.services.active = {
      ...stores.services.active,
      id: 'other-window',
      webview: nextView,
    };
    await tick();
    expect(runtime.current?.token).toBe('other-document');
    resolveOld(ready);
    await oldTick;
    expect(runtime.current?.token).toBe('other-document');
  });
  it('recovers the same view after a timed out guest read without leaving the runtime busy', async () => {
    jest.useFakeTimers();
    try {
      view.executeJavaScript.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      const stalled = tick();
      await jest.advanceTimersByTimeAsync(8000);
      await stalled;
      expect(runtime.error).toContain('自动恢复');
      context = ready;
      await tick();
      expect(runtime.current).toEqual(ready);
      expect(runtime.error).toBe('');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
  it('rejects a late binding result when the same window logs into another owner', async () => {
    context = { ...ready };
    ipcRenderer.invoke.mockImplementation(async () => {
      context = { ...ready, owners: ['8613800000002@c.us'] };
      return {
        owner: ready.owners[0],
        revision: 1,
        summaries: {},
        aliases: {},
        pins: [],
      };
    });
    await tick();
    expect(runtime.bundle).toBeUndefined();
    expect(
      view.executeJavaScript.mock.calls.every(([code]: [string]) =>
        code.includes('function readCustomerContext'),
      ),
    ).toBe(true);
  });
});
