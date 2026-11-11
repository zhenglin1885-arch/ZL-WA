import { ipcRenderer } from 'electron';
import { runInAction } from 'mobx';
import type { RealStores } from '../../stores';
import {
  readWhatsAppSnapshot,
  mergeAccountSnapshot,
  type AccountSnapshot,
} from '../accounts/whatsapp';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';
import GroupQueue from './GroupQueue';
import { groupGuest } from './guest';
import type { GroupChoice, GroupResult, GroupTarget, GroupTask } from './types';

export class GroupRuntime {
  queue: GroupQueue;

  constructor(private stores: RealStores) {
    this.queue = new GroupQueue({
      load: () => ipcRenderer.invoke('group-tools-load'),
      save: state => ipcRenderer.invoke('group-tools-save', state),
      check: task => this.perform(task, false),
      execute: task => this.perform(task, true),
    });
  }

  async refreshAccounts(): Promise<{ refreshed: number; failed: number }> {
    const services = this.stores.services.all.filter(
      s =>
        s.recipe.id === 'whatsapp' &&
        s.isEnabled &&
        !s.isHibernating &&
        s.webview,
    );
    const results = await Promise.allSettled(
      services.map(async current => {
        const service = current;
        const view = service.webview!;
        const snapshot = await this.withTimeout<AccountSnapshot>(
          view.executeJavaScript(`(${readWhatsAppSnapshot.toString()})()`),
          '读取账号状态超时，请稍后重试',
        );
        if (
          service.webview !== view ||
          !service.isEnabled ||
          service.isHibernating
        )
          throw new Error('账号窗口已变化');
        runInAction(() => {
          service.accountSnapshot = mergeAccountSnapshot(
            service.accountSnapshot,
            snapshot,
          );
          if (
            Number.isFinite(snapshot.unreadMessages) ||
            snapshot.status === 'logged-out'
          ) {
            service.unreadDirectMessageCount = snapshot.unreadMessages ?? 0;
            service.unreadIndirectMessageCount = 0;
          }
        });
      }),
    );
    return {
      refreshed: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
    };
  }

  private async withTimeout<T>(
    request: Promise<T>,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private viewFor(target: Pick<GroupTarget, 'accountId' | 'ownerId'>) {
    const service = this.stores.services.all.find(
      s => s.id === target.accountId,
    );
    if (
      !service?.webview ||
      !service.isEnabled ||
      service.isHibernating ||
      service.recipe.id !== 'whatsapp' ||
      service.accountSnapshot.status !== 'online'
    )
      throw new Error('账号已离线或休眠，请重新登录后重试');
    const owners = [
      service.accountSnapshot.ownerId,
      ...(service.accountSnapshot.ownerIds || []),
    ];
    if (!owners.includes(target.ownerId))
      throw new Error('账号登录身份已变化，请重新选择');
    return service.webview as unknown as Electron.WebviewTag;
  }

  async list(
    target: Pick<GroupTarget, 'accountId' | 'accountName' | 'ownerId'>,
  ): Promise<GroupChoice[]> {
    await this.queue.load();
    if (this.queue.speechCooldown(target.ownerId))
      throw new Error(this.queue.speechCooldownMessage(target.ownerId));
    const view = this.viewFor(target);
    await this.withTimeout(
      ensureBulkLibrary(view),
      '群组接口准备超时，请稍后重试',
    );
    if (this.viewFor(target) !== view)
      throw new Error('账号窗口已变化，请重新读取');
    const result = await this.withTimeout(
      view.executeJavaScript(
        `(${groupGuest.toString()})(${JSON.stringify({ ownerId: target.ownerId })})`,
      ),
      '读取群组超时，请点击刷新群组重试',
    );
    if (!Array.isArray(result.groups)) {
      if (result.rateLimited)
        await this.queue.noteSpeechRateLimit(target.ownerId);
      throw new Error(result.message || '读取群组失败');
    }
    return result.groups.map((g: any) => ({
      ...target,
      target: g.id,
      name: g.name,
      admin: g.admin,
      announce: g.announce,
    }));
  }

  private async perform(
    task: GroupTask,
    execute: boolean,
  ): Promise<GroupResult> {
    const view = this.viewFor(task);
    await ensureBulkLibrary(view);
    if (this.viewFor(task) !== view)
      throw new Error('账号窗口已变化，结果待核验');
    return view.executeJavaScript(
      `(${groupGuest.toString()})(${JSON.stringify({ ownerId: task.ownerId, task, execute })})`,
    );
  }
}
const runtimes = new WeakMap<RealStores, GroupRuntime>();

export function getGroupRuntime(stores: RealStores) {
  let runtime = runtimes.get(stores);
  if (!runtime) {
    runtime = new GroupRuntime(stores);
    runtimes.set(stores, runtime);
  }
  return runtime;
}
