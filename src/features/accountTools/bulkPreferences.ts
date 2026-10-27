import type { BulkMessageType } from './config';

export interface BulkPreferences {
  type: BulkMessageType;
  scheduled: boolean;
  randomInterval: boolean;
  intervalMin: number;
  intervalMax: number;
  typingSeconds: number;
  mentionAll: boolean;
  failure: 'stop' | 'continue';
  kind: string;
}
export interface ReplyPreferences extends BulkPreferences {
  replyText: string;
  replyMatch: 'exact' | 'contains' | 'normalized';
}
export const defaultBulkPreferences = (): BulkPreferences => ({
  type: 'text',
  scheduled: false,
  randomInterval: false,
  intervalMin: 1.5,
  intervalMax: 3,
  typingSeconds: 0,
  mentionAll: false,
  failure: 'stop',
  kind: 'all',
});
const number = (n: unknown, fallback: number, min: number, max: number) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
    ? n
    : fallback;

export function normalizeBulkPreferences(value: unknown): BulkPreferences {
  const defaults = defaultBulkPreferences();
  if (!value || typeof value !== 'object') return defaults;
  const v = value as Partial<BulkPreferences>;
  return {
    type: [
      'text',
      'image',
      'caption',
      'video',
      'audio',
      'contact',
      'document',
    ].includes(v.type ?? '')
      ? v.type!
      : defaults.type,
    scheduled: v.scheduled === true,
    randomInterval: v.randomInterval === true,
    intervalMin: number(v.intervalMin, defaults.intervalMin, 0.5, 3600),
    intervalMax: number(v.intervalMax, defaults.intervalMax, 0.5, 3600),
    typingSeconds: number(v.typingSeconds, defaults.typingSeconds, 0, 30),
    mentionAll: v.mentionAll === true,
    failure: v.failure === 'continue' ? 'continue' : 'stop',
    kind: ['all', 'group', 'private', 'contact', 'archived'].includes(
      v.kind ?? '',
    )
      ? v.kind!
      : 'all',
  };
}

export function normalizeReplyPreferences(value: unknown): ReplyPreferences {
  const p = (value || {}) as Partial<ReplyPreferences>;
  return {
    ...normalizeBulkPreferences(value),
    replyText:
      typeof p.replyText === 'string' ? p.replyText.slice(0, 20_000) : '',
    replyMatch: ['exact', 'contains', 'normalized'].includes(p.replyMatch || '')
      ? p.replyMatch!
      : 'exact',
  };
}
