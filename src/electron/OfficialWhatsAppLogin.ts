import {
  BrowserWindow,
  session,
  webContents,
  type WebContents,
} from 'electron';
import {
  readOfficialFrameState,
  readWhatsAppPageHealth,
} from '../features/accounts/sendDiagnostics';

const officialUrl = 'https://web.whatsapp.com/';
const official = (url: string) => {
  try {
    return new URL(url).origin === 'https://web.whatsapp.com';
  } catch {
    return false;
  }
};
type LoginEvent =
  | 'opening'
  | 'original-paused'
  | 'opened'
  | 'page-navigation-requested'
  | 'server-redirect'
  | 'page-loaded'
  | 'load-failed'
  | 'closed'
  | 'restored'
  | 'restore-skipped';

// Opt-in handoff only. The original logged-out page is paused; both windows use
// the exact same Session. No storage clearing, proxy reset or SDK injection.
export default class OfficialWhatsAppLogin {
  private windows = new Map<string, BrowserWindow>();
  private pending = new Map<
    string,
    Promise<{ opened: true; reused: boolean }>
  >();
  private generations = new Map<string, number>();
  private traces = new Map<string, { at: number; event: LoginEvent }[]>();
  private disposed = false;

  constructor(
    private owner: BrowserWindow,
    private prepare: (id: string) => Promise<void>,
  ) {
    owner.once?.('closed', () => this.dispose());
  }

  dispose() {
    this.disposed = true;
    for (const window of this.windows.values())
      if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
  }

  private record(id: string, event: LoginEvent) {
    const trace = this.traces.get(id) || [];
    trace.push({ at: Date.now(), event });
    if (trace.length > 32) trace.shift();
    this.traces.set(id, trace);
  }

  diagnostics(id: string) {
    const window = this.windows.get(id);
    return {
      open: Boolean(window && !window.isDestroyed()),
      events: [...(this.traces.get(id) || [])],
    };
  }

