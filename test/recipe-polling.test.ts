/* eslint-disable unicorn/prefer-event-target -- Electron IPC uses EventEmitter subscriptions. */
/* eslint-disable global-require -- Load the recipe after installing native IPC mocks. */
import { EventEmitter } from 'node:events';

let ipc: any;
let Recipe: any;
beforeEach(() => {
  jest.resetModules();
  ipc = new EventEmitter();
  ipc.sendToHost = jest.fn();
  jest.doMock('electron', () => ({ ipcRenderer: ipc }));
  jest.doMock('@electron/remote', () => ({ BrowserWindow: {} }));
  Recipe = require('../src/webview/lib/RecipeWebview').default;
});
afterEach(() => {
  jest.dontMock('electron');
  jest.dontMock('@electron/remote');
});
it('skips the known legacy DB reader only while native unreads are live and retains recipe heartbeats', () => {
  let live = false;
  const getMessages = jest.fn();
  const getActiveDialogTitle = jest.fn();
  const recipe = new Recipe({}, {}, {}, {}, () => live);
  recipe.loop(() => {
    getMessages();
    getActiveDialogTitle();
  });
  ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(1);
  live = true;
  for (let i = 0; i < 25; i += 1) ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(1);
  expect(ipc.sendToHost).toHaveBeenCalledTimes(26);
  live = false;
  ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(2);
  recipe.dispose();
  expect(ipc.listenerCount('poll')).toBe(0);
});
it('retains other service and custom recipe loops and disposes old reload listeners', () => {
  const custom = jest.fn();
  for (let i = 0; i < 50; i += 1) {
    const recipe = new Recipe({}, {}, {}, {}, () => true);
    recipe.loop(custom);
    ipc.emit('poll');
    recipe.dispose();
  }
  expect(custom).toHaveBeenCalledTimes(50);
  expect(ipc.listenerCount('poll')).toBe(0);
});
