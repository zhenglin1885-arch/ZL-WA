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
    context = { token: 'new-document', owners: [], needsLibrary: true };
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
});
