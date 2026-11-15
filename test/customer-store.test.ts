import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import CustomerStore from '../src/electron/CustomerStore';
import {
  emptyCustomer,
  validateCustomer,
} from '../src/features/customers/types';

describe('local WhatsApp customers and unlimited pins', () => {
  let root: string;
  let path: string;
  let store: CustomerStore;
  const owner = '8613800000001@c.us';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-customers-'));
    path = join(root, 'customers.json');
    store = new CustomerStore(path);
    store.bind([owner]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('persists explicit native unpins and migrates them across contact aliases', () => {
    store.pin(owner, '30001@lid', 'unpin');
    store.link(owner, ['30001@lid', '30002@c.us']);
    expect(new CustomerStore(path).bundle(owner).unpinned).toEqual([
      '30002@c.us',
    ]);
    expect(store.importPins(owner, ['30002@c.us']).pins).toEqual([]);
    store.pin(owner, '30001@lid', 'pin');
    expect(new CustomerStore(path).bundle(owner).unpinned).toEqual([]);
    expect(store.bundle(owner).pins).toEqual(['30002@c.us']);
  });
  it('imports official pins once, preserves local order and never resurrects unpinned chats', () => {
    store.bind([owner]);
    store.pin(owner, '30001@c.us', 'pin');
    expect(store.importPins(owner, ['30002@c.us', '30003@g.us']).pins).toEqual([
      '30001@c.us',
      '30002@c.us',
      '30003@g.us',
    ]);
    store.pin(owner, '30002@c.us', 'unpin');
    const restored = new CustomerStore(path);
    expect(restored.importPins(owner, ['30002@c.us']).pins).toEqual([
      '30001@c.us',
      '30003@g.us',
    ]);
    expect(restored.bundle(owner).pinsInitialized).toBe(true);
    expect(() => restored.importPins(owner, ['__proto__'])).toThrow();
  });

  it('pins more than three chats newest first and persists stable order', () => {
    const chats = Array.from({ length: 12 }, (_, i) => `${10_000 + i}@c.us`);
    for (const id of chats) store.pin(owner, id, 'pin');
    expect(store.bundle(owner).pins).toEqual([...chats].reverse());
    store.patch(owner, chats[0], { remarkName: 'red note' });
    store.pin(owner, chats[0], 'pin');
    expect(new CustomerStore(path).bundle(owner).pins).toEqual(
      [...chats].reverse(),
    );
    store.pin(owner, chats[0], 'up');
    expect(store.bundle(owner).pins.at(-2)).toBe(chats[0]);
    store.pin(owner, chats[0], 'down');
    store.pin(owner, chats[0], 'unpin');
    expect(store.bundle(owner).pins).not.toContain(chats[0]);
  });
  it('isolates real accounts while sharing phone/LID aliases after relogin', () => {
    const lidOwner = '123456@lid';
    store.bind([lidOwner]);
    store.patch(lidOwner, '22222@lid', {
      notes: 'private long note',
      remarkName: '客户A',
    });
    store.pin(lidOwner, '22222@lid', 'pin');
    store.bind([owner, lidOwner]);
    store.link(owner, ['22222@lid', '33333@c.us']);
    store.link(owner, ['22222@lid']);
    expect(store.bundle(owner).aliases['22222@lid']).toBe('33333@c.us');
    const restored = new CustomerStore(path);
    expect(restored.profile(lidOwner, '33333@c.us').notes).toBe(
      'private long note',
    );
    expect(restored.bundle(owner).pins).toEqual(['33333@c.us']);
    const other = '8613800000002@c.us';
    restored.bind([other]);
    expect(restored.profile(other, '33333@c.us')).toEqual(emptyCustomer());
    expect(restored.bundle(other).pins).toEqual([]);
  });
  it('supports groups, multiple flags and field patches without losing other notes', () => {
    const id = '11111-22222@g.us';
    store.patch(owner, id, {
      notes: 'long',
      email: 'a@example.com',
      flags: ['priority', 'follow', 'signup', 'deposit'],
    });
    store.patch(owner, id, { remarkName: '新备注' });
    expect(store.profile(owner, id)).toMatchObject({
      notes: 'long',
      email: 'a@example.com',
      remarkName: '新备注',
      flags: ['priority', 'follow', 'signup', 'deposit'],
    });
    const bundle = JSON.stringify(store.bundle(owner));
    expect(bundle).not.toContain('long');
    expect(bundle).not.toContain('a@example.com');
    expect(bundle).not.toContain('notes');
    const copy = store.profile(owner, id);
    copy.flags.pop();
    expect(store.profile(owner, id).flags).toHaveLength(4);
  });
  it('adds and removes S while preserving existing saved customer flags', () => {
    const id = '33333@c.us';
    const existing = ['priority', 'follow', 'signup', 'deposit'] as const;
    store.patch(owner, id, { flags: [...existing], notes: '保留备注' });
    const reopened = new CustomerStore(path);
    reopened.patch(owner, id, {
      flags: ['vip', ...reopened.profile(owner, id).flags],
    });
    const restored = new CustomerStore(path);
    expect(restored.profile(owner, id)).toMatchObject({
      flags: ['vip', ...existing],
      notes: '保留备注',
    });
    expect(restored.bundle(owner).summaries[id].flags).toEqual([
      'vip',
      ...existing,
    ]);
    restored.patch(owner, id, { flags: [...existing] });
    expect(new CustomerStore(path).profile(owner, id).flags).toEqual(existing);
  });

  it('rejects invalid identities and invalid fields without changing stored values', () => {
    expect(() => store.bind(['bad'])).toThrow();
    expect(() => store.pin(owner, '__proto__', 'pin')).toThrow();
    expect(() => store.patch(owner, '33333@c.us', { age: '151' })).toThrow();
    expect(() =>
      store.patch(owner, '33333@c.us', { unexpected: true }),
    ).toThrow();
    expect(() =>
      validateCustomer({ ...emptyCustomer(), flags: ['bad'] }),
    ).toThrow();
    expect(() =>
      validateCustomer({ ...emptyCustomer(), remarkName: 'x'.repeat(101) }),
    ).toThrow();
    expect(store.profile(owner, '33333@c.us')).toEqual(emptyCustomer());
  });
  it('rolls back memory if the local file cannot be written', () => {
    store.patch(owner, '33333@c.us', { notes: 'before' });
    rmSync(root, { recursive: true });
    expect(() =>
      store.patch(owner, '33333@c.us', { notes: 'after' }),
    ).toThrow();
    expect(store.profile(owner, '33333@c.us').notes).toBe('before');
  });
});
