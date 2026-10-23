import {
  app,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  type BrowserWindow,
} from 'electron';
import { join, isAbsolute } from 'node:path';
import ChatBackup from '../ChatBackup';

export default function chatBackup(mainWindow: BrowserWindow) {
  const store = new ChatBackup(
    join(app.getPath('userData'), 'chat-backup'),
    {
      encrypt: text => {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' &&
            safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
          throw new Error('系统安全存储不可用，不能保存未加密聊天备份');
        return safeStorage.encryptString(text);
      },
      decrypt: data => safeStorage.decryptString(data),
    },
    join(app.getPath('documents'), 'ZL-WA聊天备份'),
  );
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('禁止访问聊天备份');
  };
  ipcMain.handle('chat-backup-state', event => {
    check(event);
    return store.state();
  });
  ipcMain.handle('chat-backup-config', (event, value) => {
    check(event);
    if (
      value &&
      Object.hasOwn(value, 'directory') &&
      value.directory !== store.config.directory
    )
      throw new Error('请通过文件夹选择器更改导出位置');
    return store.configure({ ...store.config, ...value });
  });
  ipcMain.handle('chat-backup-directory', async event => {
    check(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择聊天备份导出文件夹',
      defaultPath: store.config.directory,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (
      !result.canceled &&
      result.filePaths[0] &&
      isAbsolute(result.filePaths[0])
    )
      store.configure({ ...store.config, directory: result.filePaths[0] });
    return store.state();
  });
  ipcMain.handle('chat-backup-open', async event => {
    check(event);
    if (store.config.directory) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(store.config.directory, { recursive: true });
      return shell.openPath(store.config.directory);
    }
    return '';
  });
  ipcMain.handle(
    'chat-backup-save',
    (event, accountId: string, packet: unknown) => {
      check(event);
      if (
        typeof accountId !== 'string' ||
        !/^[\da-z-]{1,100}$/i.test(accountId)
      )
        throw new Error('无效账号');
      try {
        return store.ingest(accountId, packet);
      } catch (error) {
        store.error = String(error);
        throw error;
      }
    },
  );
  ipcMain.handle('chat-backup-export', (event, selection: string) => {
    check(event);
    return store.export(selection);
  });
  let exporting = false;
  const automatic = async () => {
    if (exporting) return;
    exporting = true;
    try {
      await store.catchUp();
    } catch (error) {
      store.error = String(error);
    } finally {
      exporting = false;
    }
  };
  const timer = setInterval(automatic, 60_000);
  const startup = setTimeout(automatic, 15_000);
  app.once('before-quit', () => {
    clearInterval(timer);
    clearTimeout(startup);
  });
}
