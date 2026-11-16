import { bottomUpGroupRecipients } from '../src/features/accountTools/bulkRecipientOrder';
import type { Recipient } from '../src/features/accountTools/config';

const target = (accountId: string, name: string, group = true): Recipient => ({
  accountId,
  name,
  group,
  id: `${name}@${group ? 'g.us' : 'c.us'}`,
});
describe('bottom-up bulk group order', () => {
  it('reverses A/B/C/D without mutating the displayed list', () => {
    const list = ['A', 'B', 'C', 'D'].map(name => target('account', name));
    expect(bottomUpGroupRecipients(list).map(r => r.name)).toEqual([
      'D',
      'C',
      'B',
      'A',
    ]);
    expect(list.map(r => r.name)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('preserves account slots and private recipients in a mixed-account selection', () => {
    const list = [
      target('one', 'A'),
      target('two', 'X'),
      target('one', 'private', false),
      target('one', 'B'),
      target('two', 'Y'),
    ];
    expect(
      bottomUpGroupRecipients(list).map(r => `${r.accountId}:${r.name}`),
    ).toEqual(['one:B', 'two:Y', 'one:private', 'one:A', 'two:X']);
  });
  it('handles empty, single-group and private-only tasks', () => {
    expect(bottomUpGroupRecipients([])).toEqual([]);
    const list = [target('one', 'A'), target('two', 'private', false)];
    expect(bottomUpGroupRecipients(list)).toEqual(list);
  });
});
