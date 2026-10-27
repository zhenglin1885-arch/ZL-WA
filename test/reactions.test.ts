/* eslint-disable no-await-in-loop, unicorn/consistent-function-scoping, @typescript-eslint/no-dynamic-delete -- Sequential queue completion and scoped mutable guest fixtures. */
import ReactionQueue from '../src/features/reactions/ReactionQueue';
import { reactionGuest } from '../src/features/reactions/guest';
import {
  defaultReactionPreferences,
  defaultReactionState,
  validateReactionState,
  type ReactionMatch,
} from '../src/features/reactions/types';

const ownerId = '8613800000001@c.us';
const groupId = '10001@g.us';
const rules = () => ({
  ...defaultReactionPreferences(),
  text: '你好吗',
  timing: 'interval' as const,
  minSeconds: 1,
  maxSeconds: 3,
  emojis: ['👍', '❤️'],
});
const match = (accountId = 'account-a', target = groupId): ReactionMatch => ({
  accountId,
  accountName: accountId,
  ownerId,
  target,
  name: '测试群',
  messageId: `false_${target}_A`,
  text: '你好吗',
  timestamp: 1000,
});
const finish = async (queue: ReactionQueue) => {
  for (let i = 0; i < 200 && queue.active; i += 1)
    await new Promise(r => {
      setImmediate(r);
    });
  expect(queue.active).toBe('');
};
const harness = (overrides: Record<string, any> = {}) => {
  let now = Date.now();
  let saved = defaultReactionState();
  const execute = jest.fn(async () => ({
    status: 'success' as const,
    message: '已发送',
  }));
  const save = jest.fn(async s => {
    saved = structuredClone(validateReactionState(s));
  });
  const queue = new ReactionQueue({
    load: async () => saved,
    save,
    execute,
    now: () => now,
    random: () => 0.5,
    wait: async ms => {
      now += ms;
    },
    ...overrides,
  });
  return {
    queue,
    execute,
    save,
    get saved() {
      return saved;
    },
    get now() {
      return now;
    },
  };
};
describe('one-shot reaction scheduling', () => {
  it('schedules multi-account tasks at distinct random slots in the window and persists before sending', async () => {
    const h = harness();
    const start = h.now + 60_000;
    await h.queue.start(
      [match(), match('account-b'), match('account-a', '10002@g.us')],
      { ...rules(), timing: 'window', start, end: start + 4 * 3_600_000 },
    );
    await finish(h.queue);
    const { tasks } = h.queue.state.batches[0];
    expect(new Set(tasks.map(t => t.plannedAt)).size).toBe(3);
    expect(
      tasks.every(
        t =>
          t.plannedAt >= start &&
          t.plannedAt < start + 4 * 3_600_000 &&
          t.status === 'success',
      ),
    ).toBe(true);
    expect(h.execute).toHaveBeenCalledTimes(3);
    expect(tasks.every(t => t.emoji === '❤️')).toBe(true);
    expect(
      h.save.mock.calls.some(([s]) =>
        s.batches[0]?.tasks.some(t => t.status === 'running'),
      ),
    ).toBe(true);
  });
  it('uses the shared interval between completion and the next dispatch without overlap', async () => {
    let running = 0;
    const times: number[] = [];
    const h = harness({
      execute: async () => {
        running += 1;
        expect(running).toBe(1);
        times.push(h.now);
        await new Promise(r => {
          setImmediate(r);
        });
        running -= 1;
        return { status: 'success', message: 'ok' };
      },
    });
    await h.queue.start(
      [match(), match('account-b'), match('account-c')],
      rules(),
    );
    await finish(h.queue);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1000);
  });
  it('keeps no-match errors as individual failures and sends only matched items', async () => {
    const h = harness();
    await h.queue.start(
      [
        match(),
        { ...match('account-b'), messageId: undefined, error: '未找到消息' },
      ],
      rules(),
    );
    await finish(h.queue);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(
      h.saved.batches[0].tasks.find(t => t.accountId === 'account-b'),
    ).toMatchObject({ status: 'failed', result: '未找到消息' });
  });
  it('rejects past windows or invalid intervals before sending', async () => {
    const h = harness();
    await expect(
      h.queue.start([match()], {
        ...rules(),
        timing: 'window',
        start: 1,
        end: 2,
      }),
    ).rejects.toThrow('可用时间段');
    await expect(
      h.queue.start([match()], { ...rules(), minSeconds: 5, maxSeconds: 1 }),
    ).rejects.toThrow();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('stops pending schedules without sending', async () => {
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      entered = resolve;
    });
    let release!: () => void;
    const h = harness({
      wait: async () => {
        entered();
        await new Promise<void>(r => {
          release = r;
        });
      },
    });
    await h.queue.start([match()], rules());
    await waiting;
    h.queue.stop();
    release();
    await finish(h.queue);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.saved.batches[0].tasks[0].status).toBe('stopped');
  });
  it('does not replay interrupted or uncertain tasks after restart', async () => {
    const h = harness();
    await h.queue.start([match()], rules());
    await finish(h.queue);
    const state = structuredClone(h.saved);
    state.batches[0].tasks[0].status = 'running';
    const other = harness({ load: async () => state });
    await other.queue.load();
    expect(other.queue.state.batches[0].tasks[0].status).toBe('uncertain');
    other.queue.resume(state.batches[0].id);
    await finish(other.queue);
    expect(other.execute).not.toHaveBeenCalled();
  });
  it('expires remaining tasks rather than sending beyond the end', async () => {
    const h = harness();
    await h.queue.load();
    h.queue.state.batches.push({
      id: 'old',
      created: 1,
      rules: { ...rules(), timing: 'window', start: 1, end: 2 },
      tasks: [
        {
          ...match(),
          id: 'old-1',
          emoji: '👍',
          plannedAt: 1,
          status: 'queued',
          result: '',
        },
      ],
    });
    h.queue.resume('old');
    await finish(h.queue);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.queue.state.batches[0].tasks[0].result).toContain('超过');
  });
  it('requires an explicit resume for queued work loaded after restarting', async () => {
    const h = harness();
    const state = defaultReactionState();
    state.batches.push({
      id: 'restored',
      created: h.now,
      rules: rules(),
      tasks: [
        {
          ...match(),
          id: 'restored-1',
          emoji: '👍',
          plannedAt: h.now + 5000,
          status: 'queued',
          result: '等待',
        },
      ],
    });
    const restored = harness({ load: async () => state });
    await restored.queue.load();
    expect(restored.execute).not.toHaveBeenCalled();
    expect(restored.queue.active).toBe('');
    restored.queue.resume('restored');
    await finish(restored.queue);
    expect(restored.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate account/group selections before any dispatch', async () => {
    const h = harness();
    await expect(h.queue.start([match(), match()], rules())).rejects.toThrow(
      '不能重复',
    );
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('supports image-only tasks and keeps result thumbnails out of stored task records', async () => {
    const h = harness();
    const picture = {
      name: 'reference.png',
      width: 100,
      height: 100,
      pixels: Array.from({ length: 3072 }, () => 128),
      preview: 'data:image/jpeg;base64,YQ==',
    };
    await h.queue.start(
      [
        {
          ...match(),
          imageHash: 'sha256',
          imagePreview: 'ephemeral-thumbnail',
        },
      ],
      { ...rules(), text: '', content: 'image', picture },
    );
    await finish(h.queue);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.saved.batches[0].tasks[0].imageHash).toBe('sha256');
    expect(h.saved.batches[0].tasks[0].imagePreview).toBeUndefined();
    expect(h.saved.preferences.picture).toEqual(picture);
  });
  it('pauses the batch if a timed-out mutation may still be running', async () => {
    const h = harness({
      execute: async () => ({
        status: 'uncertain',
        message: '超时',
        inFlight: true,
      }),
    });
    await h.queue.start([match(), match('account-b')], rules());
    await finish(h.queue);
    expect(
      h.queue.state.batches[0].tasks
        .map(t => t.status)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['stopped', 'uncertain']);
  });
  it('never dispatches when the pre-send storage checkpoint fails', async () => {
    const h = harness();
    h.save.mockImplementation(async s => {
      if (s.batches[0]?.tasks.some(t => t.status === 'running'))
        throw new Error('disk full');
    });
    await h.queue.start([match()], rules());
    await finish(h.queue);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.queue.error).toContain('disk full');
  });
});
describe('reaction guest matching and dispatch', () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let wpp: any;
  const message = (id: string, body = '你好吗', time = 1) => ({
    id: `false_${groupId}_${id}`,
    body,
    type: 'chat',
    t: time,
  });
  beforeEach(() => {
    wpp = {
      isReady: true,
      conn: { getMyUserWid: () => ownerId },
      group: { iAmMember: jest.fn(async () => true) },
      chat: {
        getMessages: jest.fn(async () => []),
        getMessageById: jest.fn(async () => message('A')),
        sendReactionToMessage: jest.fn(async () => ({ sendMsgResult: 'OK' })),
      },
    };
    for (const [key, value] of Object.entries({
      window: { WPP: wpp },
      location: { hostname: 'web.whatsapp.com' },
    })) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, d] of descriptors) {
      if (d) Object.defineProperty(globalThis, key, d);
      else delete (globalThis as any)[key];
    }
  });
  const find = () => reactionGuest({ ownerId, groupId, rules: rules() });
  const send = (overrides = {}) =>
    reactionGuest({
      ownerId,
      groupId,
      rules: rules(),
      messageId: `false_${groupId}_A`,
      expectedText: '你好吗',
      emoji: '👍',
      token: 'a',
      ...overrides,
    });
  it('selects only the newest matching message even if raw rows are unsorted', async () => {
    wpp.chat.getMessages.mockResolvedValue([
      message('old', '你好吗', 1),
      message('new', '你好吗', 3),
      message('other', 'other', 4),
    ]);
    expect(await find()).toMatchObject({
      messageId: `false_${groupId}_new`,
      timestamp: 3000,
    });
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
  it('paginates older history, ignores quoted text and never returns another group', async () => {
    wpp.chat.getMessages
      .mockResolvedValueOnce([
        { ...message('x', '无关'), quotedMsg: { body: '你好吗' } },
        { ...message('z'), id: 'false_999@g.us_Z' },
      ])
      .mockResolvedValueOnce([message('found')]);
    expect(await find()).toMatchObject({ messageId: `false_${groupId}_found` });
    expect(wpp.chat.getMessages).toHaveBeenCalledTimes(2);
  });
  it('matches media captions and supports normalized/contains text', async () => {
    wpp.chat.getMessages.mockResolvedValue([
      { ...message('cap'), body: '', caption: '你 好，吗？', type: 'image' },
    ]);
    expect(
      await reactionGuest({
        ownerId,
        groupId,
        rules: { ...rules(), match: 'normalized' },
      }),
    ).toHaveProperty('messageId');
    wpp.chat.getMessages.mockResolvedValue([
      message('contains', '问候：你好吗？'),
    ]);
    expect(
      await reactionGuest({
        ownerId,
        groupId,
        rules: { ...rules(), match: 'contains' },
      }),
    ).toHaveProperty('messageId');
  });
  it('reports not-found and rate limits without sending', async () => {
    expect(await find()).toHaveProperty('error');
    wpp.chat.getMessages.mockRejectedValue(new Error('rate-overlimit'));
    await expect(find()).rejects.toThrow('rate-overlimit');
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
  it('guards account identity and membership', async () => {
    await expect(send({ ownerId: '8613900000000@c.us' })).rejects.toThrow(
      '登录身份',
    );
    wpp.group.iAmMember.mockResolvedValue(false);
    await expect(send()).rejects.toThrow('不在该群');
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
  it('accepts device-qualified identity while a new-login LID getter is unavailable', async () => {
    wpp.conn.getMyUserWid = () => '8613800000001:6@c.us';
    wpp.conn.getMyUserLid = () => {
      throw new Error('not available yet');
    };
    expect(await send()).toMatchObject({ status: 'success' });
  });
  it('sends one native reaction and deduplicates the exact task token', async () => {
    expect(await send()).toMatchObject({ status: 'success' });
    expect(await send()).toMatchObject({ status: 'success' });
    expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledTimes(1);
    expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledWith(
      `false_${groupId}_A`,
      '👍',
    );
  });
  it('refuses deleted, edited, unrelated or moved messages at dispatch time', async () => {
    wpp.chat.getMessageById.mockResolvedValue(message('A', 'changed'));
    expect(await send()).toMatchObject({ status: 'failed' });
    wpp.chat.getMessageById.mockResolvedValue({
      ...message('A'),
      isRevoked: true,
    });
    expect(await send({ token: 'b' })).toMatchObject({ status: 'failed' });
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
  it('distinguishes server rejection from ambiguous transport errors without automatic retries', async () => {
    wpp.chat.sendReactionToMessage
      .mockRejectedValueOnce(new Error('ServerStatusCodeError: rate-overlimit'))
      .mockRejectedValueOnce(new Error('connection lost'));
    expect(await send()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('限流'),
    });
    expect(await send({ token: 'b' })).toMatchObject({ status: 'uncertain' });
    expect(await send({ token: 'b' })).toMatchObject({ status: 'uncertain' });
    expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledTimes(2);
  });
  it('does not falsely confirm a non-OK acknowledgement', async () => {
    wpp.chat.sendReactionToMessage.mockResolvedValue({
      sendMsgResult: 'ERROR',
    });
    expect(await send()).toMatchObject({ status: 'uncertain' });
  });
  it('confirms an empty native return using this account reaction without resending', async () => {
    wpp.chat.sendReactionToMessage.mockResolvedValue({
      sendMsgResult: undefined,
    });
    wpp.chat.getReactions = jest.fn(async () => ({
      reactionByMe: { reactionText: '👍', senderUserJid: ownerId },
    }));
    expect(await send()).toMatchObject({
      status: 'success',
      message: expect.stringContaining('已核验'),
    });
    expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledTimes(1);
  });
  it('checks old uncertain results without requiring or invoking any send API', async () => {
    delete wpp.chat.sendReactionToMessage;
    wpp.chat.getReactions = jest.fn(async () => ({
      reactionByMe: { reactionText: '👍', senderUserJid: ownerId },
    }));
    expect(await send({ verifyOnly: true })).toMatchObject({
      status: 'success',
    });
    expect(wpp.chat.getReactions).toHaveBeenCalledWith(`false_${groupId}_A`);
  });
  it('does not confirm another sender, a different emoji or a pending optimistic reaction', async () => {
    jest.useFakeTimers();
    try {
      for (const mine of [
        { reactionText: '👍', senderUserJid: '8613900000000@c.us' },
        { reactionText: '❤️', senderUserJid: ownerId },
        { reactionText: '👍', senderUserJid: ownerId, ack: 0 },
      ]) {
        wpp.chat.getReactions = async () => ({ reactionByMe: mine });
        const pending = send({ verifyOnly: true });
        await jest.advanceTimersByTimeAsync(3000);
        expect(await pending).toMatchObject({ status: 'uncertain' });
      }
      expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('waits for reaction acknowledgement and respects explicit failure flags', async () => {
    jest.useFakeTimers();
    try {
      wpp.whatsapp = {
        functions: {
          getReactions: jest
            .fn()
            .mockResolvedValueOnce({
              reactionByMe: { reactionText: '👍', ack: 0 },
            })
            .mockResolvedValue({
              reactionByMe: { reactionText: '👍', ack: 1 },
            }),
        },
      };
      wpp.chat.sendReactionToMessage.mockResolvedValue();
      const pending = send();
      await jest.advanceTimersByTimeAsync(3000);
      expect(await pending).toMatchObject({ status: 'success' });
      wpp.whatsapp.functions.getReactions.mockResolvedValue({
        reactionByMe: { reactionText: '👍', isSendFailure: true },
      });
      expect(await send({ verifyOnly: true })).toMatchObject({
        status: 'failed',
      });
      expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it('finds the newest visually matched image without relying on captions', async () => {
    const picture = {
      name: 'reference.png',
      width: 100,
      height: 100,
      pixels: Array.from({ length: 3072 }, () => 128),
      preview: 'data:image/jpeg;base64,YQ==',
    };
    const imageRules = {
      ...rules(),
      text: '',
      content: 'image' as const,
      picture,
    };
    const old = {
      ...message('old', '', 1),
      type: 'image',
      filehash: 'old-hash',
    };
    const latest = {
      ...message('latest', 'caption is different', 2),
      type: 'image',
      filehash: 'new-hash',
    };
    const other = {
      ...message('other', '', 3),
      type: 'image',
      filehash: 'different',
    };
    wpp.chat.getMessages.mockResolvedValue([
      old,
      latest,
      other,
      message('text', 'reference.png', 4),
    ]);
    wpp.chat.downloadMedia = jest.fn(async id => ({ id }));
    const reader = jest.fn(async blob => ({
      ...picture,
      matches: !blob.id.endsWith('_other'),
    }));
    expect(
      await reactionGuest(
        { ownerId, groupId, rules: imageRules },
        reader as any,
      ),
    ).toMatchObject({
      messageId: latest.id,
      imageHash: 'new-hash',
      imagePreview: picture.preview,
    });
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
  it('rechecks the exact matched image before sending and rejects a changed picture', async () => {
    const picture = {
      name: 'reference.png',
      width: 100,
      height: 100,
      pixels: Array.from({ length: 3072 }, () => 128),
      preview: 'data:image/jpeg;base64,YQ==',
    };
    wpp.chat.getMessageById.mockResolvedValue({
      ...message('A', 'new caption'),
      type: 'image',
      filehash: 'same',
    });
    expect(
      await send({
        rules: { ...rules(), content: 'image', picture },
        expectedImageHash: 'same',
      }),
    ).toMatchObject({ status: 'success' });
    expect(
      await send({
        rules: { ...rules(), content: 'image', picture },
        expectedImageHash: 'changed',
        token: 'changed',
      }),
    ).toMatchObject({ status: 'failed' });
    expect(wpp.chat.sendReactionToMessage).toHaveBeenCalledTimes(1);
  });
  it('does not choose an older image if a newer image cannot be decoded', async () => {
    const picture = {
      name: 'reference.png',
      width: 100,
      height: 100,
      pixels: Array.from({ length: 3072 }, () => 128),
      preview: 'data:image/jpeg;base64,YQ==',
    };
    wpp.chat.getMessages.mockResolvedValue([
      { ...message('old', '', 1), type: 'image' },
      { ...message('new', '', 2), type: 'image' },
    ]);
    wpp.chat.downloadMedia = jest.fn(async () => {
      throw new Error('media unavailable');
    });
    const reader = jest.fn();
    expect(
      await reactionGuest(
        { ownerId, groupId, rules: { ...rules(), content: 'image', picture } },
        reader as any,
      ),
    ).toMatchObject({ error: expect.stringContaining('未选择更早图片') });
    expect(wpp.chat.downloadMedia).toHaveBeenCalledTimes(1);
    expect(wpp.chat.sendReactionToMessage).not.toHaveBeenCalled();
  });
});
