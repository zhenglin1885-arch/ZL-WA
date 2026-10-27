import ReactionQueue from '../src/features/reactions/ReactionQueue';
import {
  defaultReactionPreferences,
  encodeReactionState,
  decodeReactionState,
  validateReactionState,
  type ReactionState,
} from '../src/features/reactions/types';

const largeHistory = (): ReactionState => {
  const body = '原始匹配正文，核验时必须保持完整。'.repeat(180);
  const rules = { ...defaultReactionPreferences(), text: body };
  return {
    preferences: rules,
    batches: Array.from({ length: 6 }, (_b, b) => ({
      id: `batch-${b}`,
      created: 1000 + b,
      rules,
      tasks: Array.from({ length: 432 }, (_t, t) => ({
        id: `batch-${b}-${t}`,
        accountId: `account-${t % 3}`,
        accountName: `账号${t % 3}`,
        ownerId: `861380000000${t % 3}@c.us`,
        target: `${10_001 + Math.floor(t / 3)}@g.us`,
        name: `群${Math.floor(t / 3)}`,
        messageId: `false_${10_001 + Math.floor(t / 3)}@g.us_MSG${b}`,
        text: body,
        timestamp: 1000,
        emoji: '👍',
        plannedAt: 2000,
        status: (t % 3 === 0
          ? 'success'
          : t % 3 === 1
            ? 'uncertain'
            : 'queued') as 'success' | 'uncertain' | 'queued',
        result: '保留原执行结果',
      })),
    })),
  };
};

describe('compact reaction history without discarding task data', () => {
  it('keeps multi-account histories above the former raw size limit and round-trips every message and checkpoint', () => {
    const state = largeHistory();
    expect(JSON.stringify(state).length).toBeGreaterThan(5_000_000);
    const stored = encodeReactionState(validateReactionState(state));
    expect(JSON.stringify(stored).length).toBeLessThan(1_500_000);
    expect(stored.texts).toHaveLength(1);
    expect(decodeReactionState(JSON.parse(JSON.stringify(stored)))).toEqual(
      state,
    );
    expect(decodeReactionState(state)).toEqual(state);
  });
  it('stores a shared reference image once and omits transient result thumbnails', () => {
    const state = largeHistory();
    const picture = {
      name: 'reference.jpg',
      width: 100,
      height: 100,
      pixels: Array.from({ length: 3072 }, () => 128),
      preview: 'data:image/jpeg;base64,YQ==',
    };
    state.preferences = { ...state.preferences, content: 'image', picture };
    for (const batch of state.batches) {
      batch.rules = state.preferences;
      batch.tasks[0].imagePreview = 'transient';
    }
    const stored = encodeReactionState(state);
    expect(stored.pictures).toHaveLength(1);
    const restored = decodeReactionState(stored);
    expect(restored.batches[5].rules.picture).toEqual(picture);
    expect(restored.batches[5].tasks[0].imagePreview).toBeUndefined();
    expect(restored.batches[5].tasks[0].text).toBe(
      state.batches[5].tasks[0].text,
    );
  });
  it.each([-1, 0.5, 100])('rejects invalid text references: %s', index => {
    const stored = encodeReactionState(largeHistory());
    stored.batches[0].tasks[0].textIndex = index;
    expect(() => decodeReactionState(stored)).toThrow('压缩记录无效');
  });
  it('still rejects genuinely oversized distinct bodies rather than silently truncating evidence', () => {
    const state = largeHistory();
    for (const [index, task] of state.batches
      .flatMap(batch => batch.tasks)
      .entries())
      task.text = `${index}:${'x'.repeat(3000)}`;
    expect(() => validateReactionState(state)).toThrow('记录过大');
  });
  it('preserves previous history and sends nothing when the initial checkpoint cannot be saved', async () => {
    const state = largeHistory();
    const save = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('disk full'));
    const execute = jest.fn();
    const queue = new ReactionQueue({ load: async () => state, save, execute });
    await queue.load();
    const before = structuredClone(queue.state);
    await expect(
      queue.start([state.batches[0].tasks[0]], state.preferences),
    ).rejects.toThrow('disk full');
    expect(queue.state).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
    expect(queue.active).toBe('');
  });
});
