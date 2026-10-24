import { join } from 'node:path';
import { type BrowserWindow, app, ipcMain, nativeImage } from 'electron';
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
  // Keep the application identity stable. Pinned/grouped Windows taskbar
  // buttons may ignore per-window icon replacements, so unread counts must
  // use the native taskbar overlay instead.
  if (isWindows) params.mainWindow.setIcon(iconPath('icons', '256x256.png'));
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
      const count =
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.floor(value))
          : 0;
      const label =
        count > 0
          ? String(Math.min(10, count))
          : typeof value === 'string' && value
            ? 'alert'
            : '';
      params.mainWindow.setOverlayIcon(
        label
          ? nativeImage.createFromPath(
              iconPath('taskbar', 'win32', `taskbar-${label}.ico`),
            )
          : null,
        count > 0 ? `${count} 条未读消息` : label ? '有未读消息' : '',
      );
    }

    // Update Tray
    params.trayIcon.setIndicator(args.indicator);
  });
};
