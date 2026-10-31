import { join } from 'node:path';
import {
  type BrowserWindow,
  type NativeImage,
  app,
  ipcMain,
  nativeImage,
} from 'electron';
import { autorun } from 'mobx';
import { isLinux, isMac, isWindows } from '../../environment';
import type TrayIcon from '../../lib/Tray';

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
  const stopTrayWatch = autorun(() => {
    const isTrayIconEnabled = params.settings.app.get('enableSystemTray');

    if (!isTrayIconEnabled) {
      params.trayIcon.hide();
    } else if (isTrayIconEnabled) {
      params.trayIcon.show();
    }
  });

  let latestIndicator: number | string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const overlayImages = new Map<string, NativeImage>();
  const applyOverlay = () => {
    if (
      !isWindows ||
      latestIndicator === undefined ||
      params.mainWindow.isDestroyed()
    )
      return;
    const value = latestIndicator;
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
    if (label && !overlayImages.has(label))
      overlayImages.set(
        label,
        nativeImage.createFromPath(
          iconPath('taskbar', 'win32', `taskbar-${label}.ico`),
        ),
      );
    params.mainWindow.setOverlayIcon(
      label ? overlayImages.get(label)! : null,
      count > 0 ? `${count} 条未读消息` : label ? '有未读消息' : '',
    );
  };
  // The taskbar button can be recreated after the count was delivered. Reapply
  // the latest state after window activity; do not poll or reread chat data.
  const scheduleOverlay = () => {
    if (!isWindows || latestIndicator === undefined) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      applyOverlay();
    }, 250);
  };
  if (isWindows) {
    params.mainWindow.on('show', scheduleOverlay);
    params.mainWindow.on('restore', scheduleOverlay);
    params.mainWindow.on('focus', scheduleOverlay);
  }
  const updateIndicator = (
    _event: Electron.IpcMainEvent,
    args: { indicator: number | string },
  ) => {
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

    latestIndicator = args.indicator;
    applyOverlay();
    scheduleOverlay();

    // Update Tray
    params.trayIcon.setIndicator(args.indicator);
  };
  ipcMain.on('updateAppIndicator', updateIndicator);
  params.mainWindow.once('closed', () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    ipcMain.removeListener('updateAppIndicator', updateIndicator);
    params.mainWindow.removeListener('show', scheduleOverlay);
    params.mainWindow.removeListener('restore', scheduleOverlay);
    params.mainWindow.removeListener('focus', scheduleOverlay);
    stopTrayWatch();
    overlayImages.clear();
  });
};
