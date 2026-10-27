import type { GroupTarget } from '../groups/types';

export const reactionEmojis = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '🙏',
  '😊',
  '😎',
  '😍',
  '🥳',
  '👏',
  '🤝',
  '💐',
  '🌹',
  '🍀',
  '🚀',
  '🎉',
  '✅',
];
export interface ReactionPicture {
  name: string;
  width: number;
  height: number;
  pixels: number[];
  preview: string;
}
export interface ReactionPreferences {
  content?: 'text' | 'image';
  picture?: ReactionPicture;
  text: string;
  match: 'exact' | 'contains' | 'normalized';
  emojis: string[];
  timing: 'interval' | 'window';
  minSeconds: number;
  maxSeconds: number;
  start: number;
  end: number;
}
export interface ReactionMatch extends GroupTarget {
  imageHash?: string;
  imagePreview?: string;
  messageId?: string;
  text?: string;
  timestamp?: number;
  error?: string;
}
export type ReactionStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'uncertain'
  | 'stopped';
export interface ReactionTask extends ReactionMatch {
  id: string;
  emoji: string;
  plannedAt: number;
  status: ReactionStatus;
  result: string;
}
export interface ReactionBatch {
  id: string;
  created: number;
  rules: ReactionPreferences;
  tasks: ReactionTask[];
}
export interface ReactionState {
  preferences: ReactionPreferences;
  batches: ReactionBatch[];
}
type StoredRules = Omit<ReactionPreferences, 'text' | 'picture'> & {
  textIndex: number;
  pictureIndex?: number;
};
type StoredTask = Omit<ReactionTask, 'text' | 'imagePreview'> & {
  textIndex?: number;
};
interface StoredReactions {
  format: 'zl-reactions-1';
  texts: string[];
  pictures: ReactionPicture[];
  preferences: StoredRules;
  batches: (Omit<ReactionBatch, 'rules' | 'tasks'> & {
    rules: StoredRules;
    tasks: StoredTask[];
  })[];
}

// Keep full matching text for later read-only verification, but persist each
// distinct body/reference picture once across all accounts and history.
export function encodeReactionState(state: ReactionState): StoredReactions {
  const texts: string[] = [];
  const pictures: ReactionPicture[] = [];
  const textIndices = new Map<string, number>();
  const pictureIndices = new Map<string, number>();
  const textIndex = (value: string) => {
    if (!textIndices.has(value)) {
      textIndices.set(value, texts.length);
      texts.push(value);
    }
    return textIndices.get(value)!;
  };
  const rulesOf = (rules: ReactionPreferences): StoredRules => {
    const { text: body, picture, ...fields } = rules;
    let pictureIndex: number | undefined;
    if (picture) {
      const key = JSON.stringify(picture);
      if (!pictureIndices.has(key)) {
        pictureIndices.set(key, pictures.length);
        pictures.push(picture);
      }
      pictureIndex = pictureIndices.get(key)!;
    }
    return {
      ...fields,
      textIndex: textIndex(body),
      ...(picture ? { pictureIndex } : {}),
    };
  };
  return {
    format: 'zl-reactions-1',
    texts,
    pictures,
    preferences: rulesOf(state.preferences),
    batches: state.batches.map(batch => ({
      ...batch,
      rules: rulesOf(batch.rules),
      tasks: batch.tasks.map(task => {
        const { text: body, ...fields } = task;
        delete fields.imagePreview;
        return {
          ...fields,
          ...(body === undefined ? {} : { textIndex: textIndex(body) }),
        };
      }),
    })),
  };
}

const invalidStoredReactions = () => new Error('点赞压缩记录无效');

function expandReactionState(stored: StoredReactions): ReactionState {
  if (
    !Array.isArray(stored.texts) ||
    stored.texts.length > 20_021 ||
    stored.texts.some(
      value => typeof value !== 'string' || value.length > 20_000,
    ) ||
    !Array.isArray(stored.pictures) ||
    stored.pictures.length > 21 ||
    !Array.isArray(stored.batches) ||
    stored.batches.length > 20 ||
    JSON.stringify(stored).length > 5_000_000
  )
    throw invalidStoredReactions();
  const textAt = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= stored.texts.length)
      throw invalidStoredReactions();
    return stored.texts[index];
  };
  const rulesOf = (rules: StoredRules): ReactionPreferences => {
    if (!rules) throw invalidStoredReactions();
    const { textIndex, pictureIndex, ...fields } = rules;
    if (
      pictureIndex !== undefined &&
      (!Number.isInteger(pictureIndex) ||
        pictureIndex < 0 ||
        pictureIndex >= stored.pictures.length)
    )
      throw invalidStoredReactions();
    return {
      ...fields,
      text: textAt(textIndex),
      ...(pictureIndex === undefined
        ? {}
        : { picture: stored.pictures[pictureIndex] }),
    };
  };
  return {
    preferences: rulesOf(stored.preferences),
    batches: stored.batches.map(batch => {
      if (!batch || !Array.isArray(batch.tasks) || batch.tasks.length > 1000)
        throw invalidStoredReactions();
      return {
        ...batch,
        rules: rulesOf(batch.rules),
        tasks: batch.tasks.map(task => {
          if (!task) throw invalidStoredReactions();
          const { textIndex, ...fields } = task;
          return {
            ...fields,
            ...(textIndex === undefined ? {} : { text: textAt(textIndex) }),
          };
        }),
      };
    }),
  };
}

