jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(),
}));

const { ipcRenderer } = require('electron');
const { BackupRuntime } = require('../src/features/chatBackup/runtime');

const account = (id: string, options = {}) => ({
  id,
  name: id,
  recipe: { id: 'whatsapp' },
  isEnabled: true,
  isHibernating: false,
  accountSnapshot: { status: 'online', ownerId: `${id}@c.us` },
  webview: {
    executeJavaScript: jest.fn(async (code: string) =>
      code.includes('"mode":"list"')
        ? [{ id: 'same-chat', name: 'Chat' }]
        : {
            packet: { ownerId: `${id}@c.us`, messages: [{ id: 'one' }] },
            complete: true,
          },
    ),
  },
  ...options,
});
const config = { enabled: true, retentionDays: 365 };
beforeEach(() => {
  (ipcRenderer.invoke as jest.Mock).mockReset().mockResolvedValue({ config });
});

test('all accounts sync sequentially to their own IDs without waking sleeping or offline accounts', async () => {
  const a = account('a');
  const b = account('b');
  const sleep = account('sleep', { isHibernating: true });
  const offline = account('offline', {
    accountSnapshot: { status: 'offline' },
  });
  const stores: any = {
    services: { all: [a, sleep, offline, b] },
    settings: { app: {} },
  };
  const runtime = new BackupRuntime();
  await runtime.synchronize(stores, 'all');
  expect(
    (ipcRenderer.invoke as jest.Mock).mock.calls
      .filter(([method]) => method === 'chat-backup-save')
      .map(([, id]) => id),
  ).toEqual(['a', 'b']);
  expect(sleep.webview.executeJavaScript).not.toHaveBeenCalled();
  expect(offline.webview.executeJavaScript).not.toHaveBeenCalled();
  expect(runtime.error).toBe('');
  expect(runtime.active).toBe('');
  expect(runtime.progress).toContain('2 条消息');
});
test('all accounts continue after one account fails and report the failure', async () => {
  const a = account('a');
  const b = account('b');
  a.webview.executeJavaScript.mockRejectedValue(new Error('offline'));
  const runtime = new BackupRuntime();
  await runtime.synchronize(
    { services: { all: [a, b] }, settings: { app: {} } } as any,
    'all',
  );
  expect(runtime.error).toContain('a：Error: offline');
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(
    'chat-backup-save',
    'b',
    expect.anything(),
  );
});
test('stop prevents reading the next account while preserving already saved content', async () => {
  const a = account('a');
  const b = account('b');
  const runtime = new BackupRuntime();
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async method => {
    if (method === 'chat-backup-save') runtime.stop();
    return { config };
  });
  await runtime.synchronize(
    { services: { all: [a, b] }, settings: { app: {} } } as any,
    'all',
  );
  expect(b.webview.executeJavaScript).not.toHaveBeenCalled();
  expect(runtime.progress).toContain('已停止');
});
test('single account selection reads only that account', async () => {
  const a = account('a');
  const b = account('b');
  await new BackupRuntime().synchronize(
    { services: { all: [a, b] }, settings: { app: {} } } as any,
    'b',
  );
  expect(a.webview.executeJavaScript).not.toHaveBeenCalled();
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(
    'chat-backup-save',
    'b',
    expect.anything(),
  );
});

// eslint-disable-next-line jest/no-export -- Keep mock helpers scoped to this test module.
export {};
