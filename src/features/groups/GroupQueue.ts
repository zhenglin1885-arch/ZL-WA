/* eslint-disable no-await-in-loop, no-continue -- One mutation at a time, with persisted checkpoints and cancellable pacing. */
import {
  defaultGroupState,
  groupMode,
  validateGroupState,
  type GroupBatch,
  type GroupOperation,
  type GroupResult,
  type GroupTarget,
  type GroupTask,
  type GroupToolsState,
} from './types';

export interface GroupAdapter {
  load: () => Promise<GroupToolsState>;
  save: (state: GroupToolsState) => Promise<unknown>;
  check: (task: GroupTask) => Promise<GroupResult>;
  execute: (task: GroupTask) => Promise<GroupResult>;
  wait?: (ms: number) => Promise<void>;
  timeout?: number;
}
export default class GroupQueue {
  state = defaultGroupState();

  active = '';

  error = '';

  stopped = false;

  listeners = new Set<() => void>();

  private ready?: Promise<void>;

  private saves: Promise<unknown> = Promise.resolve();

  constructor(private adapter: GroupAdapter) {}

  notify() {
    for (const fn of this.listeners) fn();
  }

  load() {
    this.ready ??= (async () => {
      const saved = validateGroupState(await this.adapter.load());
      for (const batch of saved.batches)
        for (const task of batch.tasks) {
          if (task.status === 'running') {
            task.status = 'uncertain';
            task.message = '软件曾中断，请先核验结果后重试';
          }
          if (task.status === 'queued') {
            task.status = 'stopped';
            task.message = '任务曾中断，未自动恢复执行';
          }
        }
      this.state = saved;
      this.notify();
    })();
    return this.ready;
  }

  private async persist() {
    const snapshot = validateGroupState(this.state);
    this.saves = this.saves
      .catch(() => {})
      .then(() => this.adapter.save(snapshot));
    await this.saves;
    this.notify();
  }

