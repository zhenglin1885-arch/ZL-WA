/* eslint-disable no-continue -- Only browser-owned entries are moved; application settings stay in their existing profile. */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
  cpSync,
  statSync,
  realpathSync,
  mkdtempSync,
} from 'node:fs';
import {
  join,
  dirname,
  basename,
  resolve,
  relative,
  isAbsolute,
  sep,
} from 'node:path';

interface LocationConfig {
  version: 1;
  id: string;
  active: string;
  pending?: string;
  cleanup?: string;
}
export interface CacheLocationState {
  current: string;
  next: string;
  defaultDirectory: string;
  pending: boolean;
  error?: string;
}
const marker = '.zl-wa-browser-data.json';
// Electron's browser sessions share cookies, web databases and caches. Never move
// app settings, recipes, local-server databases, credentials or chat backups.
const browserEntry = (name: string) =>
  name === 'Partitions' ||
  [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'GrShaderCache',
    'ShaderCache',
    'Service Worker',
    'IndexedDB',
    'Local Storage',
    'Session Storage',
    'blob_storage',
    'File System',
    'databases',
    'Network',
    'Local State',
    'Preferences',
    'Secure Preferences',
    'Network Persistent State',
    'TransportSecurity',
    'Shared Dictionary',
    'Storage',
    'WebStorage',
    'Dictionaries',
    'Platform Notifications',
    'Visited Links',
  ].includes(name) ||
  /^(Cookies|Trust Tokens|DIPS|SharedStorage|History|QuotaManager|Reporting and NEL)(?:-(?:journal|wal|shm))?$/.test(
    name,
  );
