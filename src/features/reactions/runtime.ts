import { protocolRequest, protocolTarget } from '../protocol/client';
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';

import type { GroupTarget } from '../groups/types';
import ReactionQueue from './ReactionQueue';
import { reactionGuest } from './guest';
import { prepareReactionImage } from './image';
import { encodeReactionState, decodeReactionState } from './types';
import type {
  ReactionMatch,
  ReactionPreferences,
  ReactionResult,
  ReactionTask,
} from './types';

export class ReactionRuntime {
  queue: ReactionQueue;

  private pendingMutation?: Promise<any>;

  constructor(private stores: RealStores) {
    this.queue = new ReactionQueue({
      load: async () =>
        decodeReactionState(
          await ipcRenderer.invoke('reaction-tools-load', 'compact'),
        ),
      save: state =>
        ipcRenderer.invoke('reaction-tools-save', encodeReactionState(state)),
      execute: (task, rules) => this.execute(task, rules),
      check: (task, rules) => this.check(task, rules),
    });
  }

  private viewFor(target: GroupTarget) {
    const s = this.stores.services.all.find(s => s.id === target.accountId);
    if (
      !s?.webview ||
      s.recipe.id !== 'whatsapp' ||
      !s.isEnabled ||
      s.isHibernating ||
      s.accountSnapshot.status !== 'online'
    )
      throw new Error('账号已离线或休眠');
    if (
      ![
        s.accountSnapshot.ownerId,
        ...(s.accountSnapshot.ownerIds || []),
      ].includes(target.ownerId)
    )
      throw new Error('账号登录身份已变化，请重新选择');
    return s.webview as unknown as Electron.WebviewTag;
  }

  private async protocolRequest(
    target: GroupTarget,
    rules: ReactionPreferences,
    task?: ReactionTask,
    verifyOnly = false,
  ) {
    const service = this.stores.services.all.find(
      s => s.id === target.accountId,
    );
    protocolTarget(service, target.ownerId);
    if (rules.content === 'image' && !task) {
      if (!rules.picture) return { error: '请选择参考图片' };
      const candidates = await protocolRequest(
        target.accountId,
        'reaction-candidates',
        { jid: target.target, owner: target.ownerId },
      );
      for (const candidate of candidates) {
        const data = await protocolRequest(target.accountId, 'media', {
          jid: target.target,
          id: candidate.messageId,
          owner: target.ownerId,
        });
        protocolTarget(service, target.ownerId);
        const bytes = Uint8Array.from(atob(data.data), character =>
          character.charCodeAt(0),
        );
        const image = await prepareReactionImage(
          new Blob([bytes], { type: data.mime }),
          rules.picture,
        );
        if (image.matches) return { ...candidate, imagePreview: image.preview };
      }
      return { error: '当前已同步消息中未找到匹配图片' };
    }
    return protocolRequest(target.accountId, 'reaction', {
      jid: target.target,
      owner: target.ownerId,
      rules,
      task,
      verifyOnly,
    });
  }

  private async request(
    target: GroupTarget,
    rules: ReactionPreferences,
    task?: ReactionTask,
    verifyOnly = false,
  ) {
    const service = this.stores.services.all.find(
      s => s.id === target.accountId,
    );
    if (service?.isProtocol) {
      protocolTarget(service, target.ownerId);
      return this.protocolRequest(target, rules, task, verifyOnly);
    }
    const view = this.viewFor(target);
    await ensureBulkLibrary(view);
    if (view !== this.viewFor(target)) throw new Error('账号窗口已变化');
    return view.executeJavaScript(
      `(${reactionGuest.toString()})(${JSON.stringify({ ownerId: target.ownerId, groupId: target.target, rules, verifyOnly, ...(task ? { messageId: task.messageId, expectedText: task.text, expectedImageHash: task.imageHash, emoji: task.emoji, token: task.id } : {}) })}, ${prepareReactionImage.toString()})`,
    );
  }

  private async bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>(resolve => {
          timer = setTimeout(() => resolve(fallback), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async findMessage(
    target: GroupTarget,
    rules: ReactionPreferences,
  ): Promise<ReactionMatch> {
    try {
      const result = await this.bounded(this.request(target, rules), {
        error: '查找消息超时，请稍后重试',
      });
      return { ...target, ...result };
    } catch (error) {
      return { ...target, error: String(error).slice(0, 2000) };
    }
  }

  private async execute(
    task: ReactionTask,
    rules: ReactionPreferences,
  ): Promise<ReactionResult> {
    const service = this.stores.services.all.find(s => s.id === task.accountId);
    if (service?.isProtocol) {
      protocolTarget(service, task.ownerId);
      try {
        return await this.protocolRequest(task, rules, task);
      } catch (error) {
        return { status: 'uncertain', message: String(error) };
      }
    }
    if (this.pendingMutation)
      return {
        status: 'failed',
        message: '上个点赞请求仍在处理中，已停止本批次，未发送新请求',
        inFlight: true,
      };
    let dispatched = false;
    try {
      const view = this.viewFor(task);
      const prepared = await this.bounded(
        ensureBulkLibrary(view).then(() => true),
        false,
      );
      if (!prepared)
        return { status: 'failed', message: '点赞接口准备超时，未发送' };
      if (view !== this.viewFor(task)) throw new Error('账号窗口已变化');
      // eslint-disable-next-line sonar/no-dead-store -- Catch must distinguish a dispatched request from a preflight failure.
      dispatched = true;
      const pending = view.executeJavaScript(
        `(${reactionGuest.toString()})(${JSON.stringify({ ownerId: task.ownerId, groupId: task.target, rules, messageId: task.messageId, expectedText: task.text, expectedImageHash: task.imageHash, emoji: task.emoji, token: task.id })}, ${prepareReactionImage.toString()})`,
      );
      this.pendingMutation = pending;
      const clear = () => {
        if (this.pendingMutation === pending) this.pendingMutation = undefined;
      };
      pending.then(clear, clear);
      return await this.bounded(pending, {
        status: 'uncertain',
        message: '发送请求超时，结果未确认，已停止本批次且不会自动重发',
        inFlight: true,
      });
    } catch (error) {
      return {
        status: dispatched ? 'uncertain' : 'failed',
        message: String(error).slice(0, 1500),
      };
    }
  }

  private async check(
    task: ReactionTask,
    rules: ReactionPreferences,
  ): Promise<ReactionResult> {
    try {
      return await this.bounded(this.request(task, rules, task, true), {
        status: 'uncertain',
        message: '只读核验超时，未重发任何表情',
      });
    } catch (error) {
      return {
        status: 'uncertain',
        message: `只读核验失败：${String(error).slice(0, 1000)}；未重发`,
      };
    }
  }
}
const runtimes = new WeakMap<RealStores, ReactionRuntime>();
export function getReactionRuntime(stores: RealStores) {
  let runtime = runtimes.get(stores);
  if (!runtime) {
    runtime = new ReactionRuntime(stores);
    runtimes.set(stores, runtime);
  }
  return runtime;
}

export { getGroupRuntime } from '../groups/runtime';
