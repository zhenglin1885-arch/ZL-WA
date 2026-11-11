import {
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { AccountToolsFileError } from './AccountToolsFileError';

export {
  AccountToolsFileError,
  type AccountToolsFileDiagnostic,
} from './AccountToolsFileError';
interface AccountToolsData {
  accounts: Record<string, unknown>;
  history: unknown[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Only complete validated snapshots may replace the live account configuration.
// Never substitute empty proxy settings for an unreadable existing file.
export default class AccountToolsFile<T extends AccountToolsData> {
  constructor(readonly path: string) {}

  private read(path: string): { raw: Buffer; data: T } {
    let raw: Buffer;
    try {
      raw = readFileSync(path);
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      throw new AccountToolsFileError(this, {
        code: 'READ',
        ...(['EACCES', 'EPERM', 'ENOENT', 'EIO', 'EBUSY', 'EISDIR'].includes(
          code || '',
        )
          ? { ioCode: code }
          : {}),
      });
    }
    return { raw, data: this.decode(raw) };
  }

  private decode(raw: Buffer): T {
    if (raw.length === 0)
      throw new AccountToolsFileError(this, { code: 'EMPTY', bytes: 0 });
    if (raw.every(byte => byte === 0))
      throw new AccountToolsFileError(this, {
        code: 'ZERO_FILLED',
        bytes: raw.length,
      });
    let text: string;
    try {
      // Windows editors can save an otherwise intact JSON file with a UTF-8 or
      // UTF-16 BOM. Decode only declared encodings, never repair arbitrary bytes.
      const encoding =
        raw[0] === 0xff && raw[1] === 0xfe
          ? 'utf-16le'
          : raw[0] === 0xfe && raw[1] === 0xff
            ? 'utf-16be'
            : 'utf8';
      text = new TextDecoder(encoding, { fatal: true }).decode(raw);
    } catch {
      throw new AccountToolsFileError(this, {
        code: 'ENCODING',
        bytes: raw.length,
      });
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AccountToolsFileError(this, {
        code: 'JSON',
        bytes: raw.length,
      });
    }
    if (
      !object(data) ||
      !object(data.accounts) ||
      !Array.isArray(data.history) ||
      !Object.values(data.accounts).every(value => object(value))
    )
      throw new AccountToolsFileError(this, {
        code: 'STRUCTURE',
        bytes: raw.length,
      });
    return data as T;
  }

  load(fallback: T): T {
    // A genuine first run may start without a file; permission and parse errors
    // for an existing file must propagate instead of changing account routing.
    try {
      return this.read(this.path).data;
    } catch (error) {
      if (
        error instanceof AccountToolsFileError &&
        error.diagnostic.ioCode === 'ENOENT'
      )
        return fallback;
      throw error;
    }
  }

  private replace(path: string, bytes: Buffer) {
    // Separate writers must never truncate or rename each other's temp file.
    const temp = `${path}.tmp-${randomUUID()}`;
    writeFileSync(temp, bytes, { mode: 0o600, flush: true });
    renameSync(temp, path);
  }

  save(data: T) {
    // Validate serialization before touching either the current file or backup.
    const bytes = Buffer.from(JSON.stringify(data));
    this.decode(bytes);
    try {
      const previous = this.read(this.path);
      this.replace(`${this.path}.bak`, previous.raw);
    } catch (error) {
      if (
        !(
          error instanceof AccountToolsFileError &&
          error.diagnostic.ioCode === 'ENOENT'
        )
      )
        throw error;
    }
    this.replace(this.path, bytes);
  }

  backups(): { path: string; modified: number }[] {
    let interrupted: string[] = [];
    try {
      const name = basename(this.path);
      interrupted = readdirSync(dirname(this.path))
        .filter(
          entry =>
            entry.startsWith(`${name}.tmp-`) ||
            entry.startsWith(`${name}.bak.tmp-`),
        )
        .map(entry => {
          const path = join(dirname(this.path), entry);
          return { path, modified: statSync(path).mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 10)
        .map(entry => entry.path);
    } catch {
      /* Existing fixed backup paths remain usable. */
    }
    return [
      `${this.path}.bak`,
      `${this.path}.tmp`,
      `${this.path}.bak.tmp`,
      ...interrupted,
    ]
      .flatMap(path => {
        try {
          this.read(path);
          return [{ path, modified: statSync(path).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.modified - a.modified);
  }

  restoreFrom(source: string) {
    const restored = this.read(source);
    this.preserveAndReplace(restored.raw);
  }

  rebuildZeroFilled(data: T) {
    const bytes = Buffer.from(JSON.stringify(data));
    this.decode(bytes);
    this.preserveAndReplace(bytes, true);
  }

  private preserveAndReplace(bytes: Buffer, zeroFilledOnly = false) {
    // Preserve the original bytes even when JSON decoding fails. Refuse to
    // overwrite if the original cannot be copied, for example due to access.
    let original: Buffer | undefined;
    try {
      original = readFileSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      zeroFilledOnly &&
      (!original?.length || !original.every(byte => byte === 0))
    )
      throw new Error('配置内容已发生变化，请重新启动后检查');
    if (original) {
      writeFileSync(
        `${this.path}.preserved-${Date.now()}-${randomUUID()}`,
        original,
        {
          mode: 0o600,
          flag: 'wx',
          flush: true,
        },
      );
    }
    this.replace(this.path, bytes);
  }
}
