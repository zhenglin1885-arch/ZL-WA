/* eslint-disable jest/no-conditional-expect -- Nonzero and cleared native overlays have distinct contracts. */
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('electron', () => ({
  app: {},
  ipcMain: { on: jest.fn(), removeListener: jest.fn() },
  nativeImage: { createFromPath: jest.fn(path => ({ path })) },
}));
jest.mock('../src/environment', () => ({
  isWindows: true,
  isMac: false,
  isLinux: false,
}));
const { ipcMain, nativeImage } = jest.requireMock('electron');
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const install = jest.requireActual<
  typeof import('../src/electron/ipc-api/appIndicator')
>('../src/electron/ipc-api/appIndicator').default;

it('uses native Windows overlays for unread counts and clears only after messages are read', () => {
  const mainWindow: any = {
    isFocused: () => true,
    isDestroyed: () => false,
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
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
  expect(mainWindow.setIcon).toHaveBeenCalledTimes(1);
  expect(mainWindow.setIcon).toHaveBeenCalledWith(
    expect.stringContaining(join('icons', '256x256.png')),
  );
  for (const [count, file, description] of [
    [1, 'taskbar-1.ico', '1 条未读消息'],
    [2, 'taskbar-2.ico', '2 条未读消息'],
    [9, 'taskbar-9.ico', '9 条未读消息'],
    [31, 'taskbar-10.ico', '31 条未读消息'],
    ['•', 'taskbar-alert.ico', '有未读消息'],
    [0, '', ''],
    [2, 'taskbar-2.ico', '2 条未读消息'],
    [0, '', ''],
  ] as const) {
    update({}, { indicator: count });
    const [image, tooltip] = mainWindow.setOverlayIcon.mock.calls.at(-1);
    expect(tooltip).toBe(description);
    if (file) {
      const expectedPath = join(
        process.cwd(),
        'src/assets/images/taskbar/win32',
        file,
      );
      expect(nativeImage.createFromPath).toHaveBeenCalledWith(expectedPath);
      expect(image).toEqual({ path: expectedPath });
      expect(existsSync(expectedPath)).toBe(true);
    } else {
      expect(image).toBeNull();
    }
    expect(trayIcon.setIndicator).toHaveBeenLastCalledWith(count);
    expect(mainWindow.setIcon).toHaveBeenCalledTimes(1);
  }
});

it('reapplies the latest unread overlay after show/restore/focus without clearing it or accumulating timers', () => {
  // eslint-disable-next-line unicorn/prefer-event-target -- Electron BrowserWindow uses EventEmitter lifecycle events.
  const mainWindow: any = Object.assign(new EventEmitter(), {
    isFocused: () => true,
    isDestroyed: () => false,
    setIcon: jest.fn(),
    setOverlayIcon: jest.fn(),
  });
  const trayIcon: any = {
    show: jest.fn(),
    hide: jest.fn(),
    setIndicator: jest.fn(),
  };
  install({ mainWindow, trayIcon, settings: { app: { get: () => true } } });
  const update = ipcMain.on.mock.calls[0][1];
  update({}, { indicator: 7 });
  jest.advanceTimersByTime(250);
  mainWindow.setOverlayIcon.mockClear();
  for (const event of ['show', 'restore', 'focus']) mainWindow.emit(event);
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(250);
  expect(mainWindow.setOverlayIcon).toHaveBeenCalledTimes(1);
  expect(mainWindow.setOverlayIcon).toHaveBeenLastCalledWith(
    expect.anything(),
    '7 条未读消息',
  );
  expect(trayIcon.setIndicator).toHaveBeenCalledTimes(1);
  expect(nativeImage.createFromPath).toHaveBeenCalledTimes(1);
  mainWindow.emit('restore');
  update({}, { indicator: 0 });
  jest.advanceTimersByTime(250);
  expect(mainWindow.setOverlayIcon).toHaveBeenLastCalledWith(null, '');
  mainWindow.emit('focus');
  mainWindow.emit('closed');
  const calls = mainWindow.setOverlayIcon.mock.calls.length;
  jest.advanceTimersByTime(1000);
  expect(mainWindow.setOverlayIcon).toHaveBeenCalledTimes(calls);
  expect(jest.getTimerCount()).toBe(0);
  expect(ipcMain.removeListener).toHaveBeenCalledWith(
    'updateAppIndicator',
    update,
  );
  expect(mainWindow.listenerCount('restore')).toBe(0);
});
