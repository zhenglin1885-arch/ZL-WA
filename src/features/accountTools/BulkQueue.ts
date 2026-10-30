/* eslint-disable no-void -- Background scheduler failures are reported through queue state. */
/* eslint-disable no-continue -- Skip deliveries already revoked, preserving stable message IDs. */
import type {
  BulkSpec,
  Recipient,
  SendRecord,
  BulkDelivery,
  BulkSendOutcome,
} from './config';

export interface BulkAdapter {
  load: () => Promise<SendRecord[]>;
  save: (record: SendRecord) => Promise<void>;
  remove: (ids: string[]) => Promise<SendRecord[]>;
  send: (
    target: Recipient,
    spec: BulkSpec,
  ) => Promise<string | BulkSendOutcome>;
  revoke: (target: Recipient, messageId: string) => Promise<void>;
  reconcile?: (
    target: Recipient,
    messageId: string | undefined,
    spec: BulkSpec | undefined,
    started: string,
    ended: string,
  ) => Promise<BulkSendOutcome>;
  edit?: (target: Recipient, messageId: string, text: string) => Promise<void>;
}
export function validateBulkSpec(spec: BulkSpec) {
  if (
    spec.reply &&
    (typeof spec.reply.text !== 'string' ||
      !spec.reply.text.trim() ||
      spec.reply.text.length > 20_000 ||
      !['exact', 'contains', 'normalized'].includes(spec.reply.match) ||
      spec.targets.some(r => !/^\d{5,30}@(c\.us|lid)$/.test(r.ownerId || '')))
  )
    throw new Error('请填写有效的匹配内容和规则，并重新读取账号会话');
  if (spec.targets.length === 0 || spec.targets.length > 10_000)
    throw new Error('请选择 1–10000 个发送对象');
  if (
    new Set(spec.targets.map(r => `${r.accountId}:${r.id}`)).size !==
    spec.targets.length
  )
    throw new Error('发送对象重复');
  if (spec.type === 'text' && !spec.text.trim())
    throw new Error('请输入发送文字');
  if (spec.text.length > 12_000) throw new Error('文字不可超过 12000 字符');
  if (!['text', 'contact'].includes(spec.type) && !spec.media)
    throw new Error('请选择附件');
  if (spec.type === 'caption' && !spec.text.trim())
    throw new Error('请输入图片说明文字');
  if (
    spec.type === 'contact' &&
    (!spec.contactName?.trim() || !/^\d{7,15}$/.test(spec.contactPhone ?? ''))
  )
    throw new Error('请输入名片名称和含国家区号的 7–15 位手机号码');
  if (
    ![spec.intervalMin, spec.intervalMax, spec.typingSeconds].every(value =>
      Number.isFinite(value),
    ) ||
    spec.intervalMin < 0.5 ||
    spec.intervalMax > 3600 ||
    spec.intervalMax < spec.intervalMin ||
    spec.typingSeconds < 0 ||
    spec.typingSeconds > 30
  )
    throw new Error('间隔应为 0.5–3600 秒，输入状态应为 0–30 秒');
  if (
    spec.mentionAll &&
    !['text', 'image', 'caption', 'video', 'document'].includes(spec.type)
  )
    throw new Error('当前消息类型不支持 @所有人，请选择文本或含说明的附件');
  if (
    spec.scheduledAt &&
    (!Number.isFinite(Date.parse(spec.scheduledAt)) ||
      Date.parse(spec.scheduledAt) <= Date.now())
  )
    throw new Error('请选择未来的发送时间');
}

export default class BulkQueue {
  records: SendRecord[] = [];

  private operations = new Map<string, 'send' | 'revoke' | 'check' | 'edit'>();

  get activeId() {
    return (
      this.operations.keys().next().value ||
      this.submitting.keys().next().value ||
      ''
    );
  }

  get activeOperation() {
    return this.operations.get(this.activeId) || 'send';
  }

  get activeIds(): ReadonlySet<string> {
    return new Set([...this.operations.keys(), ...this.submitting]);
  }

  isRunning(id: string) {
    return this.operations.has(id) || this.submitting.has(id);
  }

