/* eslint-disable no-void -- Event checks report their result to the host renderer. */
import { app, ipcMain, net, shell, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import GitHubUpdates from '../GitHubUpdates';
import { prepareUpdateShutdown } from '../updateShutdown';

export default ({
  mainWindow,
  settings,
}: {
  mainWindow: BrowserWindow;
  settings: any;
}) => {
  const updater = new GitHubUpdates({
    version: app.getVersion(),
    directory: join(app.getPath('userData'), 'updates'),
    supported: process.platform === 'win32',
    launch: async path => {
      const error = await shell.openPath(path);
      if (error) throw new Error('无法启动安装包，请重试');
      prepareUpdateShutdown();
      app.quit();
    },
    fetch: (url, options) => net.fetch(url, options),
    notify: state => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send('autoUpdate', state);
    },
  });
  const permitted = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) =>
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame;
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (!permitted(event)) throw new Error('禁止访问更新设置');
  };
  ipcMain.handle('zl-updates-state', event => {
    check(event);
    return updater.state;
  });
  ipcMain.handle('zl-updates-check', event => {
    check(event);
    return updater.check(Boolean(settings.app.get('beta')));
  });
  ipcMain.handle('zl-updates-download', event => {
    check(event);
    return updater.download();
  });
  ipcMain.handle('zl-updates-install', event => {
    check(event);
    return updater.install();
  });
  ipcMain.handle('zl-updates-notes', (event, version: string) => {
    check(event);
    return updater.notes(version);
  });
  ipcMain.handle('zl-updates-open', event => {
    check(event);
    return shell.openExternal(updater.releaseUrl());
  });
  ipcMain.on('autoUpdate', (event, args) => {
    if (!permitted(event)) return;
    if (
      args?.action === 'check' &&
      (args.manual || settings.app.get('automaticUpdates'))
    )
      void updater.check(Boolean(settings.app.get('beta')));
    if (args?.action === 'install')
      void (
        updater.state.downloaded ? updater.install() : updater.download()
      ).catch(() => {
        if (!mainWindow.isDestroyed())
          mainWindow.webContents.send('autoUpdate', {
            error: { message: '无法完成在线更新，请在更新设置中重试' },
          });
      });
  });
};
