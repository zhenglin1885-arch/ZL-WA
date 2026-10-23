import { type BrowserWindow, type Settings, ipcMain } from 'electron';
import { LOCAL_SERVER } from '../../config';

export default (params: { mainWindow: BrowserWindow; settings: Settings }) => {
  ipcMain.on('getAppSettings', (_event, type) => {
    params.mainWindow.webContents.send('appSettings', {
      type,
      data: params.settings[type].allSerialized,
    });
  });

  ipcMain.on('updateAppSettings', (_event, args) => {
    params.settings[args.type].set(
      args.type === 'app' ? { ...args.data, server: LOCAL_SERVER } : args.data,
    );
  });
};