  error = '';

  listeners = new Set<() => void>();

  private stopped = new Set<string>();

  private timer?: ReturnType<typeof setInterval>;

  private ready?: Promise<void>;

  private submitting = new Set<string>();

  constructor(private adapter: BulkAdapter) {}

  notify() {
    for (const fn of this.listeners) fn();
  }

  async load() {
    this.ready ??= (async () => {
      this.records = await this.adapter.load();
      for (const old of this.records) {
        if (
          old.status === '发送中' ||
          (old.status === '待发送' &&
            Date.parse(old.spec?.scheduledAt ?? '') <= Date.now())
        ) {
          // Never replay an uncertain delivery or silently catch up a missed timer.
          // eslint-disable-next-line no-await-in-loop
          await this.persist({
            ...old,
            status: old.status === '发送中' ? '已中断' : '已错过',
            ended: new Date().toISOString(),
          });
        }
      }
      this.notify();
    })();
    return this.ready;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(error => {
        this.error = String(error);
        this.notify();
      });
    }, 1000);
    void this.load().catch(error => {
      this.error = String(error);
      this.notify();
    });
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const id of this.activeIds) this.stopped.add(id);
  }

  async persist(record: SendRecord) {
    // Keep task rows stable while concurrent jobs update their progress.
    this.records = this.records.some(r => r.id === record.id)
      ? this.records.map(r => (r.id === record.id ? record : r))
      : [record, ...this.records].slice(0, 100);
    this.notify();
    await this.adapter.save(record);
  }

  async submit(input: BulkSpec, background = false) {
    const spec = {
      ...input,
      text: ['image', 'audio', 'contact'].includes(input.type)
        ? ''
        : input.text,
    };
    validateBulkSpec(spec);
    await this.load();
    if (this.records.length >= 100)
      throw new Error('记录已满，请先清理完成的任务');
    const record: SendRecord = {
      id: crypto.randomUUID(),
      started: new Date().toISOString(),
      text: spec.text || spec.media?.name || spec.contactName || '',
      status: spec.scheduledAt ? '待发送' : '发送中',
      total: spec.targets.length,
      success: 0,
      failed: 0,
      details: [],
      deliveries: [],
      spec: structuredClone(spec),
    };
    this.error = '';
    this.submitting.add(record.id);
    try {
      // Persist before any WhatsApp operation, including the first message.
      await this.persist(record);
      if (!spec.scheduledAt) {
        const action = this.run(record);
        if (background)
          void action.catch(error => {
            this.error = String(error);
            this.notify();
          });
        else await action;
      }
      return record.id;
    } finally {
      this.submitting.delete(record.id);
      this.notify();
    }
  }

  async tick() {
    await this.load();
    const due = this.records.filter(
      r =>
        !this.isRunning(r.id) &&
        r.status === '待发送' &&
        Date.parse(r.spec?.scheduledAt ?? '') <= Date.now(),
    );
    await Promise.all(due.map(record => this.run(record)));
  }

  async stop(id: string) {
    const record = this.records.find(r => r.id === id);
    if (!record || (!this.isRunning(id) && record.status !== '待发送')) return;
    this.stopped.add(id);
    if (record?.status === '待发送')
      await this.persist({
        ...record,
        status: '已取消',
        ended: new Date().toISOString(),
      });
  }

  async remove(ids: string[]) {
    if (
      ids.some(
        id =>
          this.isRunning(id) ||
          this.records.find(r => r.id === id)?.status === '待发送',
      )
    )
      throw new Error('请先停止或取消任务，再删除记录');
    await this.adapter.remove(ids);
    this.records = this.records.filter(record => !ids.includes(record.id));
    for (const id of ids) this.stopped.delete(id);
    this.notify();
  }

  private async run(initial: SendRecord) {
    if (this.operations.has(initial.id) || !initial.spec) return;
    this.operations.set(initial.id, 'send');
    let record = { ...initial, status: '发送中' };
    const { spec } = initial;
    try {
      await this.persist(record);
      for (const target of spec.targets) {
        if (this.stopped.has(record.id)) break;
        let delivery: BulkDelivery = {
          target,
          status: 'sending',
          startedAt: new Date().toISOString(),
        };
        record = {
          ...record,
          deliveries: [...(record.deliveries ?? []), delivery],
        };
        // A crash after this checkpoint makes the task interrupted, never retried.
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let uncertain = false;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await Promise.race([
            this.adapter.send(target, spec),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                uncertain = true;
                reject(new Error('发送超时，结果未确认，请在 WhatsApp 核查'));
              }, 120_000);
            }),
          ]);
          const confirmed = typeof result === 'string' || result.confirmed;
          const notSubmitted =
            typeof result !== 'string' &&
            result.notSubmitted === true &&
            !result.messageId;
          delivery = {
            ...delivery,
            status: confirmed ? 'sent' : notSubmitted ? 'failed' : 'uncertain',
            messageId: typeof result === 'string' ? result : result.messageId,
            ...(typeof result !== 'string' && result.quotedMessageId
              ? { quotedMessageId: result.quotedMessageId }
              : {}),
            error: confirmed
              ? undefined
              : (typeof result !== 'string' && result.error) ||
                '未确认服务器接受，请在 WhatsApp 核查',
          };
          record = {
            ...record,
            success: record.success + (confirmed ? 1 : 0),
            failed: record.failed + (confirmed ? 0 : 1),
          };
          // A settled request with a known ID can be checked later without
          // resending it. Continue to distinct targets only when requested.
          // Unidentified submissions and still-running timeouts remain stops.
          if (
            !confirmed &&
            (spec.failure !== 'continue' ||
              !delivery.messageId ||
              (typeof result !== 'string' && result.halt) ||
              (typeof result !== 'string' && result.timedOut))
          )
            this.stopped.add(record.id);
        } catch (error) {
          delivery = {
            ...delivery,
            status: uncertain ? 'uncertain' : 'failed',
            error: String(error),
          };
          record = { ...record, failed: record.failed + 1 };
          if (uncertain || spec.failure === 'stop') this.stopped.add(record.id);
        } finally {
          clearTimeout(timeout);
        }
        record = {
          ...record,
          deliveries: [...record.deliveries!.slice(0, -1), delivery],
          details: [
            ...record.details,
            `${target.name}：${delivery.status === 'sent' ? '服务器已接受' : delivery.error}`,
          ],
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        const delay =
          (spec.intervalMin +
            Math.random() * (spec.intervalMax - spec.intervalMin)) *
          1000;
        const until = Date.now() + delay;
        // Short waits let cancellation stop the remaining queue promptly.
        while (
          !this.stopped.has(record.id) &&
          record.success + record.failed < record.total &&
          Date.now() < until
        ) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => {
            setTimeout(resolve, Math.min(100, until - Date.now()));
          });
        }
      }
      // Earlier recipients may acquire their ACK while later recipients are
      // processed. Perform one bounded read-only sweep by original ID; never
      // retry a send or revive a stopped/timed-out operation.
      if (this.adapter.reconcile && !this.stopped.has(record.id)) {
        const deadline = Date.now() + 5000;
        for (
          let index = 0;
          index < (record.deliveries?.length || 0);
          index += 1
        ) {
          if (this.stopped.has(record.id) || Date.now() >= deadline) break;
          const delivery = record.deliveries![index];
          if (delivery.status !== 'uncertain' || !delivery.messageId) continue;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await Promise.race([
              this.adapter.reconcile(
                delivery.target,
                delivery.messageId,
                spec,
                delivery.startedAt || record.started,
                new Date().toISOString(),
              ),
              new Promise<void>(resolve => {
                timer = setTimeout(
                  () => resolve(),
                  Math.max(1, deadline - Date.now()),
                );
              }),
            ]);
            if (
              result &&
              result.confirmed &&
              result.messageId === delivery.messageId
            ) {
              const deliveries = [...record.deliveries!];
              deliveries[index] = {
                ...delivery,
                status: 'sent',
                error: undefined,
                checkedAt: new Date().toISOString(),
                checkError: undefined,
              };
              record = {
                ...record,
                deliveries,
                success: record.success + 1,
                failed: record.failed - 1,
                details: deliveries.map(
                  item =>
                    `${item.target.name}：${item.status === 'sent' ? '服务器已接受' : item.error}`,
                ),
              };
            }
          } catch {
            /* Keep the original uncertain result and message ID. */
          } finally {
            clearTimeout(timer);
          }
        }
      }
      await this.persist({
        ...record,
        status: record.deliveries?.some(d => d.status === 'uncertain')
          ? '待确认'
          : this.stopped.has(record.id)
            ? '已停止'
            : record.failed
              ? '部分失败'
              : '已完成',
        ended: new Date().toISOString(),
      });
    } catch {
      this.error =
        '无法保存任务状态，任务已停止。请检查 WhatsApp 中已发消息，勿直接重发。';
      this.records = this.records.map(r =>
        r.id === record.id ? { ...record, status: '已中断' } : r,
      );
    } finally {
      this.operations.delete(record.id);
      this.stopped.delete(record.id);
      this.notify();
    }
  }

  private async bounded<T>(request: Promise<T>, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), 45_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async reconcile(id: string) {
    if (this.isRunning(id)) throw new Error('此任务正在执行，请等待此任务结束');
    let record = this.records.find(r => r.id === id);
    if (!record?.deliveries?.length || !this.adapter.reconcile)
      throw new Error('记录缺少发送对象，无法自动核对');
    this.operations.set(id, 'check');
    this.notify();
    try {
      for (let i = 0; i < record.deliveries!.length; i += 1) {
        const delivery = record.deliveries![i];
        if (
          delivery.revoked ||
          (delivery.status === 'sent' && delivery.messageId)
        )
          continue;
        let updated: BulkDelivery;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await this.bounded(
            this.adapter.reconcile(
              delivery.target,
              delivery.messageId,
              record.spec
                ? {
                    ...record.spec,
                    text: delivery.editedText || record.spec.text,
                  }
                : undefined,
              delivery.startedAt || record.spec?.scheduledAt || record.started,
              record.ended || new Date().toISOString(),
            ),
            '核对超时，未重发任何消息',
          );
          updated = {
            ...delivery,
            messageId: result.messageId,
            status: result.confirmed ? 'sent' : 'uncertain',
            error: result.confirmed
              ? undefined
              : result.error || '服务器结果仍待确认',
            checkedAt: new Date().toISOString(),
            checkError: undefined,
          };
        } catch (error) {
          updated = {
            ...delivery,
            checkedAt: new Date().toISOString(),
            checkError: String(error),
          };
        }
        const deliveries = record.deliveries!.map((d, index) =>
          index === i ? updated : d,
        );
        const success = deliveries.filter(d => d.status === 'sent').length;
        const failed = deliveries.filter(d =>
          ['failed', 'uncertain', 'sending'].includes(d.status),
        ).length;
        const pending = deliveries.some(d =>
          ['uncertain', 'sending'].includes(d.status),
        );
        record = {
          ...record,
          deliveries,
          success,
          failed,
          status:
            success === record.total
              ? '已完成'
              : pending
                ? '待确认'
                : record.status === '待确认'
                  ? '部分失败'
                  : record.status,
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
      }
    } finally {
      this.operations.delete(record.id);
      this.notify();
    }
    return record;
  }

  async edit(id: string, text: string, targets: string[]) {
    if (this.isRunning(id)) throw new Error('此任务正在执行，请等待此任务结束');
    if (!text.trim() || text.length > 12_000 || targets.length === 0)
      throw new Error('请选择对象并填写 1–12000 字符的新内容');
    let record = this.records.find(r => r.id === id);
    if (
      !record?.deliveries?.length ||
      !this.adapter.edit ||
      (record.spec &&
        !['text', 'image', 'caption', 'video', 'document'].includes(
          record.spec.type,
        ))
    )
      throw new Error('该记录没有可编辑的文字消息，请先核对发送结果');
    const selected = record.deliveries.filter(d =>
      targets.includes(`${d.target.accountId}:${d.target.id}`),
    );
    if (
      selected.length !== targets.length ||
      selected.some(d => !d.messageId || d.revoked)
    )
      throw new Error('存在无法编辑的消息，请先核对消息编号');
    this.operations.set(id, 'edit');
    this.notify();
    try {
      record = {
        ...record,
        editStarted: new Date().toISOString(),
        editEnded: undefined,
      };
      await this.persist(record);
      for (let i = 0; i < record.deliveries!.length; i += 1) {
        const delivery = record.deliveries![i];
        if (!selected.includes(delivery)) continue;
        record = {
          ...record,
          deliveries: record.deliveries!.map((d, index) =>
            index === i
              ? {
                  ...d,
                  editRequestedText: text.trim(),
                  editRequestedAt: new Date().toISOString(),
                  editError: undefined,
                }
              : d,
          ),
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        let updated: BulkDelivery;
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.bounded(
            this.adapter.edit(
              delivery.target,
              delivery.messageId!,
              text.trim(),
            ),
            '编辑结果超时未确认，请在 WhatsApp 核查，勿重复提交',
          );
          updated = {
            ...record.deliveries![i],
            status: 'sent',
            error: undefined,
            editedText: text.trim(),
            editedAt: new Date().toISOString(),
            editError: undefined,
          };
        } catch (error) {
          updated = { ...record.deliveries![i], editError: String(error) };
        }
        record = {
          ...record,
          deliveries: record.deliveries!.map((d, index) =>
            index === i ? updated : d,
          ),
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        if (updated.editError?.includes('超时')) break;
      }
      const all = record.deliveries!.filter(d => d.messageId && !d.revoked);
      const texts = all.map(
        d => d.editedText || record!.spec?.text || record!.text,
      );
      const success = record.deliveries!.filter(
        d => d.status === 'sent',
      ).length;
      const failed = record.deliveries!.filter(d =>
        ['failed', 'uncertain', 'sending'].includes(d.status),
      ).length;
      await this.persist({
        ...record,
        success,
        failed,
        status: success === record.total ? '已完成' : record.status,
        editEnded: new Date().toISOString(),
        editedText:
          all.length > 0 &&
          texts.every(value => value === texts[0]) &&
          all.some(d => d.editedAt)
            ? texts[0]
            : undefined,
      });
    } finally {
      this.operations.delete(record.id);
      this.notify();
    }
  }

  async revoke(id: string, targets?: string[]) {
    if (this.isRunning(id)) throw new Error('此任务正在执行，请等待此任务结束');
    let record = this.records.find(r => r.id === id);
    if (!record?.deliveries?.some(d => d.messageId && !d.revoked))
      throw new Error('没有可撤回的消息编号，旧版记录不支持撤回');
    this.operations.set(id, 'revoke');
    this.notify();
    try {
      record = {
        ...record,
        revokeStarted: new Date().toISOString(),
        revokeEnded: undefined,
      };
      await this.persist(record);
      for (let i = 0; i < record.deliveries!.length; i += 1) {
        if (this.stopped.has(id)) break;
        const delivery = record.deliveries![i];
        if (
          targets &&
          !targets.includes(
            `${delivery.target.accountId}:${delivery.target.id}`,
          )
        )
          continue;
        if (!delivery.messageId || delivery.revoked) continue;
        let updated: BulkDelivery;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          await Promise.race([
            this.adapter.revoke(delivery.target, delivery.messageId),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                this.stopped.add(id);
                reject(new Error('撤回结果超时未确认，请在 WhatsApp 核查'));
              }, 45_000);
            }),
          ]);
          updated = {
            ...delivery,
            revoked: true,
            revokedAt: new Date().toISOString(),
            revokeError: undefined,
          };
        } catch (error) {
          updated = { ...delivery, revokeError: String(error) };
        } finally {
          clearTimeout(timeout);
        }
        record = {
          ...record,
          deliveries: record.deliveries!.map((d, index) =>
            index === i ? updated : d,
          ),
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
      }
      await this.persist({ ...record, revokeEnded: new Date().toISOString() });
    } finally {
      this.operations.delete(record.id);
      this.stopped.delete(id);
      this.notify();
    }
  }
}