export interface ReactionResult {
  status: 'success' | 'failed' | 'uncertain';
  message: string;
  inFlight?: boolean;
}
export const defaultReactionPreferences = (): ReactionPreferences => ({
  text: '',
  match: 'exact',
  emojis: ['👍'],
  timing: 'window',
  minSeconds: 3,
  maxSeconds: 15,
  start: Date.now() + 60_000,
  end: Date.now() + 4 * 3_600_000,
});
export const defaultReactionState = (): ReactionState => ({
  preferences: defaultReactionPreferences(),
  batches: [],
});
export function validateReactionPreferences(
  input: unknown,
): ReactionPreferences {
  const p = input as ReactionPreferences;
  if (
    !p ||
    typeof p.text !== 'string' ||
    p.text.length > 20_000 ||
    (p.content !== undefined && !['text', 'image'].includes(p.content)) ||
    !['exact', 'contains', 'normalized'].includes(p.match) ||
    !Array.isArray(p.emojis) ||
    p.emojis.length === 0 ||
    p.emojis.length > reactionEmojis.length ||
    p.emojis.some(e => !reactionEmojis.includes(e)) ||
    !['interval', 'window'].includes(p.timing) ||
    !Number.isFinite(p.minSeconds) ||
    !Number.isFinite(p.maxSeconds) ||
    p.minSeconds < 1 ||
    p.maxSeconds > 86_400 ||
    p.maxSeconds < p.minSeconds ||
    !Number.isFinite(p.start) ||
    !Number.isFinite(p.end) ||
    p.start < 0 ||
    p.end <= p.start
  )
    throw new Error('点赞文字、表情或执行时间设置无效');
  if (p.content === 'image' && !p.picture)
    throw new Error('请先上传要匹配的图片');
  if (
    p.picture &&
    (typeof p.picture.name !== 'string' ||
      p.picture.name.length > 255 ||
      !Number.isFinite(p.picture.width) ||
      p.picture.width <= 0 ||
      !Number.isFinite(p.picture.height) ||
      p.picture.height <= 0 ||
      !Array.isArray(p.picture.pixels) ||
      p.picture.pixels.length !== 3072 ||
      p.picture.pixels.some(v => !Number.isInteger(v) || v < 0 || v > 255) ||
      typeof p.picture.preview !== 'string' ||
      p.picture.preview.length > 150_000 ||
      !/^data:image\/jpeg;base64,[\d+/=A-Za-z]+$/.test(p.picture.preview))
  )
    throw new Error('图片匹配数据无效，请重新上传图片');
  return structuredClone(p);
}
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max;
export function validateReactionState(input: unknown): ReactionState {
  const s = input as ReactionState;
  validateReactionPreferences(s?.preferences);
  if (!Array.isArray(s.batches) || s.batches.length > 20)
    throw new Error('点赞记录无效');
  const ids = new Set<string>();
  for (const b of s.batches) {
    validateReactionPreferences(b.rules);
    if (
      !text(b.id, 100) ||
      !b.id ||
      ids.has(b.id) ||
      !Number.isFinite(b.created) ||
      !Array.isArray(b.tasks) ||
      b.tasks.length > 1000
    )
      throw new Error('点赞任务无效');
    ids.add(b.id);
    const taskIds = new Set<string>();
    for (const t of b.tasks) {
      if (
        !t ||
        !text(t.id, 100) ||
        !t.id ||
        taskIds.has(t.id) ||
        typeof t.accountId !== 'string' ||
        !/^[\da-z-]{1,100}$/i.test(t.accountId) ||
        !/^\d{5,30}@(c\.us|lid)$/.test(t.ownerId) ||
        !/^\d{1,40}(-\d{1,30})?@g\.us$/.test(t.target) ||
        !text(t.accountName, 500) ||
        !text(t.name, 500) ||
        !text(t.result, 2000) ||
        (t.text !== undefined && !text(t.text, 20_000)) ||
        (t.error !== undefined && !text(t.error, 2000)) ||
        (t.imageHash !== undefined && !text(t.imageHash, 500)) ||
        (t.messageId !== undefined &&
          (!text(t.messageId, 500) || !t.messageId)) ||
        !reactionEmojis.includes(t.emoji) ||
        !Number.isFinite(t.plannedAt) ||
        ![
          'queued',
          'running',
          'success',
          'failed',
          'uncertain',
          'stopped',
        ].includes(t.status)
      )
        throw new Error('点赞任务对象或状态无效');
      if (
        ['queued', 'running', 'success', 'uncertain'].includes(t.status) &&
        !t.messageId
      )
        throw new Error('点赞任务缺少消息编号');
      taskIds.add(t.id);
    }
  }
  const stored = encodeReactionState(s);
  if (JSON.stringify(stored).length > 5_000_000)
    throw new Error(
      '点赞任务记录过大（重复内容已合并，请减少本次对象或匹配正文长度）',
    );
  // Clone the compact pool rather than copying the same large body once per task.
  return expandReactionState(structuredClone(stored));
}

// Accept previous uncompressed files and the compact IPC/disk representation.
export function decodeReactionState(input: unknown): ReactionState {
  const stored = input as StoredReactions;
  return validateReactionState(
    stored?.format === 'zl-reactions-1' ? expandReactionState(stored) : input,
  );
}
