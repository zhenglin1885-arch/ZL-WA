import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  mkdirSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AccountToolsFile, {
  AccountToolsFileError,
} from '../src/electron/AccountToolsFile';

const original = {
  accounts: {
    one: {
      proxy: { enabled: true, host: 'private-proxy' },
      encryptedPassword: 'encrypted-value',
    },
  },
  history: [],
  extraLegacyField: { preserved: true },
};
let directory: string;
let path: string;
let file: AccountToolsFile<any>;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'zl-config-recovery-'));
  path = join(directory, 'account-tools.json');
  file = new AccountToolsFile(path);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('allows a genuine first run without creating or resetting files', () => {
  expect(file.load({ accounts: {}, history: [] })).toEqual({
    accounts: {},
    history: [],
  });
  expect(readdirSync(directory)).toEqual([]);
});
it.each(['utf8-bom', 'utf16le', 'utf16be'])(
  'loads intact %s Windows JSON and preserves original bytes in the backup',
  encoding => {
    const text = JSON.stringify(original);
    let raw = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(text),
    ]);
    if (encoding === 'utf16le')
      raw = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(text, 'utf16le'),
      ]);
    if (encoding === 'utf16be')
      raw = Buffer.concat([
        Buffer.from([0xfe, 0xff]),
        Buffer.from(text, 'utf16le').swap16(),
      ]);
    writeFileSync(path, raw);
    expect(file.load({})).toEqual(original);
    expect(readFileSync(path)).toEqual(raw);
    file.save({ ...original, history: [{ id: 'new' }] });
    expect(readFileSync(`${path}.bak`)).toEqual(raw);
    expect(file.load({}).accounts).toEqual(original.accounts);
    expect(file.load({}).extraLegacyField).toEqual(original.extraLegacyField);
  },
);
it.each([
  [Buffer.alloc(0), 'EMPTY'],
  [Buffer.alloc(128), 'ZERO_FILLED'],
  [Buffer.from('{"accounts":{"private-proxy":'), 'JSON'],
  [
    Buffer.from('{"accounts":{},"history":[],"key":"\u00FF"}', 'binary'),
    'ENCODING',
  ],
  [Buffer.from('{"accounts":null,"history":[]}'), 'STRUCTURE'],
  [Buffer.from('{"accounts":{"one":null},"history":[]}'), 'STRUCTURE'],
  [Buffer.from('null'), 'STRUCTURE'],
])(
  'rejects invalid file %# without defaulting account routing or including content in diagnostics',
  (raw, code) => {
    writeFileSync(path, raw);
    let failure: AccountToolsFileError | undefined;
    try {
      file.load({ accounts: {}, history: [] });
    } catch (error) {
      failure = error as AccountToolsFileError;
    }
    expect(failure).toBeInstanceOf(AccountToolsFileError);
    expect(failure?.diagnostic).toEqual({ code, bytes: raw.length });
    expect(JSON.stringify(failure?.diagnostic)).not.toContain('private-proxy');
    expect(readFileSync(path)).toEqual(raw);
    expect(readdirSync(directory)).toEqual(['account-tools.json']);
  },
);
it('recognizes a large zero-filled file without pretending its proxy credentials can be recovered', () => {
  const damaged = Buffer.alloc(1_350_233);
  writeFileSync(path, damaged);
  let failure: unknown;
  try {
    file.load({ accounts: {}, history: [] });
  } catch (error) {
    failure = error;
  }
  expect((failure as AccountToolsFileError).diagnostic).toEqual({
    code: 'ZERO_FILLED',
    bytes: 1_350_233,
  });
  expect(file.backups()).toEqual([]);
  expect(readFileSync(path).equals(damaged)).toBe(true);
  expect(readdirSync(directory)).toEqual(['account-tools.json']);
});
it('rebuilds a zero-filled config only after preserving the original, and refuses to overwrite a repaired file', () => {
  const damaged = Buffer.alloc(256);
  writeFileSync(path, damaged);
  const recovery = {
    accounts: {},
    history: [],
    recoveryRequiresProxyReview: true,
  };
  file.rebuildZeroFilled(recovery);
  expect(file.load({})).toEqual(recovery);
  const preserved = readdirSync(directory).find(name =>
    name.startsWith('account-tools.json.preserved-'),
  );
  expect(readFileSync(join(directory, preserved!)).equals(damaged)).toBe(true);
  expect(() => file.rebuildZeroFilled(recovery)).toThrow('配置内容已发生变化');
  expect(file.load({})).toEqual(recovery);
});
it('reports filesystem errors separately and never substitutes an empty account config', () => {
  mkdirSync(path);
  expect(() => file.load({ accounts: {}, history: [] })).toThrow(
    AccountToolsFileError,
  );
  let failure: unknown;
  try {
    file.load({});
  } catch (error) {
    failure = error;
  }
  expect((failure as AccountToolsFileError).diagnostic).toEqual({
    code: 'READ',
    ioCode: 'EISDIR',
  });
});
it('keeps the preceding complete snapshot and refuses to back up or overwrite a newly corrupted live file', () => {
  file.save(original);
  const next = { ...original, history: [{ id: 'next' }] };
  file.save(next);
  expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual(original);
  expect(file.load({})).toEqual(next);
  writeFileSync(path, 'broken');
  expect(() => file.save(original)).toThrow(AccountToolsFileError);
  expect(readFileSync(path, 'utf8')).toBe('broken');
  expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual(original);
});
it('validates new snapshots before touching valid files', () => {
  file.save(original);
  expect(() => file.save({ accounts: null, history: [] })).toThrow(
    AccountToolsFileError,
  );
  expect(file.load({})).toEqual(original);
  expect(readdirSync(directory)).toEqual(['account-tools.json']);
});
it('offers only complete backups and restores the chosen one while preserving the unreadable original', () => {
  const snapshot = Buffer.from(JSON.stringify(original));
  writeFileSync(`${path}.bak`, snapshot);
  writeFileSync(`${path}.tmp`, snapshot);
  utimesSync(`${path}.bak`, 1, 1);
  utimesSync(`${path}.tmp`, 2, 2);
  expect(file.backups().map(b => b.path)).toEqual([
    `${path}.tmp`,
    `${path}.bak`,
  ]);
  writeFileSync(`${path}.tmp`, 'partial');
  expect(file.backups().map(b => b.path)).toEqual([`${path}.bak`]);
  const damaged = Buffer.from([0, 0, 0, 0]);
  writeFileSync(path, damaged);
  file.restoreFrom(`${path}.bak`);
  expect(readFileSync(path)).toEqual(snapshot);
  const preserved = readdirSync(directory).find(name =>
    name.startsWith('account-tools.json.preserved-'),
  );
  expect(preserved).toBeDefined();
  expect(readFileSync(join(directory, preserved!))).toEqual(damaged);
  expect(file.load({}).accounts).toEqual(original.accounts);
});
it('never changes the original when the selected backup is incomplete or the original cannot be preserved', () => {
  writeFileSync(path, 'original broken bytes');
  writeFileSync(`${path}.bak`, 'partial');
  expect(() => file.restoreFrom(`${path}.bak`)).toThrow(AccountToolsFileError);
  expect(readFileSync(path, 'utf8')).toBe('original broken bytes');
  expect(readdirSync(directory).sort((a, b) => a.localeCompare(b))).toEqual([
    'account-tools.json',
    'account-tools.json.bak',
  ]);
  rmSync(path);
  mkdirSync(path);
  writeFileSync(`${path}.bak`, JSON.stringify(original));
  expect(() => file.restoreFrom(`${path}.bak`)).toThrow();
  expect(readdirSync(path)).toEqual([]);
});
