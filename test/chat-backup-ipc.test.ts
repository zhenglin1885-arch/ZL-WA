/* eslint-disable global-require -- IPC handlers install after isolated Electron mocks. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('local chat backup IPC boundary', () => {
  let root: string;
  let handlers: Record<string, any>;
  let event: any;
  let secure: boolean;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'zl-backup-ipc-'));
    handlers = {};
    secure = true;
    const mainWindow = { webContents: { mainFrame: {} } };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    jest.doMock('electron', () => ({
      app: { getPath: () => root, once: jest.fn() },
      ipcMain: {
        handle: (name: string, handler: any) => {
          handlers[name] = handler;
        },
      },
      safeStorage: {
        isEncryptionAvailable: () => secure,
        getSelectedStorageBackend: () =>
          secure ? 'gnome_libsecret' : 'basic_text',
        encryptString: (v: string) => Buffer.from(v),
        decryptString: (v: Buffer) => v.toString(),
      },
      dialog: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [join(root, 'chosen')],
        }),
      },
      shell: { openPath: async () => '' },
    }));
    require('../src/electron/ipc-api/chatBackup').default(mainWindow);
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.dontMock('electron');
    rmSync(root, { recursive: true, force: true });
  });
  it('blocks guest webContents and child frames for every backup operation', async () => {
    await Promise.all(
      Object.values(handlers).map(async handler => {
        await expect(
          Promise.resolve().then(() => handler({ ...event, sender: {} })),
        ).rejects.toThrow('禁止访问');
        await expect(
          Promise.resolve().then(() => handler({ ...event, senderFrame: {} })),
        ).rejects.toThrow('禁止访问');
      }),
    );
  });
  it('only changes the directory through the native picker and merges independent settings', async () => {
    expect(() =>
      handlers['chat-backup-config'](event, { directory: '/unexpected' }),
    ).toThrow('文件夹选择器');
    handlers['chat-backup-config'](event, { time: '22:15' });
    const state = handlers['chat-backup-config'](event, { automatic: false });
    expect(state.config).toMatchObject({
      time: '22:15',
      automatic: false,
      enabled: true,
    });
    const chosen = await handlers['chat-backup-directory'](event);
    expect(chosen.config.directory).toBe(join(root, 'chosen'));
    await expect(
      handlers['chat-backup-export'](event, '../../escape'),
    ).rejects.toThrow('无效导出日期');
  });
  it('refuses plaintext fallback when the operating system key store is unavailable', () => {
    secure = false;
    const packet = {
      ownerId: '123456789@c.us',
      accountName: 'Account',
      chatId: '987654321@c.us',
      chatName: 'Chat',
      messages: [
        {
          id: 'message',
          time: Date.now(),
          sender: 'Sender',
          outgoing: false,
          text: 'private',
        },
      ],
    };
    expect(() =>
      handlers['chat-backup-save'](event, 'account', packet),
    ).toThrow('系统安全存储不可用');
    expect(handlers['chat-backup-state'](event).stats.error).toContain(
      '系统安全存储不可用',
    );
  });
});
