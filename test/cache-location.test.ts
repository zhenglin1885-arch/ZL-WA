import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import CacheLocation from '../src/electron/CacheLocation';

const seed = (path: string) =>
  readFileSync(
    join(path, 'Partitions', 'account', 'IndexedDB', 'messages'),
    'utf8',
  );

describe('browser data location migration', () => {
  let root: string;
  let profile: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-cache-test-'));
    profile = join(root, 'profile');
    mkdirSync(profile);
    mkdirSync(join(profile, 'Partitions', 'account', 'IndexedDB'), {
      recursive: true,
    });
    writeFileSync(
      join(profile, 'Partitions', 'account', 'IndexedDB', 'messages'),
      'login and chat data',
    );
    writeFileSync(join(profile, 'Local State'), 'os key');
    writeFileSync(join(profile, 'settings.json'), 'settings');
    mkdirSync(join(profile, 'chat-backup'));
    writeFileSync(join(profile, 'chat-backup', 'key'), 'backup key');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const parent = () => {
    const path = join(root, 'custom');
    mkdirSync(path);
    return path;
  };
  it('changes only after restart and preserves account data across default, custom and reset', () => {
    const location = new CacheLocation(profile);
    const folder = parent();
    const state = location.select(folder);
    expect(state.next).toBe(join(folder, 'AppData', 'Roaming', 'ZL-WA'));
    expect(location.initialize()).toBe(state.next);
    expect(seed(state.next)).toBe('login and chat data');
    expect(existsSync(join(profile, 'Partitions'))).toBe(false);
    expect(readFileSync(join(profile, 'Local State'), 'utf8')).toBe('os key');
    expect(readFileSync(join(profile, 'settings.json'), 'utf8')).toBe(
      'settings',
    );
    expect(readFileSync(join(profile, 'chat-backup', 'key'), 'utf8')).toBe(
      'backup key',
    );
    const restart = new CacheLocation(profile);
    expect(restart.initialize()).toBe(state.next);
    restart.reset();
    expect(restart.state().current).toBe(state.next);
    expect(new CacheLocation(profile).initialize()).toBe(profile);
    expect(seed(profile)).toBe('login and chat data');
    expect(existsSync(join(state.next, 'Partitions'))).toBe(false);
  });
  it('keeps legacy named caches readable and migrates them only after selection and restart', () => {
    const folder = parent();
    const location = new CacheLocation(profile);
    const target = location.select(folder).next;
    location.initialize();
    const legacy = join(folder, 'ZL-WA缓存');
    renameSync(target, legacy);
    const configFile = join(profile, 'cache-location.json');
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    writeFileSync(configFile, JSON.stringify({ ...config, active: legacy }));
    const restart = new CacheLocation(profile);
    expect(restart.initialize()).toBe(legacy);
    expect(seed(legacy)).toBe('login and chat data');
    const selected = restart.select(folder);
    expect(selected.current).toBe(legacy);
    expect(selected.next).toBe(target);
    expect(seed(legacy)).toBe('login and chat data');
    expect(new CacheLocation(profile).initialize()).toBe(target);
    expect(seed(target)).toBe('login and chat data');
  });
  it('keeps development browser data separate within the same selected folder', () => {
    const dev = new CacheLocation(join(root, 'ZL-WADev'));
    expect(dev.select(parent()).next).toBe(
      join(root, 'custom', 'AppData', 'Roaming', 'ZL-WADev'),
    );
  });
  it('selection and cancellation do not move a running session', () => {
    const location = new CacheLocation(profile);
    location.select(parent());
    expect(location.state().current).toBe(profile);
    expect(seed(profile)).toBe('login and chat data');
    expect(location.cancel().pending).toBe(false);
    expect(new CacheLocation(profile).initialize()).toBe(profile);
  });
  it('moves from one custom location to another', () => {
    const location = new CacheLocation(profile);
    const first = location.select(parent()).next;
    location.initialize();
    mkdirSync(join(root, 'second'));
    const second = location.select(join(root, 'second')).next;
    expect(location.initialize()).toBe(second);
    expect(seed(second)).toBe('login and chat data');
    expect(existsSync(join(first, 'Partitions'))).toBe(false);
  });
  it('rejects foreign and overlapping destinations without overwriting data', () => {
    const location = new CacheLocation(profile);
    const folder = parent();
    const foreign = join(folder, 'AppData', 'Roaming', 'ZL-WA');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'keep'), 'foreign');
    expect(() => location.select(folder)).toThrow('不属于');
    expect(() => location.select(profile)).toThrow('互相包含');
    expect(seed(profile)).toBe('login and chat data');
    expect(readFileSync(join(foreign, 'keep'), 'utf8')).toBe('foreign');
  });
  it('falls back to intact source and rolls back a destination when config commit fails', () => {
    const location = new CacheLocation(profile);
    const target = location.select(parent()).next;
    const { id } = JSON.parse(
      readFileSync(join(profile, 'cache-location.json'), 'utf8'),
    );
    writeFileSync(
      join(target, '.zl-wa-browser-data.json'),
      JSON.stringify({ id }),
    );
    mkdirSync(join(target, 'Partitions'));
    writeFileSync(join(target, 'Partitions', 'stale'), 'previous target data');
    mkdirSync(join(profile, 'cache-location.json.tmp'));
    expect(location.initialize()).toBe(profile);
    expect(location.state().error).toContain('迁移未完成');
    expect(seed(profile)).toBe('login and chat data');
    expect(readFileSync(join(target, 'Partitions', 'stale'), 'utf8')).toBe(
      'previous target data',
    );
    expect(
      readdirSync(root).some(name => name.startsWith('.zl-wa-cache-move-')),
    ).toBe(false);
    rmSync(join(profile, 'cache-location.json.tmp'), { recursive: true });
    expect(new CacheLocation(profile).initialize()).toBe(target);
    expect(seed(target)).toBe('login and chat data');
  });
  it('never silently replaces unavailable custom login storage with an empty profile', () => {
    const location = new CacheLocation(profile);
    const target = location.select(parent()).next;
    location.initialize();
    rmSync(target, { recursive: true });
    expect(() => new CacheLocation(profile).initialize()).toThrow('避免丢失');
  });
  it('falls back if selected disk disappears before restart', () => {
    const location = new CacheLocation(profile);
    const folder = parent();
    location.select(folder);
    rmSync(folder, { recursive: true });
    expect(location.initialize()).toBe(profile);
    expect(seed(profile)).toBe('login and chat data');
  });
});

