import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
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
    const state = location.select(parent());
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
    mkdirSync(join(folder, 'ZL-WA缓存'));
    writeFileSync(join(folder, 'ZL-WA缓存', 'keep'), 'foreign');
    expect(() => location.select(folder)).toThrow('不属于');
    expect(() => location.select(profile)).toThrow('互相包含');
    expect(seed(profile)).toBe('login and chat data');
    expect(readFileSync(join(folder, 'ZL-WA缓存', 'keep'), 'utf8')).toBe(
      'foreign',
    );
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
