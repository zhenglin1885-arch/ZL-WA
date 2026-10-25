import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

interface Entry {
  accountId: string;
  key: string;
  text: string;
  expiresAt?: number;
}
// Original message text and provider credentials are hashed, never persisted here.
export default class TranslationCache {
  private entries = new Map<string, Entry>();

  private bytes = 0;

  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private path: string,
    private limit = 3000,
    private maxBytes = 5 * 1024 * 1024,
  ) {
    try {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (data.version === 1 && Array.isArray(data.entries))
          for (const entry of data.entries)
            if (
              typeof entry.accountId === 'string' &&
              /^[\da-f]{64}$/.test(entry.key) &&
              typeof entry.text === 'string' &&
              entry.text.length <= 24_000 &&
              (entry.expiresAt === undefined ||
                (Number.isFinite(entry.expiresAt) &&
                  entry.expiresAt > Date.now()))
            )
              this.put(entry, false);
      }
    } catch {
      /* A broken cache must never prevent application startup. */
    }
  }

  static key(values: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.bytes -= Buffer.byteLength(entry.text, 'utf8');
      this.schedule();
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.text;
  }

  set(accountId: string, key: string, text: string, ttlMs?: number) {
    if (text.trim() && text.length <= 24_000)
      this.put(
        {
          accountId,
          key,
          text,
          ...(ttlMs === undefined ? {} : { expiresAt: Date.now() + ttlMs }),
        },
        true,
      );
  }

  private put(entry: Entry, schedule: boolean) {
    const previous = this.entries.get(entry.key);
    if (previous) this.bytes -= Buffer.byteLength(previous.text, 'utf8');
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    this.bytes += Buffer.byteLength(entry.text, 'utf8');
    while (this.entries.size > this.limit || this.bytes > this.maxBytes) {
      const oldest = this.entries.values().next().value as Entry;
      this.entries.delete(oldest.key);
      this.bytes -= Buffer.byteLength(oldest.text, 'utf8');
    }
    if (schedule) this.schedule();
  }

  removeAccount(accountId: string) {
    for (const [key, entry] of this.entries)
      if (entry.accountId === accountId) {
        this.entries.delete(key);
        this.bytes -= Buffer.byteLength(entry.text, 'utf8');
      }
    this.schedule();
  }

  private schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 500);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      writeFileSync(
        `${this.path}.tmp`,
        JSON.stringify({ version: 1, entries: [...this.entries.values()] }),
        { mode: 0o600 },
      );
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      /* Cache writes are best-effort; successful translations still display. */
    }
  }
}
