import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('GitHub update IPC', () => {
  let root: string;
  let handlers: Record<string, any>;
  let events: Record<string, any>;
  let mainWindow: any;
  let event: any;
  let fetcher: jest.Mock;
  let open: jest.Mock;
  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), 'zl-updates-ipc-'));
    handlers = {};
    events = {};
    fetcher = jest.fn().mockImplementation(async () => new Response('[]'));
    open = jest.fn().mockImplementation(async () => {});
    mainWindow = {
      isDestroyed: () => false,
      webContents: { mainFrame: {}, send: jest.fn() },
    };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    jest.doMock('electron', () => ({
      app: { getVersion: () => '7.2.5', getPath: () => root },
      net: { fetch: fetcher },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
      },
      shell: { openExternal: open },
      ipcMain: {
        handle: (name: string, fn: any) => {
          handlers[name] = fn;
        },
        on: (name: string, fn: any) => {
          events[name] = fn;
        },
      },
    }));
    require('../src/electron/ipc-api/autoUpdate').default({
      mainWindow,
      settings: { app: { get: () => false } },
    });
  });
  afterEach(() => {
    jest.dontMock('electron');
    rmSync(root, { recursive: true, force: true });
  });
  it('keeps manual checks enabled while automatic checks are disabled', async () => {
    events.autoUpdate(event, { action: 'check', manual: false });
    expect(fetcher).not.toHaveBeenCalled();
    await handlers['zl-updates-check'](event);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'autoUpdate',
      expect.objectContaining({ error: expect.any(Object) }),
    );
  });
  it('rejects guest frames for every privileged update method', () => {
    const contents = mainWindow.webContents;
    for (const handler of Object.values(handlers)) {
      expect(() => handler({ sender: {}, senderFrame: {} })).toThrow(
        '禁止访问',
      );
      expect(() => handler({ sender: contents, senderFrame: {} })).toThrow(
        '禁止访问',
      );
    }
    events.autoUpdate({ sender: {}, senderFrame: {} }, { action: 'install' });
    expect(open).not.toHaveBeenCalled();
  });
  it('opens only the configured releases page and never quits the application', async () => {
    await handlers['zl-updates-open'](event);
    expect(open).toHaveBeenCalledWith(
      'https://github.com/zhenglin1885-arch/ZL-WA/releases',
    );
  });
});
