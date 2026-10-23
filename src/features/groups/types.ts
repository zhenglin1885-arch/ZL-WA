/* eslint-disable no-continue -- Empty invitation lines are skipped. */
export type GroupMode = 'speech' | 'join' | 'leave';
export type GroupOperation = 'open' | 'mute' | 'join' | 'leave';
export type GroupStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'uncertain'
  | 'approval'
  | 'stopped';
export interface GroupTarget {
  accountId: string;
  accountName: string;
  ownerId: string;
  target: string;
  name: string;
}
export interface GroupTask extends GroupTarget {
  id: string;
  operation: GroupOperation;
  status: GroupStatus;
  attempts: number;
  message: string;
  token?: string;
  groupId?: string;
  joinSubmitted?: boolean;
  deleteGroup: boolean;
}
export interface GroupBatch {
  id: string;
  mode: GroupMode;
  interval: number;
  created: string;
  tasks: GroupTask[];
}
export interface GroupToolsState {
  batches: GroupBatch[];
  intervals: Record<GroupMode, number>;
}
export interface GroupResult {
  status: 'success' | 'not-done' | 'failed' | 'uncertain' | 'approval';
  message: string;
  groupId?: string;
  member?: boolean;
  inFlight?: boolean;
  retryable?: boolean;
  submitted?: boolean;
}
export interface GroupChoice extends GroupTarget {
  admin: boolean;
  announce: boolean;
}
export const defaultGroupState = (): GroupToolsState => ({
  batches: [],
  intervals: { speech: 3, join: 5, leave: 5 },
});
export function parseGroupLinks(text: string): string[] {
  const links = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [index, value] of lines.entries()) {
    if (!value.trim()) continue;
    const candidates =
      value.match(
        /https?:\/\/[^\s!"();<>‘’“”。！（），；]+|(?<![\w./:@-])chat\.whatsapp\.com\/[^\s!"();<>‘’“”。！（），；]+/gi,
      ) || [];
    for (const candidate of candidates) {
      // Non-invitation prose is allowed, but any pasted URL must be an invite.
      const normalized = candidate.replace(/[!,.:;?]+$/, '');
      let url: URL;
      try {
        url = new URL(
          /^https?:\/\//i.test(normalized)
            ? normalized
            : `https://${normalized}`,
        );
      } catch {
        throw new Error(`第 ${index + 1} 行不是有效的群链接`);
      }
      const match = /^\/(?:invite\/)?([\w-]{16,64})\/?$/.exec(url.pathname);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'chat.whatsapp.com' ||
        url.username ||
        url.password ||
        url.port ||
        !match
      )
        throw new Error(`第 ${index + 1} 行不是 WhatsApp 群邀请链接`);
      links.add(match[1]);
    }
    if (candidates.length === 0 && /https?:|chat\.whatsapp\.com/i.test(value))
      throw new Error(`第 ${index + 1} 行不是有效的群链接`);
  }
  if (links.size === 0) throw new Error('请填写群邀请链接，一行一条');
  return [...links];
}
export const groupMode = (operation: GroupOperation): GroupMode =>
  ['open', 'mute'].includes(operation) ? 'speech' : (operation as GroupMode);
const shortString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max;
export function validateGroupState(input: unknown): GroupToolsState {
  // Reconstruct plain bounded data at the IPC boundary, including local files.
  const data = input as GroupToolsState;
  if (!data || !Array.isArray(data.batches) || data.batches.length > 12)
    throw new Error('无效群组任务记录');
  for (const mode of ['speech', 'join', 'leave'] as const)
    if (
      !Number.isFinite(data.intervals?.[mode]) ||
      data.intervals[mode] < 1 ||
      data.intervals[mode] > 3600
    )
      throw new Error('执行间隔应为 1–3600 秒');
  let total = 0;
  for (const batch of data.batches) {
    if (Array.isArray(batch.tasks)) total += batch.tasks.length;
    if (
      !shortString(batch.id, 100) ||
      !['speech', 'join', 'leave'].includes(batch.mode) ||
      !Number.isFinite(batch.interval) ||
      batch.interval < 1 ||
      batch.interval > 3600 ||
      !shortString(batch.created, 40) ||
      !Array.isArray(batch.tasks) ||
      total > 10_000
    )
      throw new Error('群组任务记录无效或过多');
    for (const task of batch.tasks)
      if (
        !shortString(task.id, 100) ||
        !/^[\da-z-]{1,100}$/i.test(task.accountId) ||
        !/^\d{5,30}@(c\.us|lid)$/.test(task.ownerId) ||
        !shortString(task.accountName, 200) ||
        !shortString(task.name, 500) ||
        !['open', 'mute', 'join', 'leave'].includes(task.operation) ||
        groupMode(task.operation) !== batch.mode ||
        ![
          'queued',
          'running',
          'success',
          'failed',
          'uncertain',
          'approval',
          'stopped',
        ].includes(task.status) ||
        !Number.isInteger(task.attempts) ||
        task.attempts < 0 ||
        task.attempts > 10_000 ||
        !shortString(task.message, 2000) ||
        typeof task.deleteGroup !== 'boolean' ||
        (task.joinSubmitted !== undefined &&
          typeof task.joinSubmitted !== 'boolean') ||
        (task.token !== undefined && !shortString(task.token, 100)) ||
        (task.groupId !== undefined &&
          !/^\d{1,40}(?:-\d{1,30})?@g\.us$/.test(task.groupId)) ||
        !(
          task.operation === 'join'
            ? /^[\w-]{16,64}$/
            : /^\d{1,40}(?:-\d{1,30})?@g\.us$/
        ).test(task.target)
      )
        throw new Error('无效群组执行对象');
  }
  return structuredClone(data);
}
