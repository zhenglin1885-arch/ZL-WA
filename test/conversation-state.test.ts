import {
  normalizeConversationGroups,
  reorderConversationGroup,
  moveConversations,
  removeConversationGroup,
  conversationGroup,
  searchConversation,
  matchesConversationKind,
  expandedConversations,
} from '../src/features/conversations/state';
import type { AggregateConversation } from '../src/features/conversations/types';

const row = (owner: string): AggregateConversation => ({
  id: '10001@c.us',
  aliases: ['10001@c.us'],
  name: 'João',
  phone: '10001',
  group: false,
  archived: false,
  unread: 0,
  preview: '',
  timestamp: 0,
  key: `${owner}:10001`,
  membershipKey: `${owner}:10001`,
  accountId: owner,
  owner,
  ownerAliases: [owner],
  accountName: 'Account',
  accountRemark: '蓝二号',
  remark: '重点客户',
});
const config = () =>
  normalizeConversationGroups({
    groups: [{ id: 'vip', name: '重点', collapsed: false }],
    members: {},
  });
describe('aggregate conversation folders', () => {
  it('reorders folders above and below targets and persists default-folder position without changing memberships', () => {
    const original = normalizeConversationGroups({
      groups: [
        { id: 'a', name: 'A', collapsed: true },
        { id: 'b', name: 'B', collapsed: false },
      ],
      members: { 'owner:123@c.us': 'a' },
    });
    const up = reorderConversationGroup(original, 'b', 'a', false);
    expect(up.groups.map(g => g.id)).toEqual(['default', 'b', 'a']);
    const down = reorderConversationGroup(up, 'default', 'a', true);
    const restored = normalizeConversationGroups(
      JSON.parse(JSON.stringify(down)),
    );
    expect(restored.groups.map(g => g.id)).toEqual(['b', 'a', 'default']);
    expect(restored.groups[1].collapsed).toBe(true);
    expect(restored.members).toEqual(original.members);
    expect(down.members).toBe(original.members);
    expect(original.groups.map(g => g.id)).toEqual(['default', 'a', 'b']);
    expect(() => removeConversationGroup(restored, 'default')).toThrow();
  });
  it('ignores missing/self drop targets and normalizes duplicate default groups at the saved position', () => {
    const folders = normalizeConversationGroups({
      groups: [
        { id: 'a', name: 'A', collapsed: false },
        { id: 'default', name: '默认分组', collapsed: true },
        { id: 'default', name: '重复', collapsed: false },
      ],
    });
    expect(folders.groups.map(g => g.id)).toEqual(['a', 'default']);
    expect(folders.groups[1].collapsed).toBe(true);
    expect(reorderConversationGroup(folders, 'a', 'a', true)).toBe(folders);
    expect(reorderConversationGroup(folders, 'missing', 'a', false)).toBe(
      folders,
    );
    expect(reorderConversationGroup(folders, 'a', 'missing', true)).toBe(
      folders,
    );
  });
  it('keeps the same contact on different accounts separate and persists only folder membership', () => {
    const a = row('A');
    const b = row('B');
    const moved = moveConversations(config(), [a], 'vip');
    expect(conversationGroup(moved, a)).toBe('vip');
    expect(conversationGroup(moved, b)).toBe('default');
    expect(moved.members).toEqual({ 'A:10001': 'vip' });
    expect(a.id).toBe('10001@c.us');
  });
  it('moves exactly the selected nine conversations even when 139 rows are loaded', () => {
    const rows = Array.from({ length: 139 }, (_, i) => ({
      ...row('A'),
      id: `${10000 + i}@c.us`,
      key: `A:${i}`,
      membershipKey: `A:${i}`,
    }));
    const selected = rows.slice(0, 9).map(item => ({ ...item }));
    const moved = moveConversations(config(), selected, 'vip');
    const restored = normalizeConversationGroups(
      JSON.parse(JSON.stringify(moved)),
    );
    expect(
      rows.filter(item => conversationGroup(restored, item) === 'vip'),
    ).toHaveLength(9);
    expect(
      rows.filter(item => conversationGroup(restored, item) === 'default'),
    ).toHaveLength(130);
  });

  it('returns conversations to default when deleting a folder, and protects default', () => {
    const a = row('A');
    const removed = removeConversationGroup(
      moveConversations(config(), [a], 'vip'),
      'vip',
    );
    expect(conversationGroup(removed, a)).toBe('default');
    expect(() => removeConversationGroup(removed, 'default')).toThrow();
    expect(() => moveConversations(removed, [a], 'vip')).toThrow();
  });
  it('drops stale group references while retaining known membership', () => {
    expect(
      normalizeConversationGroups({ members: { 'A:10001': 'deleted' } })
        .members,
    ).toEqual({});
  });
  it('searches contact and account remarks, phone and accented names', () => {
    for (const query of ['joao', '重点客户', '蓝二号', '10001'])
      expect(searchConversation(row('A'), query)).toBe(true);
    expect(searchConversation(row('A'), 'missing')).toBe(false);
  });
  it('selects only expanded folders and moves no contacts from collapsed folders', () => {
    const a = row('A');
    const b = row('B');
    const folders = moveConversations(config(), [a], 'vip');
    folders.groups[0].collapsed = true;
    const open = expandedConversations(folders, [a, b]);
    expect(open).toEqual([a]);
    const moved = moveConversations(folders, open, 'default');
    expect(moved.members).toEqual({ 'A:10001': 'default' });
    expect(expandedConversations(moved, [a, b])).toEqual([]);
  });
  it.each([false, true])(
    'shows archived private/group rows only in archive (group=%s)',
    group => {
      const archived = { ...row('A'), group, archived: true };
      for (const kind of ['all', 'private', 'group'])
        expect(matchesConversationKind(archived, kind)).toBe(false);
      expect(matchesConversationKind(archived, 'archived')).toBe(true);
      const ordinary = { ...archived, archived: false };
      expect(matchesConversationKind(ordinary, 'all')).toBe(true);
      expect(
        matchesConversationKind(ordinary, group ? 'group' : 'private'),
      ).toBe(true);
      expect(matchesConversationKind(ordinary, 'archived')).toBe(false);
    },
  );
});
