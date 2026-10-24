import { join } from 'node:path';
import { type BrowserWindow, app, ipcMain } from 'electron';
import { autorun } from 'mobx';
import { isLinux, isMac, isWindows } from '../../environment';
import type TrayIcon from '../../lib/Tray';

let isTrayIconEnabled: boolean;
const iconPath = (...parts: string[]) =>
  join(__dirname, '..', '..', 'assets', 'images', ...parts);

export default (params: {
  mainWindow: BrowserWindow;
  settings: any;
  trayIcon: TrayIcon;
}) => {
  autorun(() => {
    isTrayIconEnabled = params.settings.app.get('enableSystemTray');

    if (!isTrayIconEnabled) {
      params.trayIcon.hide();
    } else if (isTrayIconEnabled) {
      params.trayIcon.show();
    }
  });

  ipcMain.on('updateAppIndicator', (_event, args) => {
    // Flash TaskBar for windows, bounce Dock on Mac
    if (
      !params.mainWindow.isFocused() &&
      params.settings.app.get('notifyTaskBarOnMessage')
    ) {
      if (isWindows) {
        params.mainWindow.flashFrame(true);
        params.mainWindow.once('focus', () =>
          params.mainWindow.flashFrame(false),
        );
      } else if (isMac) {
        app.dock?.bounce('informational');
      }
    }

    // Update badge
    if (isMac && typeof args.indicator === 'string') {
      app.dock?.setBadge(args.indicator);
    }

    if ((isMac || isLinux) && typeof args.indicator === 'number') {
      app.badgeCount = args.indicator;
    }

    if (isWindows) {
      const value = args.indicator;
      const label =
        typeof value === 'number' && Number.isFinite(value) && value > 0
          ? value >= 10
            ? '10+'
            : String(Math.floor(value))
          : typeof value === 'string' && value
            ? 'alert'
            : '';
      // Windows fixes overlay icons to the lower-right corner. Compose the
      // badge into the window icon itself to place it above the logo instead.
      params.mainWindow.setOverlayIcon(null, '');
      params.mainWindow.setIcon(
        label
          ? iconPath('taskbar', `badged-${label}.png`)
          : iconPath('icons', '256x256.png'),
      );
    }

    // Update Tray
    params.trayIcon.setIndicator(args.indicator);
  });
};