  async setInterval(mode: GroupBatch['mode'], interval: number) {
    await this.load();
    const previous = this.state.intervals[mode];
    this.state.intervals[mode] = interval;
    try {
      await this.persist();
    } catch (error) {
      this.state.intervals[mode] = previous;
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    this.notify();
  }

  private async pause(ms: number) {
    if (this.adapter.wait) {
      await this.adapter.wait(ms);
      return;
    }
    const until = Date.now() + ms;
    while (!this.stopped && Date.now() < until)
      await new Promise(resolve => {
        setTimeout(resolve, Math.min(100, until - Date.now()));
      });
  }

  private async bounded(request: Promise<GroupResult>): Promise<GroupResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<GroupResult>(resolve => {
          timer = setTimeout(
            () =>
              resolve({
                status: 'uncertain',
                message: '请求超时，结果未确认；请稍后核验',
                inFlight: true,
              }),
            this.adapter.timeout ?? 60_000,
          );
        }),
      ]);
    } catch (error) {
      return { status: 'uncertain', message: String(error).slice(0, 1000) };
    } finally {
      clearTimeout(timer);
    }
  }

  async start(
    operation: GroupOperation,
    targets: GroupTarget[],
    interval: number,
    deleteGroup = true,
  ) {
    await this.load();
    if (this.active) throw new Error('请先等待当前群组任务完成或停止');
    if (targets.length === 0 || targets.length > 5000)
      throw new Error('请选择 1–5000 个执行对象');
    const seen = new Set<string>();
    const tasks: GroupTask[] = targets
      .filter(t => {
        const key = `${t.accountId}:${t.target}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(target => ({
        ...target,
        id: crypto.randomUUID(),
        operation,
        deleteGroup,
        status: 'queued',
        attempts: 0,
        message: '等待执行',
      }));
    const mode = groupMode(operation);
    const batch: GroupBatch = {
      id: crypto.randomUUID(),
      mode,
      interval,
      created: new Date().toISOString(),
      tasks,
    };
    const previous = this.state;
    this.state = {
      intervals: { ...previous.intervals, [mode]: interval },
      batches: [batch, ...previous.batches].slice(0, 12),
    };
    // Keep at most 10,000 target checkpoints in the local history.
    while (this.state.batches.reduce((n, b) => n + b.tasks.length, 0) > 10_000)
      this.state.batches.pop();
    try {
      validateGroupState(this.state);
    } catch (error) {
      this.state = previous;
      throw error;
    }
    await this.run(batch, tasks);
  }

  async retry(batchId: string, interval?: number) {
    await this.load();
    if (this.active) throw new Error('请先等待当前群组任务完成或停止');
    const batch = this.state.batches.find(b => b.id === batchId);
    if (!batch) throw new Error('群组任务不存在');
    if (interval !== undefined) {
      if (!Number.isFinite(interval) || interval < 1 || interval > 3600)
        throw new Error('执行间隔应为 1–3600 秒');
      batch.interval = interval;
      this.state.intervals[batch.mode] = interval;
    }
    const tasks = batch.tasks.filter(t =>
      ['failed', 'uncertain', 'stopped'].includes(t.status),
    );
    if (tasks.length === 0) throw new Error('没有需要重试的失败或未确认对象');
    await this.run(batch, tasks);
  }

  async reconcile(batchId: string) {
    await this.load();
    if (this.active) throw new Error('请先等待当前群组任务结束');
    const batch = this.state.batches.find(b => b.id === batchId);
    if (!batch) return;
    this.active = batch.id;
    this.error = '';
    this.stopped = false;
    this.notify();
    try {
      let paced = false;
      const limited = new Set<string>();
      for (const task of batch.tasks) {
        if (this.stopped) break;
        if (!['uncertain', 'approval', 'failed'].includes(task.status))
          continue;
        if (limited.has(task.accountId)) {
          task.message = `${task.message.slice(0, 1000)}；WhatsApp 核验限流，暂未再次查询；请稍后刷新执行结果`;
          await this.persist();
          continue;
        }
        if (paced) await this.pause(batch.interval * 1000);
        if (this.stopped) break;
        paced = true;
        const previous = task.status;
        const previousMessage = task.message;
        task.message = '正在核验结果（不重复执行）';
        this.notify();
        const result = await this.bounded(this.adapter.check({ ...task }));
        if (result.rateLimited) limited.add(task.accountId);
        task.groupId = result.groupId || task.groupId;
        if (result.submitted) task.joinSubmitted = true;
        task.status =
          result.status === 'not-done'
            ? previous === 'approval'
              ? 'approval'
              : 'failed'
            : result.status;
        task.message =
          result.status === 'not-done' && previous === 'failed'
            ? `${previousMessage.slice(0, 1000)}；核验：${result.message}`.slice(
                0,
                2000,
              )
            : result.message;
        await this.persist();
        if (result.inFlight) break;
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      this.active = '';
      this.notify();
    }
  }

  private async run(batch: GroupBatch, tasks: GroupTask[]) {
    if (this.active) throw new Error('已有群组任务正在执行');
    this.active = batch.id;
    this.error = '';
    this.stopped = false;
    this.notify();
    let paced = false;
    try {
      const work = [...tasks];
      const deferred = new Set<string>();
      const limited = new Set<string>();
      for (const task of work) {
        if (this.stopped) break;
        if (paced) await this.pause(batch.interval * 1000);
        if (this.stopped) break;
        paced = true;
        for (
          let attempt = 0;
          attempt < (batch.mode === 'join' ? 1 : 3);
          attempt += 1
        ) {
          if (this.stopped) break;
          const direct =
            (task.operation === 'join' || task.operation === 'leave') &&
            !task.joinSubmitted &&
            (task.attempts === 0 || task.status === 'failed');
          task.status = 'running';
          task.message = direct ? '准备执行' : '正在核验当前状态';
          await this.persist();
          let result: GroupResult = direct
            ? { status: 'not-done', message: '准备执行' }
            : await this.bounded(this.adapter.check({ ...task }));
          if (result.status === 'not-done') {
            if (this.stopped) {
              task.status = 'stopped';
              task.message = '已停止，未执行新操作';
              await this.persist();
              break;
            }
            task.attempts += 1;
            task.token = crypto.randomUUID();
            task.groupId = result.groupId || task.groupId;
            task.message = `执行中（第 ${task.attempts} 次）`;
            await this.persist(); // Fail before mutation if a checkpoint cannot be written.
            result = await this.bounded(this.adapter.execute({ ...task }));
          }
          task.groupId = result.groupId || task.groupId;
          if (result.rateLimited) limited.add(task.accountId);
          if (result.submitted) task.joinSubmitted = true;
          task.status = result.status === 'not-done' ? 'failed' : result.status;
          task.message = result.message;
          await this.persist();
          if (result.inFlight) {
            this.stopped = true;
            this.error = '上一项仍可能执行中，队列已暂停；请稍后核验未确认项';
            break;
          }
          if (batch.mode === 'join') {
            if (
              result.status === 'not-done' &&
              result.retryable !== false &&
              !deferred.has(task.id)
            ) {
              deferred.add(task.id);
              work.push(task);
              task.message = `${result.message}；首轮完成后再重试一次`;
              this.notify();
            }
            break;
          }
          if (
            result.status !== 'not-done' ||
            result.retryable === false ||
            attempt === 2
          )
            break;
          task.message = `${result.message}；将在 ${batch.interval} 秒后重试`;
          this.notify();
          await this.pause(batch.interval * 1000);
        }
      }
      // Let later groups run first, then re-read accepted joins once. This
      // catches delayed membership without holding every group or resubmitting.
      if (batch.mode === 'join' && !this.stopped)
        for (const task of tasks) {
          if (
            !task.joinSubmitted ||
            task.status !== 'uncertain' ||
            limited.has(task.accountId)
          )
            continue;
          const result = await this.bounded(this.adapter.check({ ...task }));
          task.groupId = result.groupId || task.groupId;
          task.message = result.message;
          task.status =
            result.status === 'not-done' ? 'uncertain' : result.status;
          await this.persist();
          if (result.inFlight || this.stopped) break;
        }
      for (const task of tasks)
        if (['queued', 'running'].includes(task.status)) {
          task.status = 'stopped';
          task.message = '已停止，未继续执行';
        }
      await this.persist();
    } catch (error) {
      this.error = `任务已停止：${String(error)}。请核验执行结果后再操作。`;
      for (const task of tasks)
        if (task.status === 'running') {
          task.status = 'uncertain';
          task.message = '任务状态保存或读取异常，结果待核验';
        } else if (task.status === 'queued') {
          task.status = 'stopped';
          task.message = '任务状态保存异常，未继续执行';
        }
    } finally {
      this.active = '';
      this.notify();
    }
  }
}
