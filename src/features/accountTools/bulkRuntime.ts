import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import type { Recipient } from './config';
import BulkQueue from './BulkQueue';
import { sendTextToChat } from './guest';
import {
  sendBulkMessage,
  revokeBulkMessage,
  reconcileBulkMessage,
  editBulkMessage,
} from './bulkGuest';

let library: Promise<string> | undefined;
const queues = new WeakMap<RealStores, BulkQueue>();
const libraryInitializations = new WeakMap<
  Electron.WebviewTag,
  Promise<void>
>();
export async function ensureBulkLibrary(view: Electron.WebviewTag) {
  const pending = libraryInitializations.get(view);
  if (pending) {
    await pending;
    return;
  }
  const initialization = (async () => {
    if (
      await view.executeJavaScript("location.hostname !== 'web.whatsapp.com'")
    )
      throw new Error('当前会话不是 WhatsApp');
    if (!(await view.executeJavaScript('Boolean(window.WPP)'))) {
      library ??= ipcRenderer.invoke('account-tools-library');
      await view.executeJavaScript(await library!);
    }
    if (
      !(await view.executeJavaScript(
        'new Promise(resolve => { const until = Date.now() + 15000; const check = () => { if (window.WPP?.isReady) resolve(true); else if (Date.now() > until) resolve(false); else setTimeout(check, 200); }; check(); })',
      ))
    )
      throw new Error('WhatsApp 接口未就绪，请刷新账号再试');
  })();
  libraryInitializations.set(view, initialization);
  try {
    await initialization;
  } finally {
    if (libraryInitializations.get(view) === initialization)
      libraryInitializations.delete(view);
  }
}

export function getBulkQueue(stores: RealStores): BulkQueue {
  if (!queues.has(stores)) {
    const viewFor = (target: Recipient) => {
      const service = stores.services.all.find(s => s.id === target.accountId);
      if (
        !service?.webview ||
        !service.isEnabled ||
        service.isHibernating ||
        service.accountSnapshot.status !== 'online'
      )
        throw new Error('账号已离线或休眠');
      return service.webview;
    };
    queues.set(
      stores,
      new BulkQueue({
        load: () => ipcRenderer.invoke('account-tools-history'),
        save: record => ipcRenderer.invoke('account-tools-history', record),
        remove: ids => ipcRenderer.invoke('account-tools-history-delete', ids),
        send: async (target, spec) => {
          const view = viewFor(target);
          // Retain the small, tested text adapter for ordinary text sends.
          if (
            spec.type === 'text' &&
            !spec.mentionAll &&
            spec.typingSeconds === 0 &&
            !target.contactOnly
          )
            return view.executeJavaScript(
              `(${sendTextToChat.toString()})(${JSON.stringify(target.id)},${JSON.stringify(spec.text)})`,
            );
          await ensureBulkLibrary(view);
          const dataUrl = spec.media
            ? await ipcRenderer.invoke(
                'account-tools-media-read',
                spec.media.id,
              )
            : undefined;
          if (viewFor(target) !== view)
            throw new Error('账号窗口已变化，请重新检查');
          return view.executeJavaScript(
            `(${sendBulkMessage.toString()})(${JSON.stringify(target.id)},${JSON.stringify({ ...spec, targets: [target] })},${JSON.stringify(dataUrl)})`,
          );
        },
        reconcile: async (target, messageId, spec, started, ended) => {
          const view = viewFor(target);
          await ensureBulkLibrary(view);
          if (viewFor(target) !== view)
            throw new Error('账号窗口已变化，请重新核对');
          return view.executeJavaScript(
            `(${reconcileBulkMessage.toString()})(${JSON.stringify(target.id)},${JSON.stringify(messageId)},${JSON.stringify(spec)},${JSON.stringify(started)},${JSON.stringify(ended)})`,
          );
        },
        edit: async (target, messageId, text) => {
          const view = viewFor(target);
          await ensureBulkLibrary(view);
          if (viewFor(target) !== view)
            throw new Error('账号窗口已变化，请重新检查');
          await view.executeJavaScript(
            `(${editBulkMessage.toString()})(${JSON.stringify(target.id)},${JSON.stringify(messageId)},${JSON.stringify(text)})`,
          );
        },
        revoke: async (target, messageId) => {
          const view = viewFor(target);
          await ensureBulkLibrary(view);
          await view.executeJavaScript(
            `(${revokeBulkMessage.toString()})(${JSON.stringify(target.id)},${JSON.stringify(messageId)})`,
          );
        },
      }),
    );
  }
  return queues.get(stores)!;
}
