/* eslint-disable unicorn/prefer-event-target, unicorn/prefer-add-event-listener -- Electron IPC is an EventEmitter; the legacy notification shim exposes an onclick setter. */
/* eslint-disable global-require -- Install a real EventEmitter IPC mock before loading the guest handler. */
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

let ipc: any;
let handler: any;
let definition: string;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  ipc = new EventEmitter();
  ipc.sendToHost = jest.fn();
  jest.doMock('electron', () => ({ ipcRenderer: ipc }));
  const exports = require('../src/webview/notifications');
  handler = new exports.NotificationsHandler();
  definition = exports.notificationsClassDefinition;
});
afterEach(() => {
  handler.dispose();
  jest.useRealTimers();
  jest.dontMock('electron');
});
it('removes notification listeners on dismissal and preserves normal click results', async () => {
  const dismissed = handler.displayNotification('message', { body: 'body' });
  const id = ipc.sendToHost.mock.calls[0][1].notificationId;
  ipc.emit(`notification-onclose:${id}`);
  expect(await dismissed).toBe(false);
  expect(ipc.eventNames()).toEqual([]);
  const clicked = handler.displayNotification('message', {});
  const second = ipc.sendToHost.mock.calls[1][1].notificationId;
  ipc.emit(`notification-onclick:${second}`);
  expect(await clicked).toBe(true);
  expect(ipc.eventNames()).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});
it('releases a large burst of closed notifications and all listeners on unload without expiring valid clicks', async () => {
  const pending: Promise<boolean>[] = [];
  for (let i = 0; i < 1000; i += 1)
    pending.push(handler.displayNotification('message', {}));
  expect(ipc.eventNames()).toHaveLength(2000);
  expect(jest.getTimerCount()).toBe(0);
  for (const call of ipc.sendToHost.mock.calls)
    ipc.emit(`notification-onclose:${call[1].notificationId}`);
  expect(ipc.eventNames()).toEqual([]);
  expect(await Promise.all(pending)).toEqual(
    Array.from({ length: 1000 }, () => false),
  );
  handler.displayNotification('message', {});
  handler.dispose();
  expect(ipc.eventNames()).toEqual([]);
});
it('does not call a site click handler when a notification is dismissed or expires', async () => {
  const page: any = {
    Notification: Object,
    ServiceWorkerRegistration: { prototype: {} },
    ferdium: { displayNotification: jest.fn(async () => false) },
  };
  vm.runInNewContext(definition, { window: page });
  const item = new page.Notification('message', {});
  const clicked = jest.fn();
  item.onclick = clicked;
  await Promise.resolve();
  await Promise.resolve();
  expect(clicked).not.toHaveBeenCalled();
  page.ferdium.displayNotification.mockResolvedValue(true);
  const other = new page.Notification('message', {});
  other.onclick = clicked;
  await Promise.resolve();
  await Promise.resolve();
  expect(clicked).toHaveBeenCalledTimes(1);
});
