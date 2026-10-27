/* eslint-disable no-await-in-loop, no-continue, no-void -- Persist checkpoints before each sequential scheduled mutation; run reports its own errors. */
import {
  defaultReactionState,
  validateReactionPreferences,
  validateReactionState,
  type ReactionState,
  type ReactionMatch,
  type ReactionPreferences,
  type ReactionResult,
  type ReactionTask,
} from './types';

interface Dependencies {
  load: () => Promise<ReactionState>;
  save: (state: ReactionState) => Promise<unknown>;
  execute: (
    task: ReactionTask,
    rules: ReactionPreferences,
  ) => Promise<ReactionResult>;
  now?: () => number;
  random?: () => number;
  wait?: (ms: number) => Promise<void>;
}
export default class ReactionQueue {
  state = defaultReactionState();

  active = '';

  error = '';

  listeners = new Set<() => void>();

  private loaded?: Promise<void>;

  private saving = Promise.resolve();

  private interrupted = false;

  private wake?: () => void;

  private starting = false;

  constructor(private deps: Dependencies) {}

  private now = () => (this.deps.now || Date.now)();

  private random = () =>
    Math.min(0.999_999_999, Math.max(0, (this.deps.random || Math.random)()));

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private async save() {
    const snapshot = validateReactionState(this.state);
    const next = this.saving.then(() => this.deps.save(snapshot));
    this.saving = next.then(
      () => {},
      () => {},
    );
    await next;
    this.emit();
  }

  load() {
    this.loaded ??= (async () => {
      this.state = validateReactionState(await this.deps.load());
      for (const b of this.state.batches)
        for (const t of b.tasks) {
          if (t.status === 'running') {
            t.status = 'uncertain';
            t.result = '软件上次退出时请求未完成，未自动重发';
          }
        }
      // Queued schedules require an explicit resume after an application restart.
      await this.save();
    })().catch(error => {
      this.loaded = undefined;
      throw error;
    });
    return this.loaded;
  }

  async start(matches: ReactionMatch[], input: ReactionPreferences) {
    if (this.active || this.starting) throw new Error('已有点赞任务正在执行');
    this.starting = true;
    try {
      await this.load();
      const rules = validateReactionPreferences(input);
      if (!rules.text.trim() || matches.length === 0 || matches.length > 1000)
        throw new Error('请先查找消息，最多执行1000个账号群组对象');
      if (
        new Set(matches.map(m => `${m.accountId}:${m.ownerId}:${m.target}`))
          .size !== matches.length
      )
        throw new Error('同一账号群组不能重复执行');
      const ready = matches.filter(m => m.messageId && !m.error);
      if (ready.length === 0) throw new Error('没有可执行的匹配消息');
      const now = this.now();
      const beginning = Math.max(now, rules.start);
      if (
        rules.timing === 'window' &&
        rules.end - beginning < ready.length * 1000
      )
        throw new Error('可用时间段不足，请延长结束时间（每项至少留出1秒）');
      const batchId = `${now}-${this.random().toString(36).slice(2, 10)}`;
      const shuffled = [...matches];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let at = now;
      let slot = 0;
      const tasks: ReactionTask[] = shuffled.map((m, i) => {
        const usable = Boolean(m.messageId && !m.error);
        if (usable) {
          if (rules.timing === 'window') {
            const width = (rules.end - beginning) / ready.length;
            at = Math.floor(
              beginning +
                slot * width +
                this.random() * Math.max(0, width - 1000),
            );
          } else
            at +=
              (rules.minSeconds +
                this.random() * (rules.maxSeconds - rules.minSeconds)) *
              1000;
          slot += 1;
        }
        return {
          ...m,
          id: `${batchId}-${i}`,
          emoji: rules.emojis[Math.floor(this.random() * rules.emojis.length)],
          plannedAt: at,
          status: usable ? 'queued' : 'failed',
          result: usable ? '等待计划时间' : m.error || '未找到匹配消息',
        };
      });
      this.state.preferences = rules;
      this.state.batches = [
        { id: batchId, created: now, rules, tasks },
        ...this.state.batches,
      ].slice(0, 20);
      await this.save();
      this.resume(batchId);
      return batchId;
    } finally {
      this.starting = false;
    }
  }

  resume(id: string) {
    if (this.active) throw new Error('已有点赞任务正在执行');
    if (!this.state.batches.some(b => b.id === id))
      throw new Error('任务不存在');
    this.active = id;
    this.interrupted = false;
    this.error = '';
    this.emit();
    void this.run(id);
  }

  stop() {
    this.interrupted = true;
    this.wake?.();
    this.emit();
  }

  private async delay(ms: number) {
    if (this.deps.wait) {
      await this.deps.wait(ms);
      return;
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(
        () => {
          this.wake = undefined;
          resolve();
        },
        Math.min(ms, 60_000),
      );
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }

  private async run(id: string) {
    try {
      const batch = this.state.batches.find(b => b.id === id)!;
      let previousFinished = 0;
      for (const task of batch.tasks
        .filter(t => t.status === 'queued')
        .sort((a, b) => a.plannedAt - b.plannedAt)) {
        if (previousFinished) {
          const minimum =
            batch.rules.timing === 'interval'
              ? (batch.rules.minSeconds +
                  this.random() *
                    (batch.rules.maxSeconds - batch.rules.minSeconds)) *
                1000
              : 1000;
          task.plannedAt = Math.max(task.plannedAt, previousFinished + minimum);
        }
        while (!this.interrupted && this.now() < task.plannedAt) {
          await this.delay(task.plannedAt - this.now());
        }
        if (this.interrupted) break;
        if (batch.rules.timing === 'window' && this.now() >= batch.rules.end) {
          task.status = 'failed';
          task.result = '已超过设定结束时间，未补发';
          await this.save();
          continue;
        }
        task.status = 'running';
        task.result = '正在发送表情';
        await this.save();
        if (this.interrupted) {
          task.status = 'stopped';
          task.result = '已停止，未发送';
          break;
        }
        let result: ReactionResult;
        try {
          result = await this.deps.execute(task, batch.rules);
        } catch (error) {
          result = {
            status: 'uncertain',
            message: `接口结果未确认：${String(error).slice(0, 1000)}；未自动重发`,
          };
        }
        task.status = result.status;
        task.result = result.message.slice(0, 2000);
        previousFinished = this.now();
        await this.save();
        if (result.inFlight) {
          this.interrupted = true;
          this.error = '有请求仍在执行，本批次已停止，避免同时触发';
        }
      }
      if (this.interrupted) {
        for (const t of batch.tasks)
          if (t.status === 'queued') {
            t.status = 'stopped';
            t.result = '已停止，未发送';
          }
        await this.save();
      }
    } catch (error) {
      this.error = `任务已暂停：${String(error).slice(0, 1500)}`;
      const batch = this.state.batches.find(b => b.id === id);
      for (const task of batch?.tasks || [])
        if (task.status === 'running') {
          task.status = 'uncertain';
          task.result = '保存执行检查点失败，任务已暂停，未自动重发';
        }
    } finally {
      this.active = '';
      this.emit();
    }
  }
}
