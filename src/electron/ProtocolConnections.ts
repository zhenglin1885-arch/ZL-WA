import {
  app,
  utilityProcess,
  type BrowserWindow,
  type UtilityProcess,
} from 'electron';
import { join } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { BulkMedia } from '../features/accountTools/config';

export default class ProtocolConnections {
  private entries = new Map<
    string,
    {
      child: UtilityProcess;
      next: number;
      closing: boolean;
      pending: Map<
        number,
        {
          resolve: (value: any) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >;
      ready: Promise<any>;
    }
  >();

  constructor(private mainWindow: BrowserWindow) {}

  get active() {
    return this.entries.size > 0;
  }

  private create(id: string) {
    const path = app.isPackaged
      ? join(process.resourcesPath, 'protocol-backend', 'worker.mjs')
      : join(app.getAppPath(), '..', 'tools', 'protocol-backend', 'worker.mjs');
    const child = utilityProcess.fork(path, [], {
      serviceName: 'WhatsApp protocol account',
      stdio: 'ignore',
    });
    const entry = {
      child,
      next: 0,
      closing: false,
      pending: new Map(),
      ready: Promise.resolve(),
    } as typeof this.entries extends Map<string, infer T> ? T : never;
    this.entries.set(id, entry);
    child.on('message', message => {
      if (message?.event === 'state') {
        if (!this.mainWindow.isDestroyed() && !entry.closing)
          this.mainWindow.webContents.send('protocol-state', id, message.state);
        return;
      }
      const pending = entry.pending.get(message?.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      entry.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.value);
    });
    child.on('exit', () => {
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error('账号连接进程已结束；操作结果可能未确认，请先核验'),
        );
      }
      entry.pending.clear();
      if (this.entries.get(id) === entry) this.entries.delete(id);
      if (!entry.closing && !this.mainWindow.isDestroyed())
        this.mainWindow.webContents.send('protocol-state', id, {
          status: 'error',
          error: '连接进程已结束，请重新连接',
          qr: null,
        });
    });
    entry.ready = this.requestRaw(id, 'initialize', {
      directory: join(app.getPath('userData'), 'protocol-accounts', id),
    });
    return entry;
  }

  private requestRaw(id: string, action: string, args: any = {}) {
    const entry = this.entries.get(id)!;
    return new Promise<any>((resolve, reject) => {
      const key = ++entry.next;
      const timer = setTimeout(
        () => {
          entry.pending.delete(key);
          reject(new Error('接口等待超时；请核验结果，未自动重复提交'));
        },
        action === 'send' ? 180_000 : 45_000,
      );
      entry.pending.set(key, { resolve, reject, timer });
      try {
        entry.child.postMessage({ id: key, action, args });
      } catch {
        clearTimeout(timer);
        entry.pending.delete(key);
        reject(new Error('账号连接进程不可用'));
      }
    });
  }

  async request(id: string, action: string, args: any = {}) {
    if (typeof id !== 'string' || !/^[\da-z-]{1,100}$/i.test(id))
      throw new Error('无效账号');
    const entry = this.entries.get(id) || this.create(id);
    await entry.ready;
    if (entry.closing) throw new Error('账号正在断开');
    return this.requestRaw(id, action, args);
  }

  async close(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.closing = true;
    try {
      await entry.ready;
      await this.requestRaw(id, 'stop');
    } finally {
      entry.child.kill();
      if (this.entries.get(id) === entry) this.entries.delete(id);
    }
  }

  async dispose() {
    await Promise.allSettled(
      [...this.entries.keys()].map(id => this.close(id)),
    );
  }

  media(id: string): { data: string; mime: string; name: string } {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new Error('无效附件编号');
    const directory = join(app.getPath('userData'), 'bulk-media');
    const meta: BulkMedia = JSON.parse(
      readFileSync(join(directory, `${id}.json`), 'utf8'),
    );
    if (statSync(join(directory, id)).size > 50 * 1024 * 1024)
      throw new Error('附件超过大小限制');
    return {
      data: readFileSync(join(directory, id)).toString('base64'),
      mime: meta.mime,
      name: meta.name,
    };
  }
}
