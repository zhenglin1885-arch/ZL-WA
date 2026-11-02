import type { AggregateConversation, ConversationGroups } from './types';

export const DEFAULT_CONVERSATION_GROUP = 'default';
export function normalizeConversationGroups(
  raw?: Partial<ConversationGroups>,
): ConversationGroups {
  const groups: ConversationGroups['groups'] = [
    {
      id: 'default',
      name: '默认分组',
      collapsed: Boolean(raw?.groups?.find(g => g.id === 'default')?.collapsed),
    },
  ];
  for (const g of raw?.groups || [])
    if (
      typeof g.id === 'string' &&
      g.id !== 'default' &&
      !groups.some(x => x.id === g.id) &&
      typeof g.name === 'string' &&
      g.name.trim()
    )
      groups.push({
        id: g.id,
        name: g.name.trim().slice(0, 60),
        collapsed: Boolean(g.collapsed),
      });
  return {
    groups,
    members: Object.fromEntries(
      Object.entries(raw?.members || {}).filter(([, id]) =>
        groups.some(g => g.id === id),
      ),
    ),
  };
}
export function conversationGroup(
  config: ConversationGroups,
  row: AggregateConversation,
) {
  return config.members[row.membershipKey] || 'default';
}
export function moveConversations(
  config: ConversationGroups,
  rows: AggregateConversation[],
  group: string,
): ConversationGroups {
  if (!config.groups.some(g => g.id === group)) throw new Error('分组不存在');
  return {
    ...config,
    members: {
      ...config.members,
      ...Object.fromEntries(rows.map(r => [r.membershipKey, group])),
    },
  };
}
export function removeConversationGroup(
  config: ConversationGroups,
  id: string,
): ConversationGroups {
  if (id === 'default') throw new Error('默认分组不能删除');
  return {
    groups: config.groups.filter(g => g.id !== id),
    members: Object.fromEntries(
      Object.entries(config.members).filter(([, group]) => group !== id),
    ),
  };
}
const normalize = (value: string) =>
  value.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase();

export function searchConversation(row: AggregateConversation, query: string) {
  return normalize(
    [
      row.name,
      row.remark,
      row.phone,
      row.id,
      row.accountName,
      row.accountRemark,
    ].join(' '),
  ).includes(normalize(query.trim()));
}
