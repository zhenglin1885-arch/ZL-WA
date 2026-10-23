import GroupQueue, {
  type GroupAdapter,
} from '../src/features/groups/GroupQueue';
import {
  defaultGroupState,
  parseGroupLinks,
  validateGroupState,
  type GroupTarget,
} from '../src/features/groups/types';

const target: GroupTarget = {
  accountId: 'account-a',
  accountName: 'A',
  ownerId: '8613800000001@c.us',
  target: '10001@g.us',
  name: '测试群',
};
const pending = () => ({
  status: 'not-done' as const,
  message: '尚未完成',
  retryable: true,
});
const success = () => ({ status: 'success' as const, message: '已核验' });
function setup(overrides: Partial<GroupAdapter> = {}) {
  const snapshots: any[] = [];
  const adapter = {
    load: jest.fn(async () =>
      overrides.load ? overrides.load() : defaultGroupState(),
    ),
    save: jest.fn(
      async (state: import('../src/features/groups/types').GroupToolsState) => {
        snapshots.push(structuredClone(state));
        return overrides.save?.(state);
      },
    ),
    check: jest.fn(
      async (task: import('../src/features/groups/types').GroupTask) =>
        overrides.check ? overrides.check(task) : pending(),
    ),
    execute: jest.fn(
      async (task: import('../src/features/groups/types').GroupTask) =>
        overrides.execute ? overrides.execute(task) : success(),
    ),
    wait: jest.fn(async (ms: number) => {
      await overrides.wait?.(ms);
    }),
    timeout: overrides.timeout,
  };
  return { queue: new GroupQueue(adapter), adapter, snapshots };
}
describe('verified group queue', () => {
  it('keeps the same group distinct across accounts, deduplicates exact targets, persists before each mutation and paces them', async () => {
    const { queue, adapter, snapshots } = setup();
    adapter.execute.mockImplementation(async task => {
      expect(
        snapshots.at(-1).batches[0].tasks.find(t => t.id === task.id).token,
      ).toBe(task.token);
      return success();
    });
    await queue.start(
      'mute',
      [target, target, { ...target, accountId: 'account-b' }],
      3,
    );
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'success',
      'success',
    ]);
    expect(adapter.execute).toHaveBeenCalledTimes(2);
    expect(adapter.wait).toHaveBeenCalledWith(3000);
  });
  it('does not mutate a group already in the desired state', async () => {
    const { queue, adapter } = setup({ check: async () => success() });
    await queue.start('open', [target], 3);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(queue.state.batches[0].tasks[0].attempts).toBe(0);
  });
  it('retries only verified incomplete operations and caps automatic attempts at three', async () => {
    const { queue, adapter } = setup({
      execute: jest.fn(async () => pending()),
    });
    await queue.start('open', [target], 3);
    expect(adapter.execute).toHaveBeenCalledTimes(3);
    expect(adapter.wait).toHaveBeenCalledTimes(2);
    expect(queue.state.batches[0].tasks[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
  });
  it('tries every join once before retrying verified failures once at the end', async () => {
    const order: string[] = [];
    const attempts = new Map<string, number>();
    const codes = [
      'AAAAAAAAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBB',
      'CCCCCCCCCCCCCCCCCCCCCC',
    ];
    const { queue, adapter } = setup({
      execute: async task => {
        order.push(task.target);
        const count = (attempts.get(task.target) || 0) + 1;
        attempts.set(task.target, count);
        return task.target === codes[1] || count === 2 ? success() : pending();
      },
    });
    await queue.start(
      'join',
      codes.map(code => ({ ...target, target: code })),
      5,
    );
    expect(order).toEqual([codes[0], codes[1], codes[2], codes[0], codes[2]]);
    expect(queue.state.batches[0].tasks.map(t => t.attempts)).toEqual([
      2, 1, 2,
    ]);
    expect(adapter.wait).toHaveBeenCalledTimes(4);
  });
  it('does not make a third automatic join attempt when both rounds fail', async () => {
    const { queue, adapter } = setup({ execute: async () => pending() });
    await queue.start(
      'join',
      [{ ...target, target: 'AAAAAAAAAAAAAAAAAAAAAA' }],
      5,
    );
    expect(adapter.execute).toHaveBeenCalledTimes(2);
    expect(queue.state.batches[0].tasks[0]).toMatchObject({
      status: 'failed',
      attempts: 2,
    });
  });
  it('treats missing admin privileges as failure without repeatedly mutating', async () => {
    const { queue, adapter } = setup({
      check: async () => ({
        status: 'failed',
        message: '不是管理员',
        retryable: false,
      }),
    });
    await queue.start('mute', [target], 3);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(queue.state.batches[0].tasks[0].status).toBe('failed');
  });
  it('keeps approval pending distinct from success and excludes it from failure retries', async () => {
    const { queue, adapter } = setup({
      execute: async () => ({ status: 'approval', message: '待审批' }),
    });
    await queue.start(
      'join',
      [{ ...target, target: 'Abcdefghijklmnopqrstuv' }],
      5,
    );
    expect(queue.state.batches[0].tasks[0].status).toBe('approval');
    await expect(queue.retry(queue.state.batches[0].id)).rejects.toThrow(
      '没有需要重试',
    );
    expect(adapter.wait).not.toHaveBeenCalled();
  });
  it('pauses the queue after a timeout, then reconciles before resuming without repeating the completed mutation', async () => {
    let confirmed = false;
    const execute = jest.fn(async task =>
      task.target === target.target ? new Promise<never>(() => {}) : success(),
    );
    const { queue } = setup({
      timeout: 2,
      execute,
      check: async task =>
        confirmed && task.target === target.target ? success() : pending(),
    });
    await queue.start('mute', [target, { ...target, target: '10002@g.us' }], 3);
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'uncertain',
      'stopped',
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    confirmed = true;
    await queue.retry(queue.state.batches[0].id);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].target).toBe('10002@g.us');
    expect(
      queue.state.batches[0].tasks.every(t => t.status === 'success'),
    ).toBe(true);
  });
  it('never mutates when checkpoint persistence fails', async () => {
    const { queue, adapter } = setup({
      save: async () => {
        throw new Error('disk full');
      },
    });
    await queue.start(
      'leave',
      [target, { ...target, target: '10002@g.us' }],
      3,
    );
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'uncertain',
      'stopped',
    ]);
    expect(queue.error).toContain('disk full');
    expect(queue.active).toBe('');
  });
  it('does not automatically replay interrupted tasks after restarting', async () => {
    const old = setup();
    await old.queue.start(
      'mute',
      [target, { ...target, target: '10002@g.us' }],
      3,
    );
    const saved = structuredClone(old.queue.state);
    saved.batches[0].tasks[0].status = 'running';
    saved.batches[0].tasks[1].status = 'queued';
    const { queue, adapter } = setup({ load: async () => saved });
    await queue.load();
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'uncertain',
      'stopped',
    ]);
    expect(adapter.execute).not.toHaveBeenCalled();
  });
  it('stops after the current operation and retains remaining targets for explicit retry', async () => {
    let finish!: () => void;
    let entered!: () => void;
    const executing = new Promise<void>(r => {
      entered = r;
    });
    const { queue, adapter } = setup({
      execute: jest.fn(async () => {
        entered();
        await new Promise<void>(r => {
          finish = r;
        });
        return success();
      }),
    });
    const running = queue.start(
      'leave',
      [target, { ...target, target: '10002@g.us' }],
      3,
    );
    await executing;
    queue.stop();
    finish();
    await running;
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'success',
      'stopped',
    ]);
  });
  it('refreshes approval results without issuing another join request', async () => {
    let accepted = false;
    const { queue, adapter } = setup({
      check: async () => (accepted ? success() : pending()),
      execute: async () => ({ status: 'approval', message: '等待审批' }),
    });
    await queue.start(
      'join',
      [{ ...target, target: 'Abcdefghijklmnopqrstuv' }],
      5,
    );
    accepted = true;
    await queue.reconcile(queue.state.batches[0].id);
    expect(queue.state.batches[0].tasks[0].status).toBe('success');
    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });
  it('refreshing a failed result only reads state', async () => {
    const { queue, adapter } = setup({ execute: async () => pending() });
    await queue.start('mute', [target], 3);
    await queue.reconcile(queue.state.batches[0].id);
    expect(adapter.execute).toHaveBeenCalledTimes(3);
    expect(queue.state.batches[0].tasks[0].status).toBe('failed');
  });
  it('rechecks accepted joins at the end without adding them to the retry round', async () => {
    const { queue, adapter } = setup({
      check: async task =>
        task.joinSubmitted
          ? { status: 'success', message: '已确认加入', groupId: '10001@g.us' }
          : pending(),
      execute: async () => ({
        status: 'uncertain',
        message: '同步中',
        groupId: '10001@g.us',
        submitted: true,
      }),
    });
    await queue.start(
      'join',
      [{ ...target, target: 'Abcdefghijklmnopqrstuv' }],
      5,
    );
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(queue.state.batches[0].tasks[0]).toMatchObject({
      status: 'success',
      attempts: 1,
      joinSubmitted: true,
    });
  });
  it('extracts and deduplicates invites from text, scheme-less URLs and /invite/ links', () => {
    expect(
      parseGroupLinks(
        '欢迎加入我们的群！\n点击这里：https://chat.whatsapp.com/invite/Abcdefghijklmnopqrstuv?mode=ac_t。\n也可以使用 chat.whatsapp.com/Abcdefghijklmnopqrstuv\nhttps://chat.whatsapp.com/BBBBBBBBBBBBBBBBBBBBBB',
      ),
    ).toEqual(['Abcdefghijklmnopqrstuv', 'BBBBBBBBBBBBBBBBBBBBBB']);
  });
  it.each([
    'https://chat.whatsapp.com.evil.example/Abcdefghijklmnopqrstuv',
    'https://evil.example/chat.whatsapp.com/Abcdefghijklmnopqrstuv',
    'evilchat.whatsapp.com/Abcdefghijklmnopqrstuv',
    'https://chat.whatsapp.com@evil.example/Abcdefghijklmnopqrstuv',
    'chat.whatsapp.com/invite/short',
  ])('rejects malformed or disguised invitation hosts: %s', value => {
    expect(() => parseGroupLinks(value)).toThrow();
  });
  it('validates invitation hosts, lines and intervals while merging duplicate links', () => {
    expect(
      parseGroupLinks(
        'https://chat.whatsapp.com/Abcdefghijklmnopqrstuv?mode=ac_t\n\nhttps://chat.whatsapp.com/Abcdefghijklmnopqrstuv',
      ),
    ).toEqual(['Abcdefghijklmnopqrstuv']);
    expect(() =>
      parseGroupLinks(
        'https://chat.whatsapp.com/Abcdefghijklmnopqrstuv\nhttps://evil.example/Abcdefghijklmnopqrstuv',
      ),
    ).toThrow('第 2 行');
    expect(() =>
      parseGroupLinks('http://chat.whatsapp.com/Abcdefghijklmnopqrstuv'),
    ).toThrow();
    const state = defaultGroupState();
    state.intervals.speech = 0;
    expect(() => validateGroupState(state)).toThrow('执行间隔');
  });
});
