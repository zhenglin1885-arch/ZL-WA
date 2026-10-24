import BulkQueue, {
  validateBulkSpec,
  type BulkAdapter,
} from '../src/features/accountTools/BulkQueue';
import type { BulkSpec, SendRecord } from '../src/features/accountTools/config';

const spec = (extra: Partial<BulkSpec> = {}): BulkSpec => ({
  type: 'text',
  text: 'hello',
  targets: [
    { id: 'one@g.us', accountId: 'account-1', name: 'group', group: true },
    { id: 'two@c.us', accountId: 'account-2', name: 'private', group: false },
  ],
  intervalMin: 0.5,
  intervalMax: 0.5,
  typingSeconds: 0,
  mentionAll: false,
  failure: 'stop',
  ...extra,
});
const saved = (extra: Partial<SendRecord> = {}): SendRecord => ({
  id: 'saved',
  started: new Date().toISOString(),
  text: 'hello',
  total: 2,
  success: 0,
  failed: 0,
  details: [],
  spec: spec(),
  ...extra,
  status: extra.status || '待发送',
});

const finish = async (action: Promise<unknown>) => {
  await jest.runAllTimersAsync();
  await action;
};

describe('persistent bulk queue without live WhatsApp', () => {
  let adapter: BulkAdapter;
  let queue: BulkQueue;
  beforeEach(() => {
    jest.useFakeTimers();
    adapter = {
      load: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async () => {}),
      remove: jest.fn().mockResolvedValue([]),
      send: jest.fn().mockImplementation(async target => `sent-${target.id}`),
      revoke: jest.fn().mockImplementation(async () => {}),
    };
    queue = new BulkQueue(adapter);
  });
  afterEach(() => {
    queue.dispose();
    jest.useRealTimers();
  });
  it('persists each checkpoint and message ID before proceeding, without duplicate sends', async () => {
    const action = queue.submit(spec());
    await finish(action);
    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(queue.records[0]).toMatchObject({
      status: '已完成',
      success: 2,
      failed: 0,
      deliveries: [
        { messageId: 'sent-one@g.us' },
        { messageId: 'sent-two@c.us' },
      ],
    });
    expect(
      (adapter.save as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan((adapter.send as jest.Mock).mock.invocationCallOrder[0]);
    await queue.tick();
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
  it('a history write failure prevents any send', async () => {
    (adapter.save as jest.Mock).mockRejectedValue(new Error('disk full'));
    await expect(queue.submit(spec())).rejects.toThrow('disk full');
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('continues only to the next recipient when the user selects skip failure', async () => {
    (adapter.send as jest.Mock).mockRejectedValueOnce(new Error('rejected'));
    await finish(queue.submit(spec({ failure: 'continue' })));
    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(queue.records[0]).toMatchObject({
      status: '部分失败',
      success: 1,
      failed: 1,
    });
  });
  it('default failure stops the queue and never retries the failed message', async () => {
    (adapter.send as jest.Mock).mockRejectedValue(new Error('rejected'));
    await finish(queue.submit(spec()));
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(queue.records[0].status).toBe('已停止');
  });
  it('an unknown timeout stops even when skip failure is selected', async () => {
    (adapter.send as jest.Mock).mockImplementation(() => new Promise(() => {}));
    await finish(queue.submit(spec({ failure: 'continue' })));
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(queue.records[0]).toMatchObject({
      status: '待确认',
      deliveries: [{ status: 'uncertain' }],
    });
  });
  it('stopping during a send waits for that send and skips remaining recipients', async () => {
    let resolve!: (id: string) => void;
    (adapter.send as jest.Mock).mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    );
    const action = queue.submit(spec());
    await jest.advanceTimersByTimeAsync(1);
    await queue.stop(queue.activeId);
    resolve('accepted');
    await finish(action);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(queue.records[0]).toMatchObject({ status: '已停止', success: 1 });
  });
  it('executes scheduled tasks only when due and allows cancel before due', async () => {
    await queue.submit(
      spec({ scheduledAt: new Date(Date.now() + 10_000).toISOString() }),
    );
    await queue.tick();
    expect(adapter.send).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10_000);
    await finish(queue.tick());
    expect(adapter.send).toHaveBeenCalledTimes(2);
    await queue.submit(
      spec({ scheduledAt: new Date(Date.now() + 10_000).toISOString() }),
    );
    await queue.stop(queue.records[0].id);
    await jest.advanceTimersByTimeAsync(10_000);
    await queue.tick();
    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(queue.records[0].status).toBe('已取消');
  });
  it('restart never replays interrupted sends or missed scheduled tasks', async () => {
    (adapter.load as jest.Mock).mockResolvedValue([
      saved({ id: 'interrupted', status: '发送中' }),
      saved({
        id: 'missed',
        spec: spec({ scheduledAt: new Date(Date.now() - 1000).toISOString() }),
      }),
    ]);
    await queue.load();
    await queue.tick();
    expect(new Set(queue.records.map(r => r.status))).toEqual(
      new Set(['已中断', '已错过']),
    );
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('preserves message IDs for revoke, reports failures, and skips already revoked messages', async () => {
    await finish(queue.submit(spec()));
    const { id } = queue.records[0];
    (adapter.revoke as jest.Mock).mockRejectedValueOnce(new Error('expired'));
    await queue.revoke(id);
    expect(queue.records[0].deliveries).toMatchObject([
      { revokeError: 'Error: expired' },
      { revoked: true },
    ]);
    await queue.revoke(id);
    expect(adapter.revoke).toHaveBeenCalledTimes(3);
    expect(queue.records[0].deliveries?.every(d => d.revoked)).toBe(true);
  });
  it('deleting history never invokes the WhatsApp revoke adapter and protects scheduled tasks', async () => {
    await queue.submit(
      spec({ scheduledAt: new Date(Date.now() + 10_000).toISOString() }),
    );
    const { id } = queue.records[0];
    await expect(queue.remove([id])).rejects.toThrow('取消');
    await queue.stop(id);
    await queue.remove([id]);
    expect(adapter.revoke).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('keeps an unconfirmed message ID for manual revoke and stops further sends', async () => {
    (adapter.send as jest.Mock).mockResolvedValue({
      messageId: 'known-but-unconfirmed',
      confirmed: false,
    });
    await finish(queue.submit(spec({ failure: 'continue' })));
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(queue.records[0]).toMatchObject({
      status: '待确认',
      failed: 1,
      deliveries: [{ messageId: 'known-but-unconfirmed', status: 'uncertain' }],
    });
  });
  it('lets the user revoke a selected target without touching other recipients', async () => {
    await finish(queue.submit(spec()));
    await queue.revoke(queue.records[0].id, ['account-2:two@c.us']);
    expect(adapter.revoke).toHaveBeenCalledTimes(1);
    expect(adapter.revoke).toHaveBeenCalledWith(
      spec().targets[1],
      'sent-two@c.us',
    );
    expect(queue.records[0].deliveries?.[0].revoked).toBeUndefined();
  });
  it('records the actual image filename rather than a hidden previous text draft', async () => {
    const value = spec({
      type: 'image',
      text: 'previous hidden draft',
      targets: [spec().targets[0]],
      media: { id: 'media', name: 'actual.png', mime: 'image/png', size: 10 },
    });
    await finish(queue.submit(value));
    expect(queue.records[0].text).toBe('actual.png');
    expect(queue.records[0].spec?.text).toBe('');
    expect(adapter.send).toHaveBeenCalledWith(
      value.targets[0],
      expect.objectContaining({ text: '', type: 'image' }),
    );
  });
  it('repairs false failures, restores IDs for revoke, and never resends during reconciliation', async () => {
    const { targets } = spec();
    queue.records = [
      saved({
        status: '部分失败',
        failed: 2,
        deliveries: targets.map(target => ({ target, status: 'failed' })),
      }),
    ];
    adapter.reconcile = jest.fn(async target => ({
      messageId: `restored-${target.id}`,
      confirmed: true,
    }));
    await finish(queue.reconcile('saved'));
    expect(queue.records[0]).toMatchObject({
      status: '已完成',
      success: 2,
      failed: 0,
    });
    expect(
      queue.records[0].deliveries?.every(d =>
        Boolean(d.messageId && d.checkedAt),
      ),
    ).toBe(true);
    expect(adapter.send).not.toHaveBeenCalled();
    await finish(queue.revoke('saved'));
    expect(adapter.revoke).toHaveBeenCalledWith(
      targets[0],
      `restored-${targets[0].id}`,
    );
  });
  it('returns repaired completed records for an edit/revoke dialog without resending', async () => {
    const target = spec().targets[0];
    queue.records = [
      saved({
        status: '已完成',
        success: 1,
        total: 1,
        deliveries: [{ target, status: 'sent' }],
      }),
    ];
    adapter.reconcile = jest.fn(async () => ({
      messageId: 'recovered',
      confirmed: true,
    }));
    const action = queue.reconcile('saved');
    await finish(action);
    const repaired = await action;
    expect(repaired.deliveries?.[0].messageId).toBe('recovered');
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('allows legacy records with message IDs and missing type metadata to use live edit checks', async () => {
    const target = spec().targets[0];
    queue.records = [
      saved({
        spec: undefined,
        status: '已完成',
        total: 1,
        success: 1,
        deliveries: [{ target, status: 'sent', messageId: 'legacy-id' }],
      }),
    ];
    adapter.edit = jest.fn(async () => {});
    await finish(
      queue.edit('saved', 'new text', [`${target.accountId}:${target.id}`]),
    );
    expect(adapter.edit).toHaveBeenCalledWith(target, 'legacy-id', 'new text');
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('retains unverified results when reconciliation cannot uniquely identify a message', async () => {
    const target = spec().targets[0];
    queue.records = [
      saved({
        status: '待确认',
        failed: 1,
        deliveries: [{ target, status: 'uncertain' }],
      }),
    ];
    adapter.reconcile = jest.fn().mockRejectedValue(new Error('ambiguous'));
    await finish(queue.reconcile('saved'));
    expect(queue.records[0]).toMatchObject({
      success: 0,
      deliveries: [
        {
          status: 'uncertain',
          checkError: expect.stringContaining('ambiguous'),
        },
      ],
    });
    expect(adapter.send).not.toHaveBeenCalled();
  });
  it('edits selected real message IDs without sending again, retaining per-target failures', async () => {
    await finish(queue.submit(spec()));
    adapter.edit = jest.fn(async target => {
      if (target.accountId === 'account-2') throw new Error('expired');
    });
    await finish(
      queue.edit(
        queue.records[0].id,
        'corrected',
        spec().targets.map(t => `${t.accountId}:${t.id}`),
      ),
    );
    expect(queue.records[0].deliveries).toMatchObject([
      { editedText: 'corrected', editedAt: expect.any(String) },
      { editError: expect.stringContaining('expired') },
    ]);
    expect(queue.records[0].text).toBe('hello');
    expect(queue.records[0].editedText).toBeUndefined();
    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(adapter.revoke).not.toHaveBeenCalled();
  });
  it('persists a successful correction and lets revoke still use the original message ID', async () => {
    await finish(queue.submit(spec()));
    adapter.edit = jest.fn().mockImplementation(async () => {});
    const { id } = queue.records[0];
    await finish(
      queue.edit(
        id,
        'corrected',
        spec().targets.map(t => `${t.accountId}:${t.id}`),
      ),
    );
    expect(queue.records[0].editedText).toBe('corrected');
    await finish(queue.revoke(id));
    expect(adapter.revoke).toHaveBeenCalledWith(
      spec().targets[0],
      'sent-one@g.us',
    );
  });
  it('rejects invalid content, intervals, missing media, invalid cards and duplicate targets', () => {
    for (const item of [
      spec({ text: '' }),
      spec({ intervalMin: 0 }),
      spec({ intervalMax: Number.NaN }),
      spec({ type: 'image' }),
      spec({ type: 'contact', contactPhone: 'bad' }),
      spec({ targets: [spec().targets[0], spec().targets[0]] }),
    ])
      expect(() => validateBulkSpec(item)).toThrow();
  });
  it('starts multiple jobs immediately and stops only the selected job while the other finishes', async () => {
    const pending: {
      target: string;
      text: string;
      resolve: (id: string) => void;
    }[] = [];
    (adapter.send as jest.Mock).mockImplementation(
      (target, value) =>
        new Promise(resolve => {
          pending.push({ target: target.id, text: value.text, resolve });
        }),
    );
    const first = await queue.submit(spec({ text: 'job A' }), true);
    const second = await queue.submit(spec({ text: 'job B' }), true);
    await jest.advanceTimersByTimeAsync(0);
    expect(queue.activeIds).toEqual(new Set([first, second]));
    expect(pending.map(p => p.text)).toEqual(['job A', 'job B']);
    await queue.stop(first);
    pending[0].resolve('A-first');
    pending[1].resolve('B-first');
    await jest.advanceTimersByTimeAsync(600);
    expect(pending.map(p => p.text)).toEqual(['job A', 'job B', 'job B']);
    pending[2].resolve('B-second');
    await jest.advanceTimersByTimeAsync(0);
    expect(queue.records.find(r => r.id === first)).toMatchObject({
      status: '已停止',
      success: 1,
      deliveries: [{ messageId: 'A-first' }],
    });
    expect(queue.records.find(r => r.id === second)).toMatchObject({
      status: '已完成',
      success: 2,
      deliveries: [{ messageId: 'B-first' }, { messageId: 'B-second' }],
    });
    expect(queue.activeIds.size).toBe(0);
  });
  it('launches all due scheduled jobs without waiting for other jobs and does not dispatch twice', async () => {
    const pending: ((id: string) => void)[] = [];
    (adapter.send as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          pending.push(resolve);
        }),
    );
    const scheduledAt = new Date(Date.now() + 1000).toISOString();
    await queue.submit(
      spec({ text: 'scheduled A', targets: [spec().targets[0]], scheduledAt }),
    );
    await queue.submit(
      spec({ text: 'scheduled B', targets: [spec().targets[1]], scheduledAt }),
    );
    await jest.advanceTimersByTimeAsync(1100);
    const running = queue.tick();
    await jest.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
    expect(queue.activeIds.size).toBe(2);
    await queue.tick();
    expect(pending).toHaveLength(2);
    pending.forEach((resolve, index) => resolve(`scheduled-${index}`));
    await running;
    expect(queue.records.every(r => r.status === '已完成')).toBe(true);
  });
  it('deleting an idle record cannot overwrite another job completion with a stale adapter snapshot', async () => {
    (adapter.load as jest.Mock).mockResolvedValue([
      saved({ id: 'old', status: '已完成' }),
    ]);
    await queue.load();
    let completeSend!: (id: string) => void;
    let completeRemove!: (records: SendRecord[]) => void;
    (adapter.send as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          completeSend = resolve;
        }),
    );
    (adapter.remove as jest.Mock).mockImplementation(
      () =>
        new Promise(resolve => {
          completeRemove = resolve;
        }),
    );
    const id = await queue.submit(spec({ targets: [spec().targets[0]] }), true);
    await jest.advanceTimersByTimeAsync(0);
    const snapshot = structuredClone(queue.records.filter(r => r.id !== 'old'));
    const removing = queue.remove(['old']);
    await expect(queue.remove([id])).rejects.toThrow('停止');
    completeSend('message');
    await jest.advanceTimersByTimeAsync(0);
    completeRemove(snapshot);
    await removing;
    expect(queue.records).toHaveLength(1);
    expect(queue.records[0]).toMatchObject({
      id,
      status: '已完成',
      success: 1,
    });
  });
  it('a late stop click on a completed job cannot cancel a later revoke operation', async () => {
    await finish(queue.submit(spec()));
    const { id } = queue.records[0];
    await queue.stop(id);
    await queue.revoke(id);
    expect(adapter.revoke).toHaveBeenCalledTimes(2);
    expect(queue.records[0].deliveries?.every(d => d.revoked)).toBe(true);
  });
});
