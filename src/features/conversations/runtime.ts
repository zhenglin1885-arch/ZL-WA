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
  markConversationsRead,
} from './guest';
import type { AggregateConversation, ConversationItem } from './types';
import {
  normalizeConversationGroups,
  expandedConversations,
  matchesConversationKind,
} from './state';

type Account = RealStores['services']['all'][number];
type CacheSource = {
  view: Electron.WebviewTag;
  token: string;
  owners: string[];
};

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

  private wantedAvatars: AggregateConversation[] = [];

  private avatarStoredAt = new Map<string, number>();

  private sources = new Map<string, CacheSource>();

  private revisions = new Map<string, number>();

  private readJobs = new Map<string, Promise<void>>();

  private readSlots = 0;

  private readQueue: (() => void)[] = [];

  private warmQueue = new Map<string, Account>();

  private warmTimer?: ReturnType<typeof setTimeout>;

  private warming = false;

  private lastReadAt = new Map<string, number>();

  private lastWarmAttempt = new Map<string, number>();

  private timer?: ReturnType<typeof setInterval>;

  private generation = 0;

  private active = false;

  private opening = 0;

  private layoutViews = new Set<Electron.WebviewTag>();

  constructor(
    private stores: RealStores,
    private activate: (id: string) => void = () => {},
  ) {}

  notify() {
    for (const listener of this.listeners) listener();
  }

  setActivate(activate: (id: string) => void) {
    this.activate = activate;
  }

  private sourceCurrent(
    service: Account,
    source = this.sources.get(service.id),
  ) {
    if (
      service.recipe.id !== 'whatsapp' ||
      !source ||
      service.webview !== source.view ||
      !service.isEnabled ||
      service.isHibernating ||
      service.isLoading
    )
      return false;
    const profile = service.accountSnapshot;
    if (profile?.status === 'logged-out' || profile?.status === 'loading')
      return false;
    const owners = [profile?.ownerId, ...(profile?.ownerIds || [])].filter(
      Boolean,
    );
    return (
      owners.length === 0 || owners.some(id => source.owners.includes(id!))
    );
  }

  get rows() {
    return this.stores.services.all.flatMap(service =>
      this.sourceCurrent(service) ? this.snapshots.get(service.id) || [] : [],
    );
  }

  private clearAccount(id: string) {
    this.snapshots.delete(id);
    this.sources.delete(id);
    this.lastReadAt.delete(id);
    this.lastWarmAttempt.delete(id);
    for (const key of this.avatars.keys())
      if (key.startsWith(`${id}:`)) {
        this.avatars.delete(key);
        this.avatarStoredAt.delete(key);
      }
    for (const key of this.avatarAttempts.keys())
      if (key.startsWith(`${id}:`)) this.avatarAttempts.delete(key);
  }

  invalidate(id: string) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    this.clearAccount(id);
    this.readJobs.delete(id);
    this.warmQueue.delete(id);
    this.errors.delete(id);
    this.wantedAvatars = this.wantedAvatars.filter(row => row.accountId !== id);
    this.notify();
  }

  // Reuse existing account polls; no extra per-account timer or SDK initialization.
  warm(service: Account) {
    if (service.recipe.id !== 'whatsapp') return;
    if (this.sources.has(service.id) && !this.sourceCurrent(service))
      this.invalidate(service.id);
    if (
      !service.isEnabled ||
      service.isHibernating ||
      service.isLoading ||
      !service.webview ||
      service.accountSnapshot?.status !== 'online'
    )
      return;
    if (Date.now() - (this.lastReadAt.get(service.id) || 0) < 30_000) return;
    if (Date.now() - (this.lastWarmAttempt.get(service.id) || 0) < 30_000)
      return;
    this.lastWarmAttempt.set(service.id, Date.now());
    this.warmQueue.set(service.id, service);
    if (!this.warmTimer && !this.warming)
      this.warmTimer = setTimeout(() => {
        this.warmTimer = undefined;
        void this.flushWarm();
      }, 250);
  }

  private async flushWarm() {
    if (this.warming) return;
    this.warming = true;
    const { generation } = this;
    const worker = async () => {
      while (generation === this.generation && this.warmQueue.size > 0) {
        const service = this.warmQueue.values().next().value!;
        this.warmQueue.delete(service.id);
        if (
          service.isEnabled &&
          !service.isHibernating &&
          service.webview &&
          service.accountSnapshot?.status === 'online' &&
          Date.now() - (this.lastReadAt.get(service.id) || 0) >= 30_000
        ) {
          await this.read(service, generation);
          if (generation === this.generation) {
            this.notify();
            this.prefetchAvatars();
          }
        }
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      this.warming = false;
    }
  }

  private prefetchAvatars() {
    if (this.active) return;
    const folders = normalizeConversationGroups(
      this.stores.settings.app.aggregateConversations,
    );
    const rows = expandedConversations(
      folders,
      this.rows.filter(row => matchesConversationKind(row, 'all')),
    )
      .sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name))
      .slice(0, 24);
    void this.loadAvatars(rows);
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

  private read(service: Account, generation: number) {
    const existing = this.readJobs.get(service.id);
    if (existing) return existing;
    const revision = this.revisions.get(service.id) || 0;
    const work = new Promise<void>(resolve => {
      const run = () => {
        this.readSlots += 1;
        void this.readAccount(service, generation, revision)
          .catch(() => {})
          .finally(() => {
            this.readSlots -= 1;
            resolve();
            this.readQueue.shift()?.();
          });
      };
      if (this.readSlots < 3) run();
      else this.readQueue.push(run);
    });
    this.readJobs.set(service.id, work);
    void work.then(() => {
      if (this.readJobs.get(service.id) === work)
        this.readJobs.delete(service.id);
    });
    return work;
  }

  private async readAccount(
    service: Account,
    generation: number,
    revision: number,
  ) {
    const view = service.webview;
    if (!view) return;
    const valid = () =>
      generation === this.generation &&
      revision === (this.revisions.get(service.id) || 0) &&
      service.webview === view &&
      this.stores.services.all.includes(service);
    if (!valid()) return;
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
        this.clearAccount(service.id);
        this.errors.set(service.id, '等待登录或账号身份同步');
        return;
      }
      const previous = this.sources.get(service.id);
      if (
        previous &&
        (previous.token !== result.context.token ||
          !previous.owners.some(id => result.context.owners.includes(id)))
      ) {
        this.clearAccount(service.id);
        this.notify();
      }
      const bundle: CustomerBundle = await this.bounded(
        ipcRenderer.invoke('customers-bind', result.context.owners),
      );
      if (!valid()) return;
      this.sources.set(service.id, {
        view,
        token: result.context.token,
        owners: bundle.ownerAliases || result.context.owners,
      });
      this.lastReadAt.set(service.id, Date.now());
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
          ...(row.name === '号码待同步' && canonical.endsWith('@c.us')
            ? { name: canonical.split('@')[0], phone: canonical.split('@')[0] }
            : {}),
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
      if (!ids.has(id)) this.clearAccount(id);
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
    this.wantedAvatars = rows.slice(0, 48);
    if (this.avatarBusy) return;
    this.avatarBusy = true;
    const { generation } = this;
    try {
      while (generation === this.generation && this.wantedAvatars.length > 0) {
        const requested = this.wantedAvatars;
        this.wantedAvatars = [];
        const pending = requested.filter(
          row =>
            (!this.avatars.has(row.key) ||
              Date.now() - (this.avatarStoredAt.get(row.key) || 0) > 600_000) &&
            Date.now() - (this.avatarAttempts.get(row.key) || 0) > 30_000,
        );
        const accounts = [...new Set(pending.map(row => row.accountId))];
        let cursor = 0;
        const worker = async () => {
          while (cursor < accounts.length && generation === this.generation) {
            const id = accounts[cursor];
            cursor += 1;
            const selected = pending
              .filter(row => row.accountId === id)
              .slice(0, 24);
            const service = this.stores.services.all.find(
              item => item.id === id,
            );
            const source = this.sources.get(id);
            if (!service || !source || !this.sourceCurrent(service, source))
              continue;
            selected.forEach(row =>
              this.avatarAttempts.set(row.key, Date.now()),
            );
            try {
              const values: Record<string, string> = await this.bounded(
                source.view.executeJavaScript(
                  `(${readConversationAvatars.toString()})(${JSON.stringify(selected.map(row => row.id))},${JSON.stringify(selected[0].ownerAliases)})`,
                ),
              );
              if (
                generation !== this.generation ||
                !this.sourceCurrent(service) ||
                this.sources.get(id)?.token !== source.token ||
                !this.sources
                  .get(id)
                  ?.owners.some(owner => source.owners.includes(owner))
              )
                continue;
              for (const row of selected)
                if (
                  typeof values[row.id] === 'string' &&
                  values[row.id].length < 80_000 &&
                  values[row.id].startsWith('data:image/jpeg;base64,')
                ) {
                  this.avatars.delete(row.key);
                  this.avatars.set(row.key, values[row.id]);
                  this.avatarStoredAt.set(row.key, Date.now());
                }
              while (this.avatars.size > 200) {
                const key = this.avatars.keys().next().value!;
                this.avatars.delete(key);
                this.avatarStoredAt.delete(key);
              }
              while (this.avatarAttempts.size > 2000)
                this.avatarAttempts.delete(
                  this.avatarAttempts.keys().next().value!,
                );
              this.notify();
            } catch {
              /* Cached photos/initials remain visible if a thumbnail is unavailable. */
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(2, accounts.length) }, worker),
        );
      }
    } finally {
      this.avatarBusy = false;
    }
  }

  async markRead(rows: AggregateConversation[]) {
    const { generation } = this;
    let read = 0;
    let failed = 0;
    let cursor = 0;
    const accounts = [
      ...new Set(
        rows.filter(row => !row.contactOnly).map(row => row.accountId),
      ),
    ];
    const worker = async () => {
      while (
        cursor < accounts.length &&
        this.active &&
        generation === this.generation
      ) {
        const id = accounts[cursor];
        cursor += 1;
        const targets = rows.filter(
          row => row.accountId === id && !row.contactOnly,
        );
        const service = this.stores.services.all.find(item => item.id === id);
        const view = service?.webview;
        let offset = 0;
        try {
          if (!service?.isEnabled || service.isHibernating || !view)
            throw new Error('账号尚未就绪');
          while (
            offset < targets.length &&
            this.active &&
            generation === this.generation
          ) {
            if (service.webview !== view) throw new Error('账号页面已改变');
            const batch = targets.slice(offset, offset + 50);
            const result: Awaited<ReturnType<typeof markConversationsRead>> =
              await this.bounded(
                view.executeJavaScript(
                  `(()=>{(${readCustomerContext.toString()})();return (${markConversationsRead.toString()})(${JSON.stringify(batch.map(row => row.id))},${JSON.stringify(batch[0].ownerAliases)});})()`,
                ),
                12_000,
              );
            read += result.read;
            failed += result.failed;
            offset += batch.length;
            if (result.halted) {
              failed += targets.length - offset;
              break;
            }
          }
        } catch {
          failed += targets.length - offset;
        } finally {
          if (service && this.active && generation === this.generation) {
            // A pre-action scan may contain the old unread count. Do not reuse it
            // for the post-action acknowledgement refresh.
            const pending = this.readJobs.get(service.id);
            if (pending) await pending;
            await this.read(service, generation);
            this.notify();
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, accounts.length) }, worker),
    );
    return { read, failed };
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
    void this.syncLayout();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5000);
  }

  pause() {
    this.active = false;
    this.opening += 1;
    clearInterval(this.timer);
    for (const view of this.layoutViews)
      void view
        .executeJavaScript(`(${setAggregateChatMode.toString()})(false)`)
        .catch(() => {});
    this.layoutViews.clear();
  }

  dispose() {
    this.pause();
    this.generation += 1;
    this.refreshing = false;
    clearTimeout(this.warmTimer);
    this.warmTimer = undefined;
    this.warmQueue.clear();
    this.sources.clear();
    this.lastReadAt.clear();
    this.lastWarmAttempt.clear();
    this.errors.clear();
    this.revisions.clear();
    this.readJobs.clear();
    this.wantedAvatars = [];
    this.avatarStoredAt.clear();
    this.snapshots.clear();
    this.avatars.clear();
    this.avatarAttempts.clear();
  }
}

const conversationRuntimes = new WeakMap<RealStores, ConversationRuntime>();
export function getConversationRuntime(
  stores: RealStores,
  activate?: (id: string) => void,
) {
  let runtime = conversationRuntimes.get(stores);
  if (!runtime) {
    runtime = new ConversationRuntime(stores);
    conversationRuntimes.set(stores, runtime);
  }
  if (activate) runtime.setActivate(activate);
  return runtime;
}
