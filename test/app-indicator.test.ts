import { existsSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('electron', () => ({ app: {}, ipcMain: { on: jest.fn() } }));
jest.mock('../src/environment', () => ({
  isWindows: true,
  isMac: false,
  isLinux: false,
}));
const { ipcMain } = jest.requireMock('electron');
const install = jest.requireActual<
  typeof import('../src/electron/ipc-api/appIndicator')
>('../src/electron/ipc-api/appIndicator').default;

it('uses large upper-right composed Windows icons and restores the original on read', () => {
  const mainWindow: any = {
    isFocused: () => true,
    setOverlayIcon: jest.fn(),
    setIcon: jest.fn(),
  };
  const trayIcon: any = {
    show: jest.fn(),
    hide: jest.fn(),
    setIndicator: jest.fn(),
  };
  install({ mainWindow, trayIcon, settings: { app: { get: () => true } } });
  const update = ipcMain.on.mock.calls[0][1];
  for (const [count, file] of [
    [1, 'taskbar/badged-1.png'],
    [2, 'taskbar/badged-2.png'],
    [31, 'taskbar/badged-10+.png'],
    ['•', 'taskbar/badged-alert.png'],
    [0, 'icons/256x256.png'],
  ] as const) {
    update({}, { indicator: count });
    expect(mainWindow.setIcon).toHaveBeenLastCalledWith(
      expect.stringContaining(file),
    );
    expect(mainWindow.setOverlayIcon).toHaveBeenLastCalledWith(null, '');
    expect(trayIcon.setIndicator).toHaveBeenLastCalledWith(count);
    expect(existsSync(join(process.cwd(), 'src/assets/images', file))).toBe(
      true,
    );
  }
});
