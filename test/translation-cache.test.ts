import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import TranslationCache from '../src/electron/TranslationCache';

describe('bounded persistent translation cache', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-cache-'));
    path = join(root, 'cache.json');
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });
  it('restores successful translations after process restart without persisting original text or credentials', () => {
    const key = TranslationCache.key([
      'account-1',
      'Google',
      'auto',
      'zh-CN',
      'model',
      'secret-key',
      'original message',
    ]);
    const cache = new TranslationCache(path);
    cache.set('account-1', key, '缓存译文');
    cache.flush();
    expect(new TranslationCache(path).get(key)).toBe('缓存译文');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('original message');
    expect(raw).not.toContain('secret-key');
  });
  it('isolates accounts, language, provider and model and clears a deleted account only', () => {
    const values = ['account-1', 'Google', 'auto', 'zh-CN', 'model', 'source'];
    const key = TranslationCache.key(values);
    for (let i = 0; i < values.length; i += 1) {
      const changed = [...values];
      changed[i] += '-other';
      expect(TranslationCache.key(changed)).not.toBe(key);
    }
    const cache = new TranslationCache(path);
    const other = TranslationCache.key(['account-2']);
    cache.set('account-1', key, 'one');
    cache.set('account-2', other, 'two');
    cache.removeAccount('account-1');
    cache.flush();
    const restored = new TranslationCache(path);
    expect(restored.get(key)).toBeUndefined();
    expect(restored.get(other)).toBe('two');
  });
  it('expires temporary fallback entries after restart without expiring primary translations', () => {
    const cache = new TranslationCache(path);
    const primary = TranslationCache.key(['account', 'Google']);
    const backup = TranslationCache.key(['account', 'MyMemory']);
    cache.set('account', primary, 'primary');
    cache.set('account', backup, 'temporary', 1000);
    cache.flush();
    const restored = new TranslationCache(path);
    expect(restored.get(backup)).toBe('temporary');
    jest.advanceTimersByTime(1001);
    expect(restored.get(backup)).toBeUndefined();
    expect(restored.get(primary)).toBe('primary');
    expect(new TranslationCache(path).get(backup)).toBeUndefined();
  });
  it('uses bounded LRU storage rather than clearing every cached translation at once', () => {
    const cache = new TranslationCache(path, 2, 10);
    const [a, b, c] = ['a', 'b', 'c'].map(v => TranslationCache.key([v]));
    cache.set('account', a, '1111');
    cache.set('account', b, '2222');
    cache.get(a);
    cache.set('account', c, '3333');
    cache.flush();
    const restored = new TranslationCache(path, 2, 10);
    expect(restored.get(a)).toBe('1111');
    expect(restored.get(b)).toBeUndefined();
    expect(restored.get(c)).toBe('3333');
  });
  it('ignores corrupt cache and never persists an empty translation', () => {
    writeFileSync(path, '{invalid');
    const cache = new TranslationCache(path);
    const key = TranslationCache.key(['test']);
    cache.set('account', key, '');
    cache.flush();
    expect(new TranslationCache(path).get(key)).toBeUndefined();
  });
});
