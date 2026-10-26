import { groupGuest } from '../src/features/groups/guest';
import GroupQueue from '../src/features/groups/GroupQueue';
import {
  defaultGroupState,
  parseGroupLinks,
  validateGroupState,
  type GroupTask,
} from '../src/features/groups/types';

const ownerId = '8613800000001@c.us';
const groupId = '10001@g.us';
const task = (operation: GroupTask['operation'] = 'mute'): GroupTask => ({
  id: 'task',
  accountId: 'account-a',
  accountName: 'A',
  ownerId,
  target: operation === 'join' ? 'Abcdefghijklmnopqrstuv' : groupId,
  name: '测试群',
  operation,
  status: 'running',
  attempts: 1,
  message: '',
  token: 'token-a',
  deleteGroup: true,
});
const realQueue = () => {
  const save = jest.fn(async state => {
    validateGroupState(state);
  });
  const queue = new GroupQueue({
    load: async () => defaultGroupState(),
    save,
    check: async t => (await groupGuest({ ownerId, task: t })) as any,
    execute: async t =>
      (await groupGuest({ ownerId, task: t, execute: true })) as any,
    wait: async () => {},
  });
  return { queue, save };
};
describe('native group adapter verification', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let groups: any[];
  let chats: Map<string, any>;
  let wpp: any;
  beforeEach(() => {
    groups = [{ id: groupId, subject: '测试群', announce: false }];
    chats = new Map([[groupId, {}]]);
    wpp = {
      isReady: true,
      conn: { getMyUserWid: () => ownerId },
      whatsapp: {
        functions: {
          queryAllGroups: jest.fn(async () => structuredClone(groups)),
        },
        ChatStore: { get: id => chats.get(id) },
      },
      group: {
        iAmMember: jest.fn(async id => groups.some(g => g.id === id)),
        iAmAdmin: jest.fn(async () => true),
        getGroupInfoFromInviteCode: jest.fn(async () => ({
          id: groupId,
          membershipApprovalMode: false,
        })),
        setProperty: jest.fn(async (id, _prop, value) => {
          groups.find(g => g.id === id).announce = value;
          return true;
        }),
        leave: jest.fn(async id => {
          groups = groups.filter(g => g.id !== id);
        }),
        join: jest.fn(async () => {
          groups = [{ id: groupId, announce: false }];
          return { id: groupId, pendingApproval: false };
        }),
      },
      chat: {
        delete: jest.fn(async id => {
          chats.delete(id);
          return { status: 200 };
        }),
      },
    };
    for (const [key, value] of Object.entries({
      location: { hostname: 'web.whatsapp.com' },
      window: { WPP: wpp },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('reads server group state and verifies the final announcement flag', async () => {
    const result = await groupGuest({ ownerId, task: task(), execute: true });
    expect(result).toMatchObject({ status: 'success', groupId });
    expect(wpp.group.setProperty).toHaveBeenCalledWith(
      groupId,
      'announcement',
      true,
    );
    expect(
      wpp.whatsapp.functions.queryAllGroups.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });
  it('loads groups from the packaged WA-JS functions namespace without a flat alias', async () => {
    expect(wpp.whatsapp.queryAllGroups).toBeUndefined();
    expect(await groupGuest({ ownerId })).toMatchObject({
      groups: [{ id: groupId, name: '测试群', admin: true }],
    });
  });
  it('joins a valid invite using the real namespace and verifies membership', async () => {
    groups = [];
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success', groupId });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
  });
  it('recovers the missing WA-JS join function from a native module split from resetGroupInviteCode', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(
      new TypeError('(0, d.joinGroupViaInvite) is not a function'),
    );
    const native = jest.fn(async () => {
      groups = [{ id: groupId, announce: false }];
      return { gid: groupId };
    });
    (window as any).require = name =>
      name === '__debug'
        ? { modulesMap: { WAWebGroupInviteJob: {} } }
        : name === 'WAWebGroupInviteJob'
          ? { joinGroupViaInvite: native }
          : undefined;
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(native).toHaveBeenCalledWith('Abcdefghijklmnopqrstuv', false);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('keeps pending approval separate when the native fallback requires approval', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(
      new TypeError('joinGroupViaInvite is not a function'),
    );
    wpp.group.getGroupInfoFromInviteCode.mockResolvedValue({
      id: groupId,
      membershipApprovalMode: true,
    });
    const native = jest.fn(async () => ({ gid: groupId }));
    (window as any).require = name =>
      name === '__debug'
        ? { modulesMap: { WAWebGroupInviteJob: {} } }
        : { joinGroupViaInvite: native };
    expect(
      await groupGuest({
        ownerId,
        task: task('join'),
        execute: true,
      }),
    ).toMatchObject({ status: 'approval' });
    expect(native).toHaveBeenCalledWith('Abcdefghijklmnopqrstuv', true);
  });
  it('does not try another join adapter after an ambiguous transport failure', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(new Error('connection lost'));
    const native = jest.fn();
    (window as any).require = () => ({ joinGroupViaInvite: native });
    await groupGuest({ ownerId, task: task('join'), execute: true });
    expect(native).not.toHaveBeenCalled();
  });
  it('bootloads the invite job before the wrapper or native fallback is accessed', async () => {
    groups = [];
    let loaded = false;
    const order: string[] = [];
    wpp.loader = {
      ensureLazyModule: jest.fn(async name => {
        expect(name).toBe('WAWebGroupInviteJob');
        order.push('load');
        loaded = true;
      }),
    };
    wpp.group.join.mockImplementation(async () => {
      order.push('wrapper');
      if (!loaded) throw new Error('invite bundle not loaded');
      throw new TypeError('joinGroupViaInvite is not a function');
    });
    const native = jest.fn(async () => {
      order.push('native');
      groups = [{ id: groupId }];
      return { gid: groupId };
    });
    (window as any).require = name => {
      if (name === '__debug') return { modulesMap: {} };
      if (name === 'WAWebGroupInviteJob' && loaded)
        return { joinGroupViaInvite: native };
      return null;
    };
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success', submitted: true });
    expect(order).toEqual(['load', 'wrapper', 'native']);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('does not bootload or submit when already a member', async () => {
    wpp.loader = { ensureLazyModule: jest.fn() };
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(wpp.loader.ensureLazyModule).not.toHaveBeenCalled();
    expect(wpp.group.join).not.toHaveBeenCalled();
  });
  it('does not submit when the owner changes during bootloading', async () => {
    groups = [];
    wpp.loader = {
      ensureLazyModule: jest.fn(async () => {
        wpp.conn.getMyUserWid = () => '8613800000002@c.us';
      }),
    };
    await groupGuest({ ownerId, task: task('join'), execute: true });
    expect(wpp.group.join).not.toHaveBeenCalled();
  });
  it('does not submit if the invite bundle fails to load', async () => {
    groups = [];
    wpp.loader = {
      ensureLazyModule: jest.fn(async () => {
        throw new Error('bundle load failed');
      }),
    };
    const result = await groupGuest({
      ownerId,
      task: task('join'),
      execute: true,
    });
    expect(result).not.toMatchObject({ status: 'success' });
    expect(wpp.group.join).not.toHaveBeenCalled();
  });
  it('waits only for membership readback after an accepted join, without resubmitting', async () => {
    jest.useFakeTimers();
    try {
      groups = [];
      let joined = false;
      let checks = 0;
      wpp.group.join.mockImplementation(async () => {
        joined = true;
        return { id: groupId, pendingApproval: false };
      });
      wpp.group.iAmMember.mockImplementation(async () => {
        if (joined) checks += 1;
        if (joined && checks >= 3) groups = [{ id: groupId }];
        return groups.some(g => g.id === groupId);
      });
      const execution = groupGuest({
        ownerId,
        task: task('join'),
        execute: true,
      });
      await jest.runAllTimersAsync();
      expect(await execution).toMatchObject({
        status: 'success',
        submitted: true,
      });
      expect(wpp.group.join).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('persists accepted-but-unsynchronized joins as uncertain and never submits on retry', async () => {
    jest.useFakeTimers();
    try {
      groups = [];
      wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: false });
      const execution = groupGuest({
        ownerId,
        task: task('join'),
        execute: true,
      });
      await jest.runAllTimersAsync();
      expect(await execution).toMatchObject({
        status: 'uncertain',
        submitted: true,
        groupId,
      });
      // Simulate a reloaded page without the in-memory operation map.
      (window as any).__zlGroupOperations = new Map();
      const persisted = {
        ...task('join'),
        groupId,
        joinSubmitted: true,
        token: 'retry',
      };
      expect(
        await groupGuest({ ownerId, task: persisted, execute: true }),
      ).toMatchObject({ status: 'uncertain', submitted: true });
      expect(wpp.group.join).toHaveBeenCalledTimes(1);
      groups = [{ id: groupId }];
      expect(await groupGuest({ ownerId, task: persisted })).toMatchObject({
        status: 'success',
        groupId,
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('accepts an applied change even when the request later throws', async () => {
    wpp.group.setProperty.mockImplementation(async () => {
      groups[0].announce = true;
      throw new Error('response lost');
    });
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'success' });
  });
  it('does not call setProperty without admin rights', async () => {
    wpp.group.iAmAdmin.mockResolvedValue(false);
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'failed', retryable: false });
    expect(wpp.group.setProperty).not.toHaveBeenCalled();
  });
  it('only deletes after confirmed exit and retries deletion without leaving again', async () => {
    wpp.chat.delete.mockRejectedValueOnce(new Error('temporary failure'));
    const first = await groupGuest({
      ownerId,
      task: task('leave'),
      execute: true,
    });
    expect(first).toMatchObject({ status: 'not-done' });
    expect(wpp.group.leave).toHaveBeenCalledTimes(1);
    const next = { ...task('leave'), token: 'token-b', attempts: 2 };
    expect(
      await groupGuest({ ownerId, task: next, execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(wpp.group.leave).toHaveBeenCalledTimes(1);
    expect(wpp.chat.delete).toHaveBeenCalledTimes(2);
  });
  it('does not delete when leaving is not confirmed', async () => {
    wpp.group.leave.mockImplementation(async () => {});
    expect(
      await groupGuest({ ownerId, task: task('leave'), execute: true }),
    ).toMatchObject({ status: 'not-done' });
    expect(wpp.chat.delete).not.toHaveBeenCalled();
  });
  it('records approval pending separately and does not repeat the invitation request', async () => {
    groups = [];
    wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: true });
    const current = task('join');
    expect(
      await groupGuest({ ownerId, task: current, execute: true }),
    ).toMatchObject({ status: 'approval' });
    expect(
      await groupGuest({ ownerId, task: current, execute: true }),
    ).toMatchObject({ status: 'approval' });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
  });
  it('recognizes the structured approval race response from the WA-JS wrapper', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(
      Object.assign(new Error('approval mode changed'), {
        name: 'UnexpectedJoinGroupViaInviteResponse',
        gid: groupId,
        membershipApprovalMode: true,
      }),
    );
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'approval', groupId });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
  });
  it('does not rejoin an existing group', async () => {
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(wpp.group.join).not.toHaveBeenCalled();
  });
  it('refuses mutations when the WhatsApp owner changes', async () => {
    wpp.conn.getMyUserWid = () => '8613800000002@c.us';
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'failed', retryable: false });
    expect(wpp.whatsapp.functions.queryAllGroups).not.toHaveBeenCalled();
  });
  it('keeps in-flight requests visible rather than repeating them', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(r => {
      started = r;
    });
    wpp.group.setProperty.mockImplementation(async () => {
      started();
      await new Promise<void>(r => {
        finish = r;
      });
      groups[0].announce = true;
    });
    const current = task();
    const execution = groupGuest({ ownerId, task: current, execute: true });
    await ready;
    expect(await groupGuest({ ownerId, task: current })).toMatchObject({
      status: 'uncertain',
      inFlight: true,
    });
    finish();
    await expect(execution).resolves.toMatchObject({ status: 'success' });
    expect(wpp.group.setProperty).toHaveBeenCalledTimes(1);
  });
  it('does not count a listed pending group as membership', async () => {
    wpp.group.iAmMember.mockResolvedValue(false);
    wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: true });
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'approval' });
  });
  it('does not assume success or mutate when fresh state cannot be read', async () => {
    wpp.whatsapp.functions.queryAllGroups.mockRejectedValue(
      new Error('offline'),
    );
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'uncertain' });
    expect(wpp.group.setProperty).not.toHaveBeenCalled();
  });
  it.each(['join', 'leave'] as const)(
    'executes and verifies %s without querying all groups',
    async operation => {
      if (operation === 'join') groups = [];
      wpp.whatsapp.functions.queryAllGroups.mockRejectedValue(
        new Error('ServerStatusCodeError: rate-overlimit'),
      );
      expect(
        await groupGuest({ ownerId, task: task(operation), execute: true }),
      ).toMatchObject({ status: 'success', groupId });
      expect(wpp.whatsapp.functions.queryAllGroups).not.toHaveBeenCalled();
      expect(wpp.group[operation]).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves native invite lookup rate errors and still attempts a new join', async () => {
    groups = [];
    wpp.whatsapp.functions.sendQueryGroupInvite = jest.fn(async () => {
      throw new Error('ServerStatusCodeError: rate-overlimit');
    });
    wpp.group.join.mockRejectedValue(
      new Error('ServerStatusCodeError: rate-overlimit'),
    );
    const result = await groupGuest({
      ownerId,
      task: task('join'),
      execute: true,
    });
    expect(result).toMatchObject({
      status: 'failed',
      retryable: false,
      rateLimited: true,
      message: expect.stringContaining('服务器限流'),
    });
    expect(result).toMatchObject({
      message: expect.stringContaining('rate-overlimit'),
    });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
    expect(wpp.group.getGroupInfoFromInviteCode).not.toHaveBeenCalled();
    expect(wpp.whatsapp.functions.sendQueryGroupInvite).toHaveBeenCalledTimes(
      1,
    );
  });
  it('can finish a join even when the optional native invite lookup is rate-limited', async () => {
    groups = [];
    wpp.whatsapp.functions.sendQueryGroupInvite = jest.fn(async () => {
      throw new Error('ServerStatusCodeError: rate-overlimit');
    });
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success', submitted: true });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
    expect(wpp.whatsapp.functions.sendQueryGroupInvite).toHaveBeenCalledTimes(
      1,
    );
  });
  it('reports a full group as a definite failure rather than an unknown join', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(new Error('group_full'));
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({
      status: 'failed',
      retryable: false,
      message: expect.stringContaining('人数已满'),
    });
  });
  it('attempts leaving when membership preflight is rate-limited, but does not delete without verification', async () => {
    wpp.group.iAmMember.mockRejectedValue(
      new Error('ServerStatusCodeError: rate-overlimit'),
    );
    expect(
      await groupGuest({ ownerId, task: task('leave'), execute: true }),
    ).toMatchObject({
      status: 'uncertain',
      rateLimited: true,
      message: expect.stringContaining('请求已提交'),
    });
    expect(wpp.group.leave).toHaveBeenCalledTimes(1);
    expect(wpp.chat.delete).not.toHaveBeenCalled();
  });
  it.each(['join', 'leave'] as const)(
    'reports an explicit %s rate rejection as failure instead of unconfirmed',
    async operation => {
      if (operation === 'join') groups = [];
      wpp.group[operation].mockRejectedValue(
        new Error('ServerStatusCodeError: rate-overlimit'),
      );
      expect(
        await groupGuest({ ownerId, task: task(operation), execute: true }),
      ).toMatchObject({
        status: 'failed',
        rateLimited: true,
        message: expect.stringContaining('失败'),
      });
      expect(wpp.chat.delete).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://evil.example/Abcdefghijklmnopqrstuv',
    'chat.whatsapp.com/short',
  ])(
    'records a malformed entry without sending it to WhatsApp: %s',
    async link => {
      expect(
        await groupGuest({
          ownerId,
          task: { ...task('join'), target: link },
          execute: true,
        }),
      ).toMatchObject({
        status: 'failed',
        retryable: false,
        message: expect.stringContaining('无效'),
      });
      expect(wpp.group.join).not.toHaveBeenCalled();
      expect(wpp.group.getGroupInfoFromInviteCode).not.toHaveBeenCalled();
    },
  );
  it('reports a revoked invitation in the result and never resubmits it', async () => {
    groups = [];
    wpp.group.join.mockRejectedValue(new Error('invalid_invite_code: revoked'));
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({
      status: 'failed',
      retryable: false,
      message: expect.stringContaining('已被撤销'),
    });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
  });
  it('does not repeatedly verify or resubmit an accepted join during a metadata rate limit', async () => {
    groups = [];
    wpp.group.iAmMember
      .mockResolvedValueOnce(false)
      .mockRejectedValue(new Error('ServerStatusCodeError: rate-overlimit'));
    wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: false });
    const { queue } = realQueue();
    await queue.start(
      'join',
      [
        {
          accountId: 'account-a',
          accountName: 'A',
          ownerId,
          target: 'Abcdefghijklmnopqrstuv',
          name: 'Invite',
        },
      ],
      5,
    );
    expect(queue.state.batches[0].tasks[0]).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      joinSubmitted: true,
    });
    expect(wpp.group.iAmMember).toHaveBeenCalledTimes(2);
    await queue.retry(queue.state.batches[0].id);
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
    expect(queue.state.batches[0].tasks[0].status).toBe('uncertain');
  });
  it('runs a real mixed invitation batch and persists separate success, invalid, rate and approval results', async () => {
    groups = [];
    const first = 'AAAAAAAAAAAAAAAAAAAAAA';
    const limited = 'BBBBBBBBBBBBBBBBBBBBBB';
    const revoked = 'CCCCCCCCCCCCCCCCCCCCCC';
    const approval = 'DDDDDDDDDDDDDDDDDDDDDD';
    const ids = new Map([
      [first, '90001@g.us'],
      [limited, '90002@g.us'],
      [revoked, '90003@g.us'],
      [approval, '90004@g.us'],
    ]);
    wpp.group.getGroupInfoFromInviteCode.mockImplementation(async code => ({
      id: ids.get(code),
      membershipApprovalMode: code === approval,
    }));
    wpp.group.join.mockImplementation(async code => {
      if (code === limited)
        throw new Error('ServerStatusCodeError: rate-overlimit');
      if (code === revoked) throw new Error('invalid_invite_code: revoked');
      const id = ids.get(code);
      if (code !== approval) groups.push({ id });
      return { id, pendingApproval: code === approval };
    });
    wpp.whatsapp.functions.queryAllGroups.mockRejectedValue(
      new Error('ServerStatusCodeError: rate-overlimit'),
    );
    const { queue, save } = realQueue();
    const links = parseGroupLinks(
      `https://chat.whatsapp.com/${first}\nhttps://evil.example/nope\nhttps://chat.whatsapp.com/${limited}\nhttps://chat.whatsapp.com/${revoked}\nhttps://chat.whatsapp.com/${approval}`,
    );
    await queue.start(
      'join',
      links.map(code => ({
        accountId: 'account-a',
        accountName: 'A',
        ownerId,
        target: code,
        name: code,
      })),
      5,
    );
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'success',
      'failed',
      'failed',
      'failed',
      'approval',
    ]);
    expect(queue.state.batches[0].tasks.every(t => t.attempts === 1)).toBe(
      true,
    );
    expect(queue.state.batches[0].tasks[2].message).toContain('rate-overlimit');
    expect(queue.state.batches[0].tasks[3].message).toContain('已被撤销');
    expect(wpp.group.join.mock.calls.map(([code]) => code)).toEqual([
      first,
      limited,
      revoked,
      approval,
    ]);
    expect(wpp.whatsapp.functions.queryAllGroups).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });
  it('runs real exits despite full-list rate limits and separates a rejected exit from an accepted but unverified exit', async () => {
    const ids = ['10001@g.us', '10002@g.us', '10003@g.us'];
    groups = ids.map(id => ({ id }));
    chats = new Map(ids.map(id => [id, {}]));
    const membershipReads = new Map<string, number>();
    wpp.group.iAmMember.mockImplementation(async id => {
      const count = (membershipReads.get(id) || 0) + 1;
      membershipReads.set(id, count);
      if (id === ids[2] && count > 1)
        throw new Error('ServerStatusCodeError: rate-overlimit');
      return groups.some(g => g.id === id);
    });
    wpp.group.leave.mockImplementation(async id => {
      if (id === ids[1])
        throw new Error('ServerStatusCodeError: rate-overlimit');
      groups = groups.filter(g => g.id !== id);
    });
    wpp.whatsapp.functions.queryAllGroups.mockRejectedValue(
      new Error('ServerStatusCodeError: rate-overlimit'),
    );
    const { queue } = realQueue();
    await queue.start(
      'leave',
      ids.map(id => ({
        accountId: 'account-a',
        accountName: 'A',
        ownerId,
        target: id,
        name: id,
      })),
      5,
    );
    expect(queue.state.batches[0].tasks.map(t => t.status)).toEqual([
      'success',
      'failed',
      'uncertain',
    ]);
    expect(queue.state.batches[0].tasks.map(t => t.attempts)).toEqual([
      1, 1, 1,
    ]);
    expect(wpp.group.leave).toHaveBeenCalledTimes(3);
    expect(wpp.chat.delete.mock.calls.map(([id]) => id)).toEqual([ids[0]]);
    expect(wpp.whatsapp.functions.queryAllGroups).not.toHaveBeenCalled();
  });
});
