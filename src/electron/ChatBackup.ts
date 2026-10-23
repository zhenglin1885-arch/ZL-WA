/* eslint-disable no-await-in-loop, no-continue -- Export work yields between bounded batches; files are written in sequence. */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  backupDay,
  defaultBackupConfig,
  validateBackupConfig,
  validateBackupPacket,
  type BackupConfig,
  type BackupMessage,
  type BackupState,
} from '../features/chatBackup/types';

interface Codec {
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
}
interface Shard {
  accountId: string;
  ownerId: string;
  accountName: string;
  chatId: string;
  chatName: string;
  day: string;
  revision: number;
  messages: Record<string, BackupMessage>;
}
interface Meta {
  day: string;
  messages: number;
  images: number;
  bytes: number;
  revision: number;
}
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const escape = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const safeName = (v: string) =>
  v
    // eslint-disable-next-line no-control-regex -- Control characters are forbidden in file names.
    .replaceAll(/[\u0000-\u001F"*/:<>?\\|]/g, '_')
    .replace(/[ .]+$/, '')
    .slice(0, 65) || '聊天';
const page = (title: string, body: string) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#eef2f5;color:#17212b;max-width:1000px;margin:auto;padding:28px}a{color:#126bc5}header{padding:16px;background:white;border-radius:12px;margin-bottom:20px}.message{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:12px 18px;margin:14px 15% 14px 0;border-radius:12px}.out{background:#d9fdd3;margin:14px 0 14px 15%}small{color:#62717a}.translation{border-top:1px dashed #95a3ad;padding-top:8px;margin-top:8px;color:#785400}img{max-width:100%;max-height:700px;border-radius:8px}li{margin:12px 0}h1{font-size:24px}</style>${body}</html>`;

export default class ChatBackup {
  config: BackupConfig;

  error = '';

  private key?: Buffer;

  private metas: Record<string, Meta> = {};

  private exported: Record<string, string> = {};

  private lastExport?: string;

  private loaded = false;

  private exportReaders = 0;

  private exporting: Promise<unknown> = Promise.resolve();

  constructor(
    private root: string,
    private codec: Codec,
    directory: string,
  ) {
    mkdirSync(root, { recursive: true });
    this.config = defaultBackupConfig(directory);
    if (existsSync(join(root, 'settings.json'))) {
      try {
        this.config = validateBackupConfig(
          JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')),
        );
      } catch {
        this.config.enabled = false;
        this.config.automatic = false;
        this.error = '备份设置损坏，请重新设置；已有加密记录保留。';
      }
    }
  }

  private write(path: string, data: Buffer | string) {
    writeFileSync(`${path}.tmp`, data, { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }

  private secret() {
    if (this.key) return this.key;
    const p = join(this.root, 'key.secure');
    if (existsSync(p))
      this.key = Buffer.from(this.codec.decrypt(readFileSync(p)), 'base64');
    else {
      const key = randomBytes(32);
      this.write(p, this.codec.encrypt(key.toString('base64')));
      this.key = key;
    }
    if (this.key.length !== 32) throw new Error('备份密钥无效，未写入任何明文');
    return this.key;
  }

  private seal(data: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret(), iv);
    const output = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), output]);
  }

  private unseal(data: Buffer) {
    const cipher = createDecipheriv(
      'aes-256-gcm',
      this.secret(),
      data.subarray(0, 12),
    );
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
  }

  private load() {
    if (this.loaded) return;
    const p = join(this.root, 'index.enc');
    if (existsSync(p)) {
      const index = JSON.parse(this.unseal(readFileSync(p)).toString());
      this.metas = index.metas;
      this.exported = index.exported || {};
      this.lastExport = index.lastExport;
    }
    this.loaded = true;
  }

  private saveIndex() {
    this.write(
      join(this.root, 'index.enc'),
      this.seal(
        Buffer.from(
          JSON.stringify({
            metas: this.metas,
            exported: this.exported,
            lastExport: this.lastExport,
          }),
        ),
      ),
    );
  }

  state(): BackupState {
    try {
      this.load();
    } catch {
      this.error = '系统加密存储不可用或备份无法解密，请检查系统安全存储。';
    }
    const values = Object.values(this.metas);
    return {
      config: { ...this.config },
      stats: {
        messages: values.reduce((n, m) => n + m.messages, 0),
        images: values.reduce((n, m) => n + m.images, 0),
        bytes: values.reduce((n, m) => n + m.bytes, 0),
        days: [...new Set(values.map(m => m.day))]
          .sort((a, b) => String(a).localeCompare(String(b)))
          .reverse(),
        lastExport: this.lastExport,
        error: this.error || undefined,
      },
    };
  }

  configure(value: unknown) {
    const config = validateBackupConfig(value);
    this.write(join(this.root, 'settings.json'), JSON.stringify(config));
    this.config = config;
    this.prune();
    return this.state();
  }

  ingest(accountId: string, value: unknown) {
    if (!this.config.enabled) return this.state();
    const p = validateBackupPacket(value);
    this.load();
    this.secret();
    const groups = new Map<string, BackupMessage[]>();
    for (const message of p.messages) {
      const day = backupDay(message.time);
      const list = groups.get(day) || [];
      list.push(message);
      groups.set(day, list);
    }
    for (const [day, messages] of groups) {
      const key = digest(`${accountId}:${p.ownerId}:${p.chatId}:${day}`);
      const path = join(this.root, `${key}.enc`);
      const shard: Shard = existsSync(path)
        ? JSON.parse(this.unseal(readFileSync(path)).toString())
        : {
            accountId,
            ownerId: p.ownerId,
            accountName: p.accountName,
            chatId: p.chatId,
            chatName: p.chatName,
            day,
            revision: 0,
            messages: {},
          };
      let changed = false;
      for (const incoming of messages) {
        const m = { ...incoming };
        const old = shard.messages[m.id];
        if (m.image) {
          const match = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(
            m.image,
          )!;
          const data = Buffer.from(match[2], 'base64');
          const good =
            match[1] === 'jpeg'
              ? data[0] === 255 && data[1] === 216
              : match[1] === 'png'
                ? data
                    .subarray(0, 8)
                    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                : match[1] === 'gif'
                  ? data.toString('ascii', 0, 3) === 'GIF'
                  : data.toString('ascii', 0, 4) === 'RIFF' &&
                    data.toString('ascii', 8, 12) === 'WEBP';
          if (!good) throw new Error('图片格式校验失败');
          const asset = `${digest(`${accountId}:${p.ownerId}:${m.image}`)}.${match[1]}`;
          if (!existsSync(join(this.root, asset)))
            this.write(join(this.root, asset), this.seal(data));
          m.image = asset;
        } else if (old?.image) m.image = old.image;
        if (!m.translation && old?.translation) m.translation = old.translation;
        if (JSON.stringify(old) !== JSON.stringify(m)) {
          shard.messages[m.id] = m;
          changed = true;
        }
      }
      if (
        changed ||
        shard.chatName !== p.chatName ||
        shard.accountName !== p.accountName ||
        !this.metas[key]
      ) {
        shard.chatName = p.chatName;
        shard.accountName = p.accountName;
        shard.revision += 1;
        this.write(path, this.seal(Buffer.from(JSON.stringify(shard))));
        const values = Object.values(shard.messages);
        this.metas[key] = {
          day,
          messages: values.length,
          images: values.filter(m => m.image).length,
          bytes:
            statSync(path).size +
            values.reduce(
              (n, m) =>
                n + (m.image ? statSync(join(this.root, m.image)).size : 0),
              0,
            ),
          revision: shard.revision,
        };
      }
    }
    this.error = '';
    this.prune();
    this.saveIndex();
    return this.state();
  }

  prune(now = Date.now()) {
    if (this.exportReaders) return; // A yielded export still needs its snapshot images.
    this.load();
    if (!this.config.retentionDays) return;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);
    const day = backupDay(cutoff.getTime());
    const remaining = new Set<string>();
    const removed: string[] = [];
    const expired: string[] = [];
    const previous = this.metas;
    const next = { ...previous };
    for (const [key, meta] of Object.entries(previous)) {
      if (meta.day >= day) continue;
      const path = join(this.root, `${key}.enc`);
      const shard: Shard = JSON.parse(
        this.unseal(readFileSync(path)).toString(),
      );
      for (const m of Object.values(shard.messages))
        if (m.image) removed.push(m.image);
      expired.push(path);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Remove an indexed expired shard only.
      delete next[key];
    }
    if (expired.length === 0) return;
    this.metas = next;
    try {
      this.saveIndex();
    } catch (error) {
      this.metas = previous;
      throw error;
    }
    // Commit metadata before removing expired data, so an interrupted cleanup cannot break the next startup.
    for (const path of expired) unlinkSync(path);
    if (removed.length > 0) {
      for (const key of Object.keys(next)) {
        const shard: Shard = JSON.parse(
          this.unseal(readFileSync(join(this.root, `${key}.enc`))).toString(),
        );
        for (const m of Object.values(shard.messages))
          if (m.image) remaining.add(m.image);
      }
      for (const image of new Set(removed))
        if (!remaining.has(image) && existsSync(join(this.root, image)))
          unlinkSync(join(this.root, image));
    }
  }

  private revision(day: string) {
    return JSON.stringify(
      Object.entries(this.metas)
        .filter(([, m]) => m.day === day)
        .map(([id, m]) => [id, m.revision])
        .sort((a, b) => String(a).localeCompare(String(b))),
    );
  }

  export(
    selection: string,
    automatic = false,
    now = Date.now(),
  ): Promise<string> {
    const job = this.exporting
      .catch(() => {})
      .then(async () => {
        this.exportReaders += 1;
        try {
          return await this.exportNow(selection, automatic, now);
        } finally {
          this.exportReaders -= 1;
          this.prune();
        }
      });
    this.exporting = job;
    return job;
  }

  private async exportNow(
    selection: string,
    automatic = false,
    now = Date.now(),
  ) {
    this.load();
    if (!this.config.directory) throw new Error('请先选择导出文件夹');
    if (selection !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(selection))
      throw new Error('无效导出日期');
    const revision = this.revision(selection);
    const target = join(
      this.config.directory,
      selection === 'all' ? '全部聊天记录' : selection,
    );
    mkdirSync(target, { recursive: true });
    const chats = new Map<
      string,
      { shard: Shard; messages: BackupMessage[] }
    >();
    for (const [key, meta] of Object.entries(this.metas)) {
      if (selection !== 'all' && meta.day !== selection) continue;
      const shard: Shard = JSON.parse(
        this.unseal(readFileSync(join(this.root, `${key}.enc`))).toString(),
      );
      const chatKey = digest(
        `${shard.accountId}:${shard.ownerId}:${shard.chatId}`,
      );
      const saved = chats.get(chatKey) || { shard, messages: [] };
      saved.messages.push(...Object.values(shard.messages));
      chats.set(chatKey, saved);
    }
    const links: string[] = [];
    for (const [key, { shard, messages }] of chats) {
      const folder = `${safeName(shard.accountName)}-${digest(`${shard.accountId}:${shard.ownerId}`).slice(0, 8)}`;
      const name = `${safeName(shard.chatName)}-${key.slice(0, 8)}.html`;
      mkdirSync(join(target, folder, '图片'), { recursive: true });
      const rows: string[] = [];
      for (const [index, m] of messages
        .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
        .entries()) {
        if (index % 25 === 0)
          await new Promise<void>(resolve => {
            setImmediate(resolve);
          });
        let image = '';
        if (m.image) {
          this.write(
            join(target, folder, '图片', m.image),
            this.unseal(readFileSync(join(this.root, m.image))),
          );
          image = `<p><img loading="lazy" src="${escape(`图片/${m.image}`)}" alt="聊天图片"></p>`;
        } else if (m.hasImage)
          image = '<p><small>图片在网页端尚未下载或未能保存</small></p>';
        rows.push(
          `<article class="message ${m.outgoing ? 'out' : ''}"><small>${escape(m.sender)} · ${escape(new Date(m.time).toLocaleString('zh-CN'))}</small><div>${escape(m.text)}</div>${image}${m.translation ? `<div class="translation">${escape(m.translation)}</div>` : ''}</article>`,
        );
      }
      this.write(
        join(target, folder, name),
        page(
          shard.chatName,
          `<header><a href="../目录.html">← 目录</a><h1>${escape(shard.chatName)}</h1><div>${escape(shard.accountName)} · ${escape(shard.chatId)} · ${messages.length} 条消息</div></header>${rows.join('')}`,
        ),
      );
      links.push(
        `<li><a href="${escape(`${encodeURIComponent(folder)}/${encodeURIComponent(name)}`)}">${escape(shard.accountName)} / ${escape(shard.chatName)}</a> <small>${messages.length} 条消息</small></li>`,
      );
    }
    this.write(
      join(target, '目录.html'),
      page(
        '聊天记录目录',
        `<header><h1>聊天记录目录</h1><p>${selection === 'all' ? '全部已保存记录' : escape(selection)} · ${chats.size} 个对话</p><small>导出时间：${escape(new Date(now).toLocaleString('zh-CN'))}，文字、译文及已保存的图片均可离线查看。</small></header><ul>${links.join('')}</ul>`,
      ),
    );
    this.error = '';
    this.lastExport = new Date(now).toISOString();
    if (automatic) this.exported[selection] = revision;
    this.saveIndex();
    return join(target, '目录.html');
  }

  async catchUp(now = Date.now()) {
    if (
      !this.config.enabled ||
      !this.config.automatic ||
      !this.config.directory
    )
      return;
    this.load();
    this.prune(now);
    const d = new Date(now);
    const today = backupDay(now);
    const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    for (const day of [
      ...new Set(Object.values(this.metas).map(m => m.day)),
    ].sort((a, b) => String(a).localeCompare(String(b))))
      if (
        (day < today || (day === today && clock >= this.config.time)) &&
        this.exported[day] !== this.revision(day)
      )
        await this.export(day, true, now);
  }
}
