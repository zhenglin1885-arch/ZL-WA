/* eslint-disable no-void, no-await-in-loop, no-continue -- Bounded workers and readiness polling intentionally serialize per-account operations. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';
import { readCustomerContext } from '../customers/guest';
import type { CustomerBundle, CustomerContext } from '../customers/types';
import { normalizeAccountConfig } from '../accounts/state';
import { configureWhatsAppLayout } from '../accounts/layout';
import {
  readConversationIndex,
  setAggregateChatMode,
  readConversationAvatars,
} from './guest';
import type { AggregateConversation, ConversationItem } from './types';

export class ConversationRuntime {
  listeners = new Set<() => void>();

  snapshots = new Map<string, AggregateConversation[]>();

  errors = new Map<string, string>();

  refreshing = false;

  checked = 0;

  total = 0;

  version = 0;

  avatars = new Map<string, string>();

  private avatarAttempts = new Map<string, number>();

  private avatarBusy = false;

  private timer?: ReturnType<typeof setInterval>;

  private generation = 0;

  private active = false;

  private opening = 0;

  private layoutViews = new Set<Electron.WebviewTag>();

  constructor(
    private stores: RealStores,
    private activate: (id: string) => void,
  ) {}

  notify() {
    for (const listener of this.listeners) listener();
  }

  get rows() {
    return [...this.snapshots.values()].flat();
  }

  private async bounded<T>(work: Promise<T>, limit = 6000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('会话读取超时，请检查账号连接')),
            limit,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async read(
    service: RealStores['services']['all'][number],
    generation: number,
  ) {
    const view = service.webview;
    if (!view) return;
    const valid = () =>
      this.active &&
      generation === this.generation &&
      service.webview === view &&
      this.stores.services.all.includes(service);
    try {
      const result: {
        context: CustomerContext;
        index: ReturnType<typeof readConversationIndex>;
      } = await this.bounded(
        view.executeJavaScript(
          `(()=>{const context=(${readCustomerContext.toString()})();return {context,index:(${readConversationIndex.toString()})()};})()`,
        ),
      );
      if (!valid()) return;
      if (result.context.owners.length === 0) {
        this.snapshots.delete(service.id);
        this.errors.set(service.id, '等待登录或账号身份同步');
        return;
      }
      const bundle: CustomerBundle = await this.bounded(
        ipcRenderer.invoke('customers-bind', result.context.owners),
      );
      if (!valid()) return;
      const profiles = normalizeAccountConfig(
        this.stores.settings.app.accountSidebar,
      ).accounts;
      const prefs = profiles[service.id];
      const rows = result.index.rows.map((row: ConversationItem) => {
        const canonical =
          (row.group ? row.id : row.aliases.find(id => id.endsWith('@c.us'))) ||
          bundle.aliases[row.id] ||
          row.id;
        const summary = bundle.summaries[canonical] || bundle.summaries[row.id];
        return {
          ...row,
          key: `${service.id}:${bundle.owner}:${row.id}`,
          membershipKey: `${bundle.owner}:${canonical}`,
          accountId: service.id,
          owner: bundle.owner,
          ownerAliases: bundle.ownerAliases || result.context.owners,
          accountName:
            prefs?.nickname || service.accountSnapshot.nickname || service.name,
          accountRemark: prefs?.remark || '',
          remark: summary?.remarkName || '',
        };
      });
      if (
        JSON.stringify(this.snapshots.get(service.id)) !== JSON.stringify(rows)
      )
        this.snapshots.set(service.id, rows);
      if (result.index.contactsReady) {
        this.errors.delete(service.id);
      } else {
        this.errors.set(service.id, '会话已载入，通讯录仍在同步');
      }
    } catch (error) {
      if (valid())
        this.errors.set(
          service.id,
          error instanceof Error ? error.message : '读取会话失败',
        );
    }
  }

  async refresh() {
    if (!this.active || this.refreshing) return;
    const { generation } = this;
    this.refreshing = true;
    this.checked = 0;
    const eligible = this.stores.services.all.filter(
      s => s.recipe.id === 'whatsapp' && s.isEnabled,
    );
    const eligibleIds = new Set(eligible.map(s => s.id));
    for (const id of this.errors.keys())
      if (!eligibleIds.has(id)) this.errors.delete(id);
    for (const service of eligible) {
      if (service.isHibernating)
        this.errors.set(service.id, '账号已休眠，请在账户列表唤醒后刷新');
      else if (!service.webview)
        this.errors.set(service.id, '等待账号页面载入');
    }
    const all = eligible.filter(s => !s.isHibernating && s.webview);
    const ids = new Set(all.map(s => s.id));
    for (const id of this.snapshots.keys())
      if (!ids.has(id)) this.snapshots.delete(id);
    this.total = all.length;
    this.notify();
    let cursor = 0;
    const worker = async () => {
      while (
        cursor < all.length &&
        this.active &&
        generation === this.generation
      ) {
        const service = all[cursor];
        cursor += 1;
        await this.read(service, generation);
        this.checked += 1;
        if (this.active && generation === this.generation) this.notify();
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, all.length) }, worker),
      );
      if (this.active && generation === this.generation)
        await this.syncLayout();
    } finally {
      if (generation === this.generation) {
        this.refreshing = false;
        this.version += 1;
        this.notify();
      }
    }
  }

  async loadAvatars(rows: AggregateConversation[]) {
    if (!this.active || this.avatarBusy) return;
    this.avatarBusy = true;
    const { generation } = this;
    try {
      const pending = rows.filter(
        row =>
          !this.avatars.has(row.key) &&
          Date.now() - (this.avatarAttempts.get(row.key) || 0) > 30_000,
      );
      const accounts = [...new Set(pending.map(row => row.accountId))];
      let cursor = 0;
      const worker = async () => {
        while (
          cursor < accounts.length &&
          this.active &&
          this.generation === generation
        ) {
          const id = accounts[cursor];
          cursor += 1;
          const selected = pending
            .filter(row => row.accountId === id)
            .slice(0, 24);
          selected.forEach(row => this.avatarAttempts.set(row.key, Date.now()));
          const view = this.stores.services.all.find(
            service => service.id === id,
          )?.webview;
          if (!view) continue;
          try {
            const values: Record<string, string> = await this.bounded(
              view.executeJavaScript(
                `(${readConversationAvatars.toString()})(${JSON.stringify(selected.map(row => row.id))},${JSON.stringify(selected[0].ownerAliases)})`,
              ),
            );
            if (!this.active || this.generation !== generation) return;
            for (const row of selected)
              if (
                typeof values[row.id] === 'string' &&
                values[row.id].length < 80_000 &&
                values[row.id].startsWith('data:image/jpeg;base64,')
              )
                this.avatars.set(row.key, values[row.id]);
            while (this.avatars.size > 200)
              this.avatars.delete(this.avatars.keys().next().value!);
            while (this.avatarAttempts.size > 2000)
              this.avatarAttempts.delete(
                this.avatarAttempts.keys().next().value!,
              );
            this.notify();
          } catch {
            /* Keep initials when a cached profile image cannot be read. */
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(2, accounts.length) }, worker),
      );
    } finally {
      this.avatarBusy = false;
    }
  }

  async syncLayout() {
    const current = this.stores.services.active?.webview;
    for (const view of this.layoutViews)
      if (view !== current) {
        this.layoutViews.delete(view);
        void view
          .executeJavaScript(`(${setAggregateChatMode.toString()})(false)`)
          .catch(() => {});
      }
    if (
      this.active &&
      current &&
      this.stores.services.active?.recipe.id === 'whatsapp'
    ) {
      this.layoutViews.add(current);
      await this.bounded(
        current.executeJavaScript(
          `(()=>{(${configureWhatsAppLayout.toString()})();return (${setAggregateChatMode.toString()})(true);})()`,
        ),
      ).catch(() => {});
    }
  }

  async open(row: AggregateConversation) {
    this.opening += 1;
    const sequence = this.opening;
    const service = this.stores.services.all.find(s => s.id === row.accountId);
    if (!service?.isEnabled) throw new Error('所属账号已删除或停用');
    if (service.isHibernating)
      this.stores.services._awake({ serviceId: service.id });
    this.activate(service.id);
    await this.syncLayout();
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      if (
        !this.active ||
        sequence !== this.opening ||
        this.stores.services.active !== service
      )
        return;
      const view = service.webview;
      if (view && !service.isLoading && !service.isError) {
        await this.bounded(ensureBulkLibrary(view), 20_000);
        if (
          !this.active ||
          sequence !== this.opening ||
          this.stores.services.active !== service ||
          service.webview !== view
        )
          return;
        await this.bounded(
          view.executeJavaScript(
            `(async()=>{const context=(${readCustomerContext.toString()})();if(!context.owners.some(id=>${JSON.stringify(row.ownerAliases)}.includes(id)))throw new Error('账号身份已改变，请刷新聚合会话');await window.WPP.chat.openChatBottom(${JSON.stringify(row.id)},'Chatlist');return true;})()`,
          ),
        );
        await this.syncLayout();
        return;
      }
      await new Promise(resolve => {
        setTimeout(resolve, 250);
      });
    }
    throw new Error('所属账号尚未就绪，请先检查账号连接');
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.generation += 1;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5000);
  }

  dispose() {
    this.active = false;
    this.generation += 1;
    this.opening += 1;
    this.refreshing = false;
    clearInterval(this.timer);
    for (const view of this.layoutViews)
      void view
        .executeJavaScript(`(${setAggregateChatMode.toString()})(false)`)
        .catch(() => {});
    this.layoutViews.clear();
    this.snapshots.clear();
    this.avatars.clear();
    this.avatarAttempts.clear();
  }
}