describe('installed updates and explicit cache recovery', () => {
  let root: string;
  let profile: string;
  let installation: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-cache-recovery-'));
    profile = join(root, 'profile');
    installation = join(root, 'Software', 'ZL-WA');
    mkdirSync(join(profile, 'Partitions', 'account', 'IndexedDB'), {
      recursive: true,
    });
    writeFileSync(
      join(profile, 'Partitions', 'account', 'IndexedDB', 'messages'),
      'original login',
    );
    writeFileSync(join(profile, 'Local State'), 'original OS key');
    writeFileSync(join(profile, 'settings.json'), 'account cards');
    mkdirSync(installation, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('blocks both installation-root and nested custom targets before creating or moving data', () => {
    const location = new CacheLocation(profile, installation);
    expect(() => location.select(installation)).toThrow('安装目录');
    const nested = join(installation, 'AppData');
    mkdirSync(nested);
    expect(() => location.select(nested)).toThrow('AutoSetup');
    expect(existsSync(join(nested, 'ZL-WA缓存'))).toBe(false);
    expect(seed(profile)).toBe('original login');
    expect(existsSync(join(profile, 'cache-location.json'))).toBe(false);
  });

  it('reproduces a 7.3.1 cache inside the install folder removed by AutoSetup, then explicitly starts a fresh safe directory', () => {
    const old = new CacheLocation(profile);
    const oldParent = join(installation, 'AppData');
    mkdirSync(oldParent);
    old.select(oldParent);
    old.initialize();
    const previous = readFileSync(join(profile, 'cache-location.json'), 'utf8');
    rmSync(installation, { recursive: true });
    const recovery = new CacheLocation(profile, installation);
    expect(() => recovery.initialize()).toThrow('无法访问');
    const next = recovery.createFresh(root).current;
    expect(next.startsWith(installation)).toBe(false);
    expect(new CacheLocation(profile, installation).initialize()).toBe(next);
    expect(existsSync(join(next, 'Partitions'))).toBe(false);
    const saved = readdirSync(profile).find(n =>
      n.startsWith('cache-location.recovery-'),
    )!;
    expect(readFileSync(join(profile, saved), 'utf8')).toBe(previous);
    expect(readFileSync(join(profile, 'settings.json'), 'utf8')).toBe(
      'account cards',
    );
    expect(readFileSync(join(profile, 'Local State'), 'utf8')).toBe(
      'original OS key',
    );
  });

  it('adopts a moved intact cache, preserves it across restart, and does not run old cleanup or overwrite unrelated folders', () => {
    const old = new CacheLocation(profile);
    const first = old.select(root).next;
    old.initialize();
    const relocated = join(root, 'relocated');
    renameSync(first, relocated);
    const unrelated = join(root, 'keep');
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'file'), 'keep');
    const recovery = new CacheLocation(profile, installation);
    expect(() => recovery.initialize()).toThrow('无法访问');
    expect(() => recovery.recoverExisting(unrelated)).toThrow('不属于');
    expect(recovery.recoverExisting(relocated).current).toBe(relocated);
    expect(new CacheLocation(profile, installation).initialize()).toBe(
      relocated,
    );
    expect(seed(relocated)).toBe('original login');
    expect(readFileSync(join(unrelated, 'file'), 'utf8')).toBe('keep');
    const state = JSON.parse(
      readFileSync(join(profile, 'cache-location.json'), 'utf8'),
    );
    expect(state.pending).toBeUndefined();
    expect(state.cleanup).toBeUndefined();
  });

  it('never adopts a marker-only folder or overwrites an existing data folder to start fresh', () => {
    const location = new CacheLocation(profile, installation);
    const selected = location.select(root).next;
    const config = JSON.parse(
      readFileSync(join(profile, 'cache-location.json'), 'utf8'),
    );
    writeFileSync(
      join(selected, '.zl-wa-browser-data.json'),
      JSON.stringify({ id: config.id }),
    );
    writeFileSync(
      join(selected, 'Preferences'),
      'browser preferences without any accounts',
    );
    expect(() => location.recoverExisting(selected)).toThrow('没有原账号');
    expect(() => location.createFresh(installation)).toThrow('安装目录');
    const fresh = location.createFresh(root).current;
    expect(fresh).not.toBe(selected);
    expect(seed(profile)).toBe('original login');
    expect(new CacheLocation(profile, installation).initialize()).toBe(fresh);
  });
});
