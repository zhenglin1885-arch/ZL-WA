/* eslint-disable no-void, no-await-in-loop -- History reads and writes are sequential and cancellable. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';
import { captureChat } from './guest';
import type { BackupState } from './types';

export class BackupRuntime {
  active = '';

  progress = '';

  stopped = false;

  error = '';

  listeners = new Set<() => void>();

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private seenPages = new Set<string>();

  private async read(service: any, input: any, expectedOwner?: string) {
    const view = service.webview;
    const { ownerId } = service.accountSnapshot;
    if (expectedOwner && ownerId !== expectedOwner)
      throw new Error('账号身份已变化，已停止同步');
    if (
      !view ||
      !service.isEnabled ||
      service.isHibernating ||
      service.accountSnapshot.status !== 'online' ||
      !ownerId
    )
      throw new Error('请先登录并打开 WhatsApp 账号');
    // Passive saving uses native loaded models; only explicit history sync initializes WA-JS.
    if (input.mode === 'history' || input.mode === 'list')
      await ensureBulkLibrary(view);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        view.executeJavaScript(
          `(${captureChat.toString()})(${JSON.stringify({ ...input, ownerId, accountName: service.accountSnapshot.nickname || service.name })})`,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('读取聊天超时，请检查网络后重试')),
            45_000,
          );
        }),
      ]);
      if (
        service.webview !== view ||
        service.isHibernating ||
        !service.isEnabled ||
        service.accountSnapshot.ownerId !== ownerId
      )
        throw new Error('账号身份已变化，已停止保存');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async capture(service: any) {
    const result = await this.read(service, { mode: 'opened' });
    if (result?.packet?.messages.length) {
      const state: BackupState = await ipcRenderer.invoke(
        'chat-backup-save',
        service.id,
        result.packet,
      );
      if (state.config.enabled && result.receipts?.length)
        await this.read(
          service,
          { mode: 'ack', receipts: result.receipts },
          result.packet.ownerId,
        );
    }
  }

  stop() {
    this.stopped = true;
    this.progress = '正在停止，等待当前读取结束…';
    this.notify();
  }

  async synchronize(stores: RealStores, id: string) {
    if (this.active) throw new Error('请先停止或等待当前同步完成');
    const services = stores.services.all.filter(
      service =>
        (id === 'all' || service.id === id) &&
        service.recipe.id === 'whatsapp' &&
        service.isEnabled &&
        !service.isHibernating &&
        service.accountSnapshot.status === 'online',
    );
    if (services.length === 0)
      throw new Error('没有可同步的在线 WhatsApp 账号');
    this.active = id;
    this.stopped = false;
    this.error = '';
    this.seenPages.clear();
    this.progress = '正在读取对话列表…';
    this.notify();
    let saved = 0;
    const failures: string[] = [];
    try {
      const state: BackupState = await ipcRenderer.invoke('chat-backup-state');
      if (!state.config.enabled) throw new Error('请先开启保存聊天记录');
      for (const [accountIndex, service] of services.entries()) {
        if (this.stopped) break;
        this.seenPages.clear();
        const prefix = `账号 ${accountIndex + 1}/${services.length} ${service.accountSnapshot.nickname || service.name}：`;
        this.progress = `${prefix}正在读取对话列表…`;
        this.notify();
        try {
          const { ownerId } = service.accountSnapshot;
          const chats = await this.read(service, { mode: 'list' }, ownerId);
          for (const [index, chat] of chats.entries()) {
            if (this.stopped) break;
            let before: string | undefined;
            for (let page = 0; page < 10_000 && !this.stopped; page += 1) {
              if (
                !stores.settings.app ||
                service.accountSnapshot.status !== 'online' ||
                service.isHibernating ||
                !service.isEnabled
              )
                throw new Error('账号离线，已停止同步');
              this.progress = `${prefix}${index + 1}/${chats.length}：${chat.name}，本次读取 ${saved} 条消息`;
              this.notify();
              const result = await this.read(
                service,
                {
                  mode: 'history',
                  chatId: chat.id,
                  chatName: chat.name,
                  before,
                  cutoff: state.config.retentionDays
                    ? Date.now() - state.config.retentionDays * 86_400_000
                    : undefined,
                },
                ownerId,
              );
              if (result?.packet?.messages.length) {
                const written: BackupState = await ipcRenderer.invoke(
                  'chat-backup-save',
                  service.id,
                  result.packet,
                );
                if (!written.config.enabled) {
                  this.stopped = true;
                  throw new Error('保存聊天记录已关闭，停止同步');
                }
                saved += result.packet.messages.length;
              }
              const key = `${chat.id}:${result?.nextBefore}`;
              if (
                !result ||
                result.complete ||
                !result.nextBefore ||
                this.seenPages.has(key)
              )
                break;
              this.seenPages.add(key);
              before = result.nextBefore;
              // Yield between pages; stop never submits or sends a WhatsApp message.
              await new Promise(resolve => {
                setTimeout(resolve, 250);
              });
            }
          }
        } catch (error) {
          failures.push(
            `${service.accountSnapshot.nickname || service.name}：${String(error)}`,
          );
        }
      }
      this.error = failures.join('；');
      this.progress = this.stopped
        ? `已停止，本次读取 ${saved} 条消息`
        : `同步结束${failures.length > 0 ? `，${failures.length} 个账号未完成` : ''}，本次读取 ${saved} 条消息；仅包含网页版可获取的历史`;
    } catch (error) {
      this.error = String(error);
      this.progress = '同步中断，可重新开始，已保存内容保留';
    } finally {
      this.active = '';
      this.notify();
    }
  }
}
const runtimes = new WeakMap<RealStores, BackupRuntime>();
export function backupRuntime(stores: RealStores) {
  if (!runtimes.has(stores)) runtimes.set(stores, new BackupRuntime());
  return runtimes.get(stores)!;
}
export function startChatBackup(stores: RealStores) {
  const runtime = backupRuntime(stores);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running || runtime.active) return;
    const service = stores.services.active;
    if (
      !service ||
      service.recipe.id !== 'whatsapp' ||
      !service.isEnabled ||
      service.isHibernating ||
      service.isLoading ||
      service.accountSnapshot.status !== 'online'
    )
      return;
    running = true;
    try {
      const state: BackupState = await ipcRenderer.invoke('chat-backup-state');
      if (state.config.enabled && !stopped) await runtime.capture(service);
    } catch {
      /* State exposes disk/encryption errors; a navigation is retried next tick. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 2000);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (runtime.active) runtime.stop();
  };
}
