import { ipcRenderer } from 'electron';

import { v4 as uuidV4 } from 'uuid';

export class NotificationsHandler {
  onNotify = (data: { title: string; options: any; notificationId: string }) =>
    data;

  private pending = new Map<string, { finish: (clicked: boolean) => void }>();

  dispose() {
    for (const item of this.pending.values()) item.finish(false);
  }

  displayNotification(title: string, options: any): Promise<boolean> {
    return new Promise(resolve => {
      const notificationId = uuidV4();
      const clickChannel = `notification-onclick:${notificationId}`;
      const closeChannel = `notification-onclose:${notificationId}`;
      const callbacks: { click: () => void; close: () => void } = {
        click: () => {},
        close: () => {},
      };
      const finish = (value: boolean) => {
        if (!this.pending.delete(notificationId)) return;
        ipcRenderer.removeListener(clickChannel, callbacks.click);
        ipcRenderer.removeListener(closeChannel, callbacks.close);
        resolve(value);
      };
      callbacks.click = () => finish(true);
      callbacks.close = () => finish(false);
      this.pending.set(notificationId, { finish });
      ipcRenderer.once(clickChannel, callbacks.click);
      ipcRenderer.once(closeChannel, callbacks.close);
      try {
        const value = this.onNotify({ title, options, notificationId });
        if (value) ipcRenderer.sendToHost('notification', value);
        else finish(false);
      } catch {
        finish(false);
      }
    });
  }
}

export const notificationsClassDefinition = `(() => {
// Changed the class name for clarity purpose
class WrapNotification {
  
  static permission = 'granted';

  constructor(title = '', options = {}) {
    this._onclick = null;
    this._displayNotification(title, options);
  }

  _displayNotification(title, options) {
    window.ferdium
      .displayNotification(title, options)
      .then((value) => {  
        // When clicked, the assigned onclick will execute
        if (value && typeof this._onclick === 'function')
        {
          this._onclick();
        }
      });
  }

  static requestPermission(cb) {
    if (typeof cb === 'function') {
      cb(WrapNotification.permission);
    }
    return Promise.resolve(WrapNotification.permission);
  }

  onNotify(data) {
    return data;
  }

  close() {
    if (this._notification) {
      this._notification = null;
      // Clean-up
      this._onclick = null
    }
  }

  // Monkey-patching the onclick setter method
  set onclick(callback) {
    this._onclick = callback;
  }
}

  // Copy prototype of the original Notification object before monkey-patch
  const OriginalNotification = window.Notification;
  Object.setPrototypeOf(WrapNotification.prototype, OriginalNotification.prototype);
  window.Notification = WrapNotification;

  // some sites use service workers for notifications, but electron doesn't support this
  // this is a monkey patch to redirect them to window.Notification instead
  window.ServiceWorkerRegistration.prototype.showNotification = function (
    title = '',
    options = {},
  ) {
    // passing all of options causes notifications to only appear sometimes
    // but the only option that actually matters is body
    new WrapNotification(title, { body: options.body });
  };
})();`;
