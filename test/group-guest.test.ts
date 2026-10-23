import { groupGuest } from '../src/features/groups/guest';
import type { GroupTask } from '../src/features/groups/types';

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
      wpp.whatsapp.functions.queryAllGroups.mockImplementation(async () => {
        if (joined) checks += 1;
        if (joined && checks >= 3) groups = [{ id: groupId }];
        return structuredClone(groups);
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
});