  async inspect(id: string, contentsId: number) {
    const guest = this.guest(id, contentsId);
    const category = (url: string) => {
      try {
        const value = new URL(url);
        if (value.origin === 'https://web.whatsapp.com') return 'whatsapp-web';
        if (
          ['https://www.whatsapp.com', 'https://whatsapp.com'].includes(
            value.origin,
          )
        )
          return 'whatsapp-site';
        if (value.protocol === 'about:') return 'about';
        return 'other';
      } catch {
        return 'unknown';
      }
    };
    const inspect = async (contents: WebContents) => {
      if (contents.isDestroyed()) return [];
      const frames = contents.mainFrame.framesInSubtree.slice(0, 8);
      return Promise.all(
        frames.map(async frame => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const origin = category(frame.url);
            const base = {
              main: frame === contents.mainFrame,
              origin,
              opaque: frame.origin === 'null' || !frame.origin,
            };
            if (origin !== 'whatsapp-web') return base;
            const state = await Promise.race([
              frame.executeJavaScript(
                `(${readOfficialFrameState.toString()})()`,
              ),
              new Promise<null>(resolve => {
                timer = setTimeout(() => resolve(null), 1800);
              }),
            ]);
            return { ...base, state };
          } catch {
            return { origin: 'unavailable' };
          } finally {
            clearTimeout(timer);
          }
        }),
      );
    };
    const child = this.windows.get(id);
    const [original, loginWindow] = await Promise.all([
      inspect(guest),
      child && !child.isDestroyed()
        ? inspect(child.webContents)
        : Promise.resolve([]),
    ]);
    return { original, loginWindow };
  }

  close(id: string) {
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    const window = this.windows.get(id);
    if (window && !window.isDestroyed()) window.close();
  }

  private guest(id: string, contentsId: number): WebContents {
    if (
      !/^[\da-z-]{1,100}$/i.test(id) ||
      !Number.isSafeInteger(contentsId) ||
      contentsId < 1
    )
      throw new Error('无效账号窗口');
    const guest = webContents.fromId(contentsId);
    if (
      this.disposed ||
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== 'webview' ||
      guest.hostWebContents !== this.owner.webContents ||
      guest.session !== session.fromPartition(`persist:service-${id}`)
    )
      throw new Error('账号窗口不匹配');
    return guest;
  }

  async open(
    id: string,
    contentsId: number,
  ): Promise<{ opened: true; reused: boolean }> {
    const guest = this.guest(id, contentsId);
    const existing = this.windows.get(id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { opened: true, reused: true };
    }
    const pending = this.pending.get(id);
    if (pending) return pending;
    const generation = this.generations.get(id) || 0;
    const operation = this.launch(id, contentsId, guest, generation);
    this.pending.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(id) === operation) this.pending.delete(id);
    }
  }

  private async launch(
    id: string,
    contentsId: number,
    guest: WebContents,
    generation: number,
  ): Promise<{ opened: true; reused: boolean }> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let window: BrowserWindow | undefined;
    let paused = false;
    const restore = async () => {
      if (
        !paused ||
        this.disposed ||
        guest.isDestroyed() ||
        guest.getURL() !== 'about:blank'
      ) {
        if (paused) this.record(id, 'restore-skipped');
        return;
      }
      paused = false;
      try {
        await guest.loadURL(officialUrl);
        this.record(id, 'restored');
      } catch {
        this.record(id, 'load-failed');
      }
    };
    try {
      await this.prepare(id);
      if (
        this.guest(id, contentsId) !== guest ||
        (this.generations.get(id) || 0) !== generation ||
        !official(guest.getURL())
      )
        throw new Error('账号页面已变化，请重新选择');
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('读取登录页面超时')), 4000);
      });
      const surface = await Promise.race([
        guest.executeJavaScript(`(${readWhatsAppPageHealth.toString()})()`),
        deadline,
      ]);
      if (
        surface?.state !== 'login' ||
        surface.chatPresent ||
        surface.composerPresent
      )
        throw new Error(
          '仅在二维码登录页面使用；已登录账号请继续在原会话中操作',
        );
      if (
        this.guest(id, contentsId) !== guest ||
        (this.generations.get(id) || 0) !== generation ||
        !official(guest.getURL())
      )
        throw new Error('账号页面已变化');
      const latest = await Promise.race([
        guest.executeJavaScript(`(${readWhatsAppPageHealth.toString()})()`),
        deadline,
      ]);
      if (
        latest?.state !== 'login' ||
        latest.chatPresent ||
        latest.composerPresent ||
        latest.navigationStart !== surface.navigationStart
      )
        throw new Error('登录状态已变化，请继续等待当前会话');
      this.record(id, 'opening');
      window = new BrowserWindow({
        parent: this.owner,
        show: false,
        width: 1120,
        height: 820,
        title: 'WhatsApp 官方登录',
        webPreferences: {
          session: guest.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window.setMenu(null);
      const policy = guest.getWebRTCIPHandlingPolicy();
      if (
        [
          'default',
          'default_public_interface_only',
          'default_public_and_private_interfaces',
          'disable_non_proxied_udp',
        ].includes(policy)
      )
        window.webContents.setWebRTCIPHandlingPolicy(
          policy as Parameters<WebContents['setWebRTCIPHandlingPolicy']>[0],
        );
      this.windows.set(id, window);
      const child = window;
      child.once('closed', () => {
        if (this.windows.get(id) === child) this.windows.delete(id);
        this.record(id, 'closed');
        void restore();
      });
      child.webContents.on('will-navigate', () =>
        this.record(id, 'page-navigation-requested'),
      );
      child.webContents.on('did-redirect-navigation', event => {
        if (event.isMainFrame) this.record(id, 'server-redirect');
      });
      child.webContents.on('did-finish-load', () =>
        this.record(id, 'page-loaded'),
      );
      const userAgent = guest.getUserAgent();
      // Stop the first QR page before opening another page in its Session.
      paused = true;
      await Promise.race([guest.loadURL('about:blank'), deadline]);
      this.record(id, 'original-paused');
      if (
        this.disposed ||
        child.isDestroyed() ||
        guest.isDestroyed() ||
        (this.generations.get(id) || 0) !== generation
      )
        throw new Error('登录窗口已关闭');
      child.webContents.setUserAgent(userAgent);
      void child.loadURL(officialUrl).catch(() => {
        if (!child.isDestroyed()) this.record(id, 'load-failed');
      });
      child.show();
      child.focus();
      this.record(id, 'opened');
      return { opened: true, reused: false };
    } catch (error) {
      if (window && !window.isDestroyed()) window.destroy();
      await restore();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
