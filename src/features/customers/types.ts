/* eslint-disable sonar/max-union-size -- Customer actions use a finite protocol shared by host and guest. */
export const customerFlagNames = {
  priority: '重点',
  follow: '跟票',
  signup: '报名',
  deposit: '入金',
} as const;
export type CustomerFlag = keyof typeof customerFlagNames;
export interface CustomerProfile {
  remarkName: string;
  gender: 'male' | 'female' | 'unknown';
  age: string;
  stockholder: 'yes' | 'no' | 'unknown';
  address: string;
  email: string;
  occupation: string;
  income: string;
  tags: string[];
  notes: string;
  flags: CustomerFlag[];
}
export const emptyCustomer = (): CustomerProfile => ({
  remarkName: '',
  gender: 'unknown',
  age: '',
  stockholder: 'unknown',
  address: '',
  email: '',
  occupation: '',
  income: '',
  tags: [],
  notes: '',
  flags: [],
});
export interface CustomerSummary {
  remarkName: string;
  flags: CustomerFlag[];
}
export interface CustomerBundle {
  owner: string;
  revision: number;
  summaries: Record<string, CustomerSummary>;
  aliases: Record<string, string>;
  pins: string[];
  pinsInitialized?: boolean;
  unpinned?: string[];
}
export interface CustomerContext {
  needsLibrary?: boolean;
  token: string;
  owners: string[];
  canInitialize?: boolean;
  installed?: { owner: string; revision: number };
  chat?: {
    id: string;
    aliases: string[];
    name: string;
    phone: string;
    group: boolean;
  };
}
export interface CustomerAction {
  id: number;
  chatId: string;
  action:
    | 'pin'
    | 'unpin'
    | 'up'
    | 'down'
    | 'remark'
    | 'open'
    | 'importPins'
    | 'saveRemark';
  value?: string;
  owner?: string;
}
export function validateCustomer(value: unknown): CustomerProfile {
  if (!value || typeof value !== 'object') throw new Error('无效客户资料');
  const v = value as CustomerProfile;
  const text = (key: keyof CustomerProfile, max: number) => {
    if (typeof v[key] !== 'string' || (v[key] as string).length > max)
      throw new Error('客户资料文字超出长度限制');
    return v[key] as string;
  };
  if (
    !['male', 'female', 'unknown'].includes(v.gender) ||
    !['yes', 'no', 'unknown'].includes(v.stockholder)
  )
    throw new Error('无效客户选项');
  const age = text('age', 3);
  if (age && (!/^\d{1,3}$/.test(age) || Number(age) > 150))
    throw new Error('年龄应为 0–150 的整数');
  if (
    !Array.isArray(v.tags) ||
    v.tags.length > 50 ||
    v.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 50)
  )
    throw new Error('标签最多 50 个，每个最多 50 字');
  if (
    !Array.isArray(v.flags) ||
    v.flags.some(f => !Object.hasOwn(customerFlagNames, f))
  )
    throw new Error('无效客户标记');
  return {
    remarkName: text('remarkName', 100),
    gender: v.gender,
    age,
    stockholder: v.stockholder,
    address: text('address', 300),
    email: text('email', 254),
    occupation: text('occupation', 100),
    income: text('income', 100),
    tags: [...new Set(v.tags.map(t => t.trim()))],
    notes: text('notes', 10_000),
    flags: [...new Set(v.flags)],
  };
}