const pathKey = (path: string) => {
  let parent = resolve(path);
  const tail: string[] = [];
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) break;
    tail.unshift(basename(parent));
    parent = next;
  }
  const p = existsSync(parent)
    ? join(realpathSync(parent), ...tail)
    : resolve(path);
  return process.platform === 'win32' ? p.toLowerCase() : p;
};
const contains = (parent: string, child: string) => {
  const part = relative(pathKey(parent), pathKey(child));
  return (
    !part ||
    (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
  );
};

export default class CacheLocation {
  private config: LocationConfig;

  error = '';

  constructor(
    readonly profile: string,
    readonly installationDirectory?: string,
  ) {
    mkdirSync(profile, { recursive: true });
    if (existsSync(this.file)) {
      const value = JSON.parse(
        readFileSync(this.file, 'utf8'),
      ) as LocationConfig;
      if (
        value.version !== 1 ||
        typeof value.id !== 'string' ||
        typeof value.active !== 'string' ||
        !isAbsolute(value.active) ||
        [value.pending, value.cleanup].some(
          p => p !== undefined && (typeof p !== 'string' || !isAbsolute(p)),
        )
      )
        throw new Error(
          '缓存目录配置损坏，已有账号数据未改动，请恢复 cache-location.json 后重启',
        );
      this.config = value;
    } else this.config = { version: 1, id: randomUUID(), active: profile };
  }

  private get file() {
    return join(this.profile, 'cache-location.json');
  }

  private save(value: LocationConfig) {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.config = value;
  }

  state(): CacheLocationState {
    return {
      current: this.config.active,
      next: this.config.pending || this.config.active,
      defaultDirectory: this.profile,
      pending: !!this.config.pending,
      error:
        this.error ||
        (this.installationDirectory &&
        contains(this.installationDirectory, this.config.active)
          ? '当前缓存位于软件安装目录内，安装版升级可能删除它。请在更新软件前选择安装目录以外的独立文件夹并重启完成迁移。'
          : undefined),
    };
  }

  private owned(path: string) {
    if (pathKey(path) === pathKey(this.profile)) return;
    if (
      !existsSync(join(path, marker)) ||
      JSON.parse(readFileSync(join(path, marker), 'utf8')).id !== this.config.id
    )
      throw new Error('此缓存文件夹不属于当前软件配置，未改动其中的数据');
  }

  private writable(path: string) {
    const probe = join(path, `.zl-wa-write-${randomUUID()}`);
    try {
      writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    } finally {
      rmSync(probe, { force: true });
    }
  }

  private validateInstallation(target: string) {
    if (
      this.installationDirectory &&
      contains(this.installationDirectory, target)
    )
      throw new Error(
        '缓存不能保存在软件安装目录内，AutoSetup 升级会清理该目录。请选择安装目录以外的独立文件夹，例如 D:\\ZL-WA数据。',
      );
  }

  private validateTarget(target: string) {
    this.validateInstallation(target);
    if (pathKey(target) === pathKey(this.profile)) return;
    if (
      (contains(this.profile, target) ||
        contains(target, this.profile) ||
        contains(this.config.active, target) ||
        contains(target, this.config.active)) &&
      pathKey(target) !== pathKey(this.config.active)
    )
      throw new Error('缓存目录不能与当前数据目录互相包含，请选择独立文件夹');
    if (existsSync(target) && readdirSync(target).length > 0)
      this.owned(target);
  }

  private customDirectory(parent: string) {
    return join(
      realpathSync(parent),
      'AppData',
      'Roaming',
      this.profile.endsWith('Dev') ? 'ZL-WADev' : 'ZL-WA',
    );
  }

  select(parent: string) {
    if (
      !isAbsolute(parent) ||
      !existsSync(parent) ||
      !statSync(parent).isDirectory()
    )
      throw new Error('请选择有效的文件夹');
    const target = this.customDirectory(parent);
    this.validateTarget(target);
    mkdirSync(target, { recursive: true });
    this.writable(target);
    this.save({
      ...this.config,
      pending:
        pathKey(target) === pathKey(this.config.active) ? undefined : target,
    });
    this.error = '';
    return this.state();
  }

  reset() {
    this.save({
      ...this.config,
      pending:
        pathKey(this.config.active) === pathKey(this.profile)
          ? undefined
          : this.profile,
    });
    this.error = '';
    return this.state();
  }

  cancel() {
    this.save({ ...this.config, pending: undefined });
    this.error = '';
    return this.state();
  }

  private saveRecovery(active: string) {
    // Retain the old path even when its disk/folder is currently unavailable.
    writeFileSync(
      join(this.profile, `cache-location.recovery-${randomUUID()}.json`),
      JSON.stringify(this.config),
      { flag: 'wx', mode: 0o600 },
    );
    this.save({
      ...this.config,
      active,
      pending: undefined,
      cleanup: undefined,
    });
    this.error = '';
    return this.state();
  }

  recoverExisting(path: string) {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory())
      throw new Error('请选择仍存在的原缓存文件夹');
    const target = realpathSync(path);
    this.validateInstallation(target);
    this.owned(target);
    const partitions = join(target, 'Partitions');
    if (
      !existsSync(partitions) ||
      !statSync(partitions).isDirectory() ||
      readdirSync(partitions).length === 0
    )
      throw new Error('此文件夹没有原账号网页数据，不能作为恢复目录');
    this.writable(target);
    // Adopting an intact copy must not run a pending move or delete old data.
    return this.saveRecovery(target);
  }

  createFresh(parent: string) {
    if (
      !isAbsolute(parent) ||
      !existsSync(parent) ||
      !statSync(parent).isDirectory()
    )
      throw new Error('请选择有效的文件夹');
    const base = this.customDirectory(parent);
    // Explicit fresh login never reuses or replaces an existing directory.
    const target = existsSync(base)
      ? `${base}-New-${randomUUID().slice(0, 8)}`
      : base;
    this.validateTarget(target);
    mkdirSync(target, { recursive: true });
    this.writable(target);
    writeFileSync(
      join(target, marker),
      JSON.stringify({ id: this.config.id }),
      { flag: 'wx', mode: 0o600 },
    );
    // This is only called after the user explicitly accepts signing in again.
    return this.saveRecovery(target);
  }

  private verifyCopy(source: string, target: string) {
    if (statSync(source).isDirectory()) {
      for (const name of readdirSync(source))
        this.verifyCopy(join(source, name), join(target, name));
    } else if (statSync(source).size !== statSync(target).size)
      throw new Error('复制检查失败，仍保留原有账号数据');
  }

  private cleanPrevious() {
    const source = this.config.cleanup;
    if (!source) return;
    try {
      if (!existsSync(source)) {
        this.save({ ...this.config, cleanup: undefined });
        return;
      }
      this.owned(source);
      if (pathKey(source) === pathKey(this.config.active))
        throw new Error('不能清理当前使用的缓存目录');
      for (const name of readdirSync(source)) {
        if (
          !browserEntry(name) ||
          (pathKey(source) === pathKey(this.profile) && name === 'Local State')
        )
          continue;
        rmSync(join(source, name), { recursive: true, force: true });
      }
      this.save({ ...this.config, cleanup: undefined });
    } catch (error) {
      this.error = `新目录已启用，旧缓存未完全清理，将在下次启动重试：${String(error)}`;
    }
  }

  initialize(): string {
    const source = this.config.active;
    if (!existsSync(source))
      throw new Error(
        `缓存与账号网页数据目录无法访问：${source}。请连接对应磁盘或恢复文件夹后重启，避免丢失已有登录状态。`,
      );
    this.owned(source);
    this.writable(source);
    this.cleanPrevious();
    const target = this.config.pending;
    if (!target) return this.config.active;
    let stage = '';
    let committed = false;
    const movedNew: string[] = [];
    const movedOld: string[] = [];
    try {
      if (pathKey(target) === pathKey(source)) {
        this.save({ ...this.config, pending: undefined });
        return source;
      }
      if (!existsSync(dirname(target)))
        throw new Error('目标磁盘或上级文件夹不可用，原账号数据未改动');
      this.validateTarget(target);
      mkdirSync(target, { recursive: true });
      this.writable(target);
      stage = mkdtempSync(join(dirname(target), '.zl-wa-cache-move-'));
      const incoming = join(stage, 'incoming');
      const previous = join(stage, 'previous');
      mkdirSync(incoming);
      mkdirSync(previous);
      const names = readdirSync(source).filter(name => browserEntry(name));
      for (const name of names) {
        cpSync(join(source, name), join(incoming, name), {
          recursive: true,
          dereference: true,
          preserveTimestamps: true,
          errorOnExist: true,
          force: false,
        });
        this.verifyCopy(join(source, name), join(incoming, name));
      }
      for (const name of new Set([
        ...names,
        ...readdirSync(target).filter(name => browserEntry(name)),
      ])) {
        if (existsSync(join(target, name))) {
          renameSync(join(target, name), join(previous, name));
          movedOld.push(name);
        }
        if (existsSync(join(incoming, name))) {
          renameSync(join(incoming, name), join(target, name));
          movedNew.push(name);
        }
      }
      if (pathKey(target) !== pathKey(this.profile))
        writeFileSync(
          join(target, marker),
          JSON.stringify({ id: this.config.id }),
          { mode: 0o600 },
        );
      this.save({
        ...this.config,
        active: target,
        pending: undefined,
        cleanup: source,
      });
      committed = true;
    } catch (error) {
      try {
        for (const name of movedNew)
          rmSync(join(target, name), { recursive: true, force: true });
        for (const name of movedOld)
          renameSync(join(stage, 'previous', name), join(target, name));
      } catch {
        /* The complete source remains authoritative even if restoring an unused target failed. */
      }
      this.error = `缓存迁移未完成，继续使用原目录，已有登录数据保留：${String(error)}`;
    } finally {
      if (stage)
        try {
          rmSync(stage, { recursive: true, force: true });
        } catch {
          /* A failed temporary cleanup cannot change the active profile. */
        }
    }
    if (committed) this.cleanPrevious();
    return this.config.active;
  }
}
