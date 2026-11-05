// ZL-WA account groups are local UI organization, independent of workspaces.
export const DEFAULT_GROUP_ID = 'default';

export interface AccountGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface AccountPreferences {
  groupId?: string;
  remark?: string;
  nickname?: string;
  zoom?: number;
  order?: number;
  manualSleep?: boolean;
}

export interface AccountSidebarConfig {
  collapsed?: boolean;
  groups: AccountGroup[];
  accounts: Record<string, AccountPreferences>;
}

// Electron IPC cannot clone MobX proxies. Copy only the plain preference fields.
export function serializeAccountConfig(
  config: AccountSidebarConfig,
): AccountSidebarConfig {
  return {
    collapsed: Boolean(config.collapsed),
    groups: config.groups.map(group => ({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed,
    })),
    accounts: Object.fromEntries(
      Object.entries(config.accounts).map(([id, prefs]) => [
        id,
        {
          groupId: prefs.groupId,
          remark: prefs.remark,
          nickname: prefs.nickname,
          zoom: prefs.zoom,
          order: prefs.order,
          manualSleep: prefs.manualSleep,
        },
      ]),
    ),
  };
}

export function normalizeAccountConfig(
  raw?: Partial<AccountSidebarConfig>,
): AccountSidebarConfig {
  const seen = new Set([DEFAULT_GROUP_ID]);
  const groups: AccountGroup[] = [
    {
      id: DEFAULT_GROUP_ID,
      name: '默认分组',
      collapsed: Boolean(
        raw?.groups?.find(g => g.id === DEFAULT_GROUP_ID)?.collapsed,
      ),
    },
  ];
  for (const group of raw?.groups ?? []) {
    if (group.id && !seen.has(group.id) && group.name?.trim()) {
      seen.add(group.id);
      groups.push({
        id: group.id,
        name: group.name.trim(),
        collapsed: Boolean(group.collapsed),
      });
    }
  }
  return {
    collapsed: Boolean(raw?.collapsed),
    groups,
    accounts: raw?.accounts ?? {},
  };
}

export function accountGroupId(
  config: AccountSidebarConfig,
  serviceId: string,
): string {
  const id = config.accounts[serviceId]?.groupId;
  return config.groups.some(group => group.id === id) ? id! : DEFAULT_GROUP_ID;
}

export function updateAccount(
  config: AccountSidebarConfig,
  id: string,
  change: AccountPreferences,
): AccountSidebarConfig {
  return {
    ...config,
    accounts: {
      ...config.accounts,
      [id]: { ...config.accounts[id], ...change },
    },
  };
}

export function removeGroup(
  config: AccountSidebarConfig,
  id: string,
): AccountSidebarConfig {
  if (id === DEFAULT_GROUP_ID) throw new Error('默认分组不能删除');
  return {
    ...config,
    groups: config.groups.filter(group => group.id !== id),
    accounts: Object.fromEntries(
      Object.entries(config.accounts).map(([key, value]) => [
        key,
        value.groupId === id ? { ...value, groupId: DEFAULT_GROUP_ID } : value,
      ]),
    ),
  };
}

export function nextZoom(current: number, delta: number): number {
  return Math.max(0.3, Math.min(3, Math.round((current + delta) * 10) / 10));
}

export function orderedAccountIds(
  config: AccountSidebarConfig,
  ids: string[],
): string[] {
  return ids
    .map((id, index) => ({ id, index }))
    .sort(
      (a, b) =>
        (config.accounts[a.id]?.order ?? Number.MAX_SAFE_INTEGER) -
          (config.accounts[b.id]?.order ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(entry => entry.id);
}

export function moveAccount(
  config: AccountSidebarConfig,
  ids: string[],
  source: string,
  target: string,
  after: boolean,
): AccountSidebarConfig {
  if (
    source === target ||
    !ids.includes(source) ||
    !ids.includes(target) ||
    accountGroupId(config, source) !== accountGroupId(config, target)
  )
    return config;
  const order = orderedAccountIds(config, ids).filter(id => id !== source);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, source);
  const accounts = { ...config.accounts };
  for (const [index, id] of order.entries())
    accounts[id] = { ...accounts[id], order: index };
  return { ...config, accounts };
}
