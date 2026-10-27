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
  if (JSON.stringify(s).length > 5_000_000) throw new Error('点赞任务记录过大');
  return structuredClone(s);
}
