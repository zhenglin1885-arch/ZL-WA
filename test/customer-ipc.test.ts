import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('customer profile IPC boundary', () => {
  let root: string;
  let handlers: Record<string, any>;
  let mainWindow: any;
  let event: any;
  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), 'zl-customer-ipc-'));
    handlers = {};
    mainWindow = { webContents: { mainFrame: {} } };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    jest.doMock('electron', () => ({
      app: { getPath: () => root },
      ipcMain: {
        handle: (name: string, handler: any) => {
          handlers[name] = handler;
        },
      },
    }));
    require('../src/electron/ipc-api/customers').default(mainWindow);
  });
  afterEach(() => {
    jest.dontMock('electron');
    rmSync(root, { recursive: true, force: true });
  });
  it('blocks guest webContents and child frames from every customer method', () => {
    const contents = mainWindow.webContents;
    for (const handler of Object.values(handlers)) {
      expect(() => handler({ sender: {}, senderFrame: {} })).toThrow(
        '禁止访问',
      );
      expect(() => handler({ sender: contents, senderFrame: {} })).toThrow(
        '禁止访问',
      );
    }
  });
  it('returns full notes only to the host profile method and summaries otherwise', () => {
    const owner = '8613800000001@c.us';
    const id = '10002@c.us';
    handlers['customers-bind'](event, [owner]);
    const bundle = handlers['customers-patch'](event, owner, id, {
      notes: 'local secret',
      remarkName: '红色',
    });
    expect(JSON.stringify(bundle)).not.toContain('local secret');
    expect(handlers['customers-profile'](event, owner, id).notes).toBe(
      'local secret',
    );
  });
});
