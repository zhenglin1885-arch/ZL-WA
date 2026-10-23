import { ipcMain, dialog, shell, type BrowserWindow } from 'electron';
import type CacheLocation from '../CacheLocation';

export default function cacheLocation(
  window: BrowserWindow,
  location: CacheLocation,
) {
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('禁止访问本机缓存配置');
  };
  ipcMain.handle('zl-cache-location-state', event => {
    check(event);
    return location.state();
  });
  ipcMain.handle('zl-cache-location-select', async event => {
    check(event);
    const state = location.state();
    const picked = await dialog.showOpenDialog(window, {
      title: '选择缓存保存文件夹',
      defaultPath: state.next,
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.canceled || !picked.filePaths[0]
      ? location.state()
      : location.select(picked.filePaths[0]);
  });
  ipcMain.handle('zl-cache-location-reset', event => {
    check(event);
    return location.reset();
  });
  ipcMain.handle('zl-cache-location-cancel', event => {
    check(event);
    return location.cancel();
  });
  ipcMain.handle('zl-cache-location-open', event => {
    check(event);
    return shell.openPath(location.state().current);
  });
}
