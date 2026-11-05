import { observable } from 'mobx';
import {
  accountGroupId,
  normalizeAccountConfig,
  removeGroup,
  updateAccount,
  nextZoom,
  serializeAccountConfig,
  orderedAccountIds,
  moveAccount,
} from '../src/features/accounts/state';

describe('local account organization', () => {
  it('moves cards up or down, persists order and preserves account metadata', () => {
    const config = normalizeAccountConfig({
      accounts: {
        a: { remark: 'keep', zoom: 1.2 },
        b: {},
        c: {},
      },
    });
    const moved = moveAccount(config, ['a', 'b', 'c'], 'c', 'a', false);
    expect(orderedAccountIds(moved, ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    const restored = normalizeAccountConfig(
      JSON.parse(JSON.stringify(serializeAccountConfig(moved))),
    );
    expect(orderedAccountIds(restored, ['a', 'b', 'c', 'new'])).toEqual([
      'c',
      'a',
      'b',
      'new',
    ]);
    const down = moveAccount(restored, ['a', 'b', 'c'], 'c', 'b', true);
    expect(orderedAccountIds(down, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(down.accounts.a).toMatchObject({ remark: 'keep', zoom: 1.2 });
    expect(config.accounts.a.order).toBeUndefined();
  });
  it('does not reorder across groups or for invalid drag targets', () => {
    const config = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: false }],
      accounts: { b: { groupId: 'sales' } },
    });
    expect(moveAccount(config, ['a', 'b'], 'a', 'b', false)).toBe(config);
    expect(moveAccount(config, ['a'], 'missing', 'a', true)).toBe(config);
  });
  it('serializes observable preferences into values Electron IPC can clone', () => {
    const config = normalizeAccountConfig(
      observable({
        groups: [{ id: 'sales', name: '销售', collapsed: false }],
        accounts: { a: { groupId: 'sales', remark: '备注', zoom: 1.1 } },
      }),
    );
    const saved = structuredClone(serializeAccountConfig(config));
    expect(saved.accounts.a.remark).toBe('备注');
    expect(saved.groups[1].name).toBe('销售');
  });
  it('preserves per-account manual sleep through IPC serialization and unrelated preference edits', () => {
    const config = normalizeAccountConfig({
      accounts: {
        sleeping: { manualSleep: true, remark: '备注' },
        awake: { manualSleep: false },
      },
    });
    const saved = JSON.parse(JSON.stringify(serializeAccountConfig(config)));
    expect(saved.accounts.sleeping).toMatchObject({
      manualSleep: true,
      remark: '备注',
    });
    expect(saved.accounts.awake.manualSleep).toBe(false);
    const edited = updateAccount(normalizeAccountConfig(saved), 'sleeping', {
      zoom: 1.2,
    });
    expect(serializeAccountConfig(edited).accounts.sleeping.manualSleep).toBe(
      true,
    );
  });

  it('places existing and unassigned sessions in the default group', () => {
    const config = normalizeAccountConfig();
    expect(config.groups[0].name).toBe('默认分组');
    expect(accountGroupId(config, 'existing-account')).toBe('default');
  });

  it('normalizes duplicate groups and falls back when a saved group is gone', () => {
    const config = normalizeAccountConfig({
      groups: [
        { id: 'sales', name: ' Sales ', collapsed: true },
        { id: 'sales', name: 'Duplicate', collapsed: false },
      ],
      accounts: { a: { groupId: 'missing' } },
    });
    expect(config.groups).toHaveLength(2);
    expect(config.groups[1]).toEqual({
      id: 'sales',
      name: 'Sales',
      collapsed: true,
    });
    expect(accountGroupId(config, 'a')).toBe('default');
  });

  it('moves only the selected account and retains its remark, alias and zoom', () => {
    const config = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: false }],
      accounts: {
        a: { remark: '客户 A', nickname: '备用', zoom: 1.2 },
        b: { remark: '客户 B' },
      },
    });
    const moved = updateAccount(config, 'a', { groupId: 'sales' });
    expect(accountGroupId(moved, 'a')).toBe('sales');
    expect(moved.accounts.a).toEqual({
      remark: '客户 A',
      nickname: '备用',
      zoom: 1.2,
      groupId: 'sales',
    });
    expect(moved.accounts.b.remark).toBe('客户 B');
    expect(config.accounts.a.groupId).toBeUndefined();
  });

  it('returns accounts to default on group deletion without deleting their metadata', () => {
    const config = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: false }],
      accounts: { a: { groupId: 'sales', remark: '保留' } },
    });
    const updated = removeGroup(config, 'sales');
    expect(updated.groups).toHaveLength(1);
    expect(updated.accounts.a).toEqual({ groupId: 'default', remark: '保留' });
    expect(() => removeGroup(config, 'default')).toThrow('默认分组不能删除');
  });

  it('round-trips collapse state and empty notes through saved JSON', () => {
    const original = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: true }],
      accounts: { a: { groupId: 'sales', remark: '', nickname: '' } },
    });
    expect(
      normalizeAccountConfig(JSON.parse(JSON.stringify(original))),
    ).toEqual(original);
  });

  it('changes zoom in exact ten-percent steps and bounds the supported range', () => {
    expect(nextZoom(1.1, 0.1)).toBe(1.2);
    expect(nextZoom(1, -0.1)).toBe(0.9);
    expect(nextZoom(0.3, -0.1)).toBe(0.3);
    expect(nextZoom(3, 0.1)).toBe(3);
  });
});
