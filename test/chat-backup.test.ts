import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureChat } from '../src/features/chatBackup/guest';
import ChatBackup from '../src/electron/ChatBackup';
import StartupQueue from '../src/features/accounts/StartupQueue';
import {
  backupDay,
  validateBackupPacket,
} from '../src/features/chatBackup/types';

const codec = {
  encrypt: (v: string) => Buffer.from(`wrapped:${v}`),
  decrypt: (v: Buffer) => v.toString().slice(8),
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zl-backup-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const packet = (time = Date.now()) => ({
  ownerId: '123456789@c.us',
  accountName: 'Account',
  chatId: '987654321@c.us',
  chatName: '<script>alert(1)</script>',
  messages: [
    {
      id: 'message-one',
      time,
      sender: 'Sender',
      outgoing: false,
      text: 'private-message<&>',
      translation: 'private-translation',
      image: png,
      hasImage: true,
    },
  ],
});
function create() {
  return new ChatBackup(join(dir, 'data'), codec, join(dir, 'exports'));
}
test('encrypts text, translations and images; deduplicates and isolates accounts and owners', () => {
  const store = create();
  const p = packet();
  store.ingest('account-a', p);
  store.ingest('account-a', p);
  expect(store.state().stats.messages).toBe(1);
  store.ingest('account-b', p);
  store.ingest('account-a', { ...p, ownerId: '111111111@c.us' });
  expect(store.state().stats.messages).toBe(3);
  for (const name of readdirSync(join(dir, 'data')).filter(
    n => n.endsWith('.enc') || n.endsWith('.png'),
  )) {
    const bytes = readFileSync(join(dir, 'data', name));
    expect(bytes.includes(Buffer.from('private-message'))).toBe(false);
    expect(bytes.includes(Buffer.from('private-translation'))).toBe(false);
    expect(
      bytes
        .subarray(0, 8)
        .equals(Buffer.from(png.split(',')[1], 'base64').subarray(0, 8)),
    ).toBe(false);
  }
  expect(create().state().stats.messages).toBe(3);
});
test('exports escaped offline HTML, correct per-chat links, translations and original image bytes', async () => {
  const store = create();
  const p = packet();
  store.ingest('account-a', p);
  store.ingest('account-a', {
    ...p,
    messages: [{ ...p.messages[0], id: 'message-two', text: 'second' }],
  });
  const index = await store.export('all');
  const html = readFileSync(index, 'utf8');
  expect(html).toContain('目录');
  const folder = readdirSync(join(dir, 'exports')).find(
    n => n !== '目录.html',
  )!;
  const location = join(dir, 'exports', folder, '全部聊天记录');
  const name = readdirSync(location).find(
    n => n.endsWith('.html') && n !== '目录.html',
  )!;
  const chat = readFileSync(join(location, name), 'utf8');
  expect(chat).toContain('private-message&lt;&amp;&gt;');
  expect(chat).toContain('private-translation');
  expect(chat).not.toContain('<script>');
  expect(chat).not.toContain('</article>,<article');
  expect(chat).toContain('href="目录.html"');
  expect(chat).toContain(`src="${png}"`);
  expect(readdirSync(location).every(n => n.endsWith('.html'))).toBe(true);
  expect(
    readFileSync(join(dir, 'exports', folder, '目录.html'), 'utf8'),
  ).toContain(encodeURIComponent('全部聊天记录'));
  expect(html).toContain(encodeURIComponent(folder));
});
test('never overwrites encrypted data when the OS key cannot be decrypted or index is damaged', () => {
  const store = create();
  store.ingest('account', packet());
  const file = join(dir, 'data', 'index.enc');
  const original = readFileSync(file);
  const locked = new ChatBackup(
    join(dir, 'data'),
    {
      ...codec,
      decrypt: () => {
        throw new Error('locked');
      },
    },
    join(dir, 'exports'),
  );
  expect(locked.state().stats.error).toBeTruthy();
  expect(() => locked.ingest('account', packet())).toThrow();
  expect(readFileSync(file)).toEqual(original);
  writeFileSync(file, Buffer.from('corrupt'));
  expect(create().state().stats.error).toBeTruthy();
  expect(readFileSync(file).toString()).toBe('corrupt');
});
test('catches up missed daily exports and only prunes local expired messages', async () => {
  const store = create();
  const now = new Date(2026, 9, 23, 23, 31).getTime();
  const old = now - 2 * 86_400_000;
  store.configure({ ...store.config, retentionDays: 0 });
  store.ingest('account', packet(old));
  await store.catchUp(now);
  const folder = readdirSync(join(dir, 'exports')).find(
    n => n !== '目录.html',
  )!;
  const index = join(dir, 'exports', folder, backupDay(now), '目录.html');
  expect(existsSync(join(dir, 'exports', folder, backupDay(old)))).toBe(false);
  expect(readFileSync(index, 'utf8')).toContain('聊天记录目录');
  const first = store.state().stats.lastExport;
  await store.catchUp(now + 1000);
  expect(store.state().stats.lastExport).toBe(first);
  store.configure({ ...store.config, retentionDays: 7 });
  store.prune(now + 10 * 86_400_000);
  expect(store.state().stats.messages).toBe(0);
  expect(readFileSync(index, 'utf8')).toContain('聊天记录目录');
  expect(create().state().stats.messages).toBe(0);
});
const time = (day: number) => new Date(2026, 9, day, 12).getTime();
test('dated snapshots contain all earlier conversations, translations and images but exclude later messages', async () => {
  const store = create();
  const first = packet(time(21));
  store.ingest('account', {
    ...first,
    messages: [
      {
        ...first.messages[0],
        id: 'old',
        text: 'Earlier history',
        translation: '历史译文',
      },
      {
        ...first.messages[0],
        id: 'current',
        time: time(23),
        text: 'Snapshot day message',
      },
      {
        ...first.messages[0],
        id: 'future',
        time: time(24),
        text: 'Future message',
      },
    ],
  });
  store.ingest('account', {
    ...first,
    chatId: '100000000@c.us',
    chatName: 'Earlier conversation only',
    messages: [
      {
        ...first.messages[0],
        id: 'old-other-chat',
        text: 'Earlier conversation text',
      },
    ],
  });
  store.ingest('second', {
    ...first,
    accountName: 'Other account',
    messages: [
      {
        ...first.messages[0],
        id: 'other-account',
        text: 'Other account private message',
      },
    ],
  });
  await store.export('2026-10-23');
  const root = join(dir, 'exports');
  const folder = readdirSync(root).find(name => name.startsWith('Account-'))!;
  const snapshot = join(root, folder, '2026-10-23');
  const files = readdirSync(snapshot).filter(name => name !== '目录.html');
  expect(files).toHaveLength(2);
  const contents = files
    .map(name => readFileSync(join(snapshot, name), 'utf8'))
    .join('');
  expect(contents).toContain('Earlier history');
  expect(contents).toContain('Snapshot day message');
  expect(contents).toContain('Earlier conversation text');
  expect(contents).toContain('历史译文');
  expect(contents).toContain(png);
  expect(contents).not.toContain('Future message');
  expect(contents).not.toContain('Other account private message');
  expect(readFileSync(join(snapshot, '目录.html'), 'utf8')).toContain(
    '截至 2026-10-23 的全部聊天记录',
  );
});

test('scheduled snapshots catch up once and refresh for newly synchronized earlier history', async () => {
  const store = create();
  const now = new Date(2026, 9, 24, 10).getTime();
  const p = packet(new Date(2026, 9, 21, 12).getTime());
  store.ingest('account', p);
  await store.catchUp(now);
  const root = join(dir, 'exports');
  const folder = readdirSync(root).find(name => name !== '目录.html')!;
  expect(readdirSync(join(root, folder))).toEqual(['2026-10-23', '目录.html']);
  const first = store.state().stats.lastExport;
  await store.catchUp(now + 1000);
  expect(store.state().stats.lastExport).toBe(first);
  store.ingest('account', {
    ...p,
    messages: [
      {
        ...p.messages[0],
        id: 'late-history',
        time: p.messages[0].time - 86_400_000,
        text: 'Newly synchronized old message',
      },
    ],
  });
  await store.catchUp(now + 2000);
  expect(store.state().stats.lastExport).not.toBe(first);
  const snapshot = join(root, folder, '2026-10-23');
  const file = readdirSync(snapshot).find(name => name !== '目录.html')!;
  expect(readFileSync(join(snapshot, file), 'utf8')).toContain(
    'Newly synchronized old message',
  );
  const refreshed = store.state().stats.lastExport;
  store.ingest('account', {
    ...p,
    messages: [
      {
        ...p.messages[0],
        id: 'today',
        time: now,
        text: 'Today message after cutoff',
      },
    ],
  });
  await store.catchUp(now + 3000);
  expect(store.state().stats.lastExport).toBe(refreshed);
});

test('rejects external image URLs and invalid packet IDs', () => {
  const p = packet();
  expect(() => validateBackupPacket({ ...p, chatId: '../bad' })).toThrow();
  expect(() =>
    validateBackupPacket({
      ...p,
      messages: [
        { ...p.messages[0], image: 'https://example.test/private.png' },
      ],
    }),
  ).toThrow();
});
test('starts at most two accounts in sidebar order, releases one slot per completion, handles removed accounts', () => {
  const queue = new StartupQueue(() => {});
  queue.update(['top', 'second', 'third', 'fourth']);
  expect([...queue.admitted]).toEqual(['top', 'second']);
  queue.complete('top');
  expect([...queue.admitted]).toEqual(['top', 'second', 'third']);
  queue.complete('top');
  expect(queue.admitted.has('fourth')).toBe(false);
  queue.update(['top', 'third', 'fourth']);
  expect(queue.admitted.has('fourth')).toBe(true);
  queue.complete('third');
  queue.complete('fourth');
  queue.update(['top', 'third', 'fourth', 'new']);
  expect(queue.admitted.has('new')).toBe(true);
});

test('new sessions bypass occupied startup slots without releasing or consuming them', () => {
  const queue = new StartupQueue(() => {});
  queue.update(['one', 'two', 'three', 'four']);
  const immediate = new Set(['new', 'another', 'sleeping']);
  queue.update(['one', 'two', 'three', 'four', 'new'], immediate);
  expect([...queue.admitted]).toEqual(['one', 'two', 'new']);
  queue.complete('new');
  expect(queue.admitted.has('three')).toBe(false);
  queue.update(['one', 'two', 'three', 'four', 'new', 'another'], immediate);
  expect(queue.admitted.has('another')).toBe(true);
  expect(queue.admitted.has('sleeping')).toBe(false);
  queue.complete('one');
  expect(queue.admitted.has('three')).toBe(true);
  expect(queue.admitted.has('four')).toBe(false);
  // Creation hints are not persisted; the next app instance starts only two.
  const restarted = new StartupQueue(() => {});
  restarted.update(['one', 'two', 'three', 'four', 'new', 'another']);
  expect([...restarted.admitted]).toEqual(['one', 'two']);
});

// The guest must only acknowledge messages once the host has saved them.
test('opened-chat capture retries unacknowledged writes, observes translations and rejects owner changes', async () => {
  const owner = '123456789@c.us';
  const chatId = '987654321@c.us';
  const id = `false_${chatId}_fixture`;
  const model = {
    id: { _serialized: id },
    t: Math.floor(Date.now() / 1000),
    body: 'original',
    type: 'chat',
  };
  let translation = 'translated';
  let currentOwner = owner;
  const node = {
    dataset: { id },
    cloneNode: () => ({
      querySelectorAll: () => [],
      querySelector: () => null,
    }),
    querySelector: (selector: string) =>
      selector === '[data-zl-translation-text]'
        ? { textContent: translation }
        : null,
  };
  const globals = globalThis as any;
  globals.window = {
    location: { hostname: 'web.whatsapp.com' },
    require: (name: string) =>
      name === 'WAWebUserPrefsMeUser'
        ? { getMaybeMePnUser: () => currentOwner }
        : undefined,
    WPP: {
      isReady: true,
      chat: { getActiveChat: () => ({ id: chatId, name: 'Official name' }) },
      whatsapp: { MsgStore: { get: () => model } },
    },
  };
  globals.document = {
    querySelector: () => null,
    querySelectorAll: () => [node],
  };
  const request = {
    ownerId: owner,
    accountName: 'Account',
    mode: 'opened' as const,
  };
  try {
    const first = await captureChat(request);
    expect(first.packet.messages[0]).toMatchObject({
      text: 'original',
      translation: 'translated',
    });
    const retried = await captureChat(request);
    expect(retried.packet.messages).toHaveLength(1);
    await captureChat({ ...request, mode: 'ack', receipts: first.receipts });
    const acknowledged = await captureChat(request);
    expect(acknowledged.packet.messages).toHaveLength(0);
    translation = 'retranslated';
    const changed = await captureChat(request);
    expect(changed.packet.messages[0].translation).toBe('retranslated');
    currentOwner = '111111111@c.us';
    await expect(captureChat(request)).rejects.toThrow('账号身份已变化');
  } finally {
    delete globals.window;
    delete globals.document;
  }
});

test('does not delete retained data when committing an expiry update fails', () => {
  const store = create();
  store.ingest('account', packet());
  mkdirSync(join(dir, 'data', 'index.enc.tmp'));
  expect(() => store.prune(Date.now() + 400 * 86_400_000)).toThrow();
  expect(store.state().stats.messages).toBe(1);
  expect(create().state().stats.messages).toBe(1);
});

test('exports account-first folders isolating different accounts and login owners, with working date and full indexes', async () => {
  const store = create();
  const p = packet();
  store.ingest('account-a', p);
  store.ingest('account-b', { ...p, accountName: 'Second account' });
  store.ingest('account-a', { ...p, ownerId: '111111111@c.us' });
  await store.export('all');
  await store.export(backupDay(p.messages[0].time));
  const root = join(dir, 'exports');
  const folders = readdirSync(root).filter(n => n !== '目录.html');
  expect(folders).toHaveLength(3);
  for (const folder of folders) {
    expect(
      readdirSync(join(root, folder)).sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      [backupDay(p.messages[0].time), '全部聊天记录', '目录.html'].sort(
        (a, b) => a.localeCompare(b),
      ),
    );
    const index = readFileSync(join(root, folder, '目录.html'), 'utf8');
    expect(index).toContain(backupDay(p.messages[0].time));
    expect(index).toContain(encodeURIComponent('全部聊天记录'));
    const full = join(root, folder, '全部聊天记录');
    expect(readdirSync(full)).toHaveLength(2);
    const chat = readdirSync(full).find(n => n !== '目录.html')!;
    expect(readFileSync(join(full, chat), 'utf8')).toContain(png);
  }
});
