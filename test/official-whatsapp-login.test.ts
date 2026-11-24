/* eslint-disable global-require -- Fresh Electron ownership/window mocks per case. */
import { EventEmitter } from 'node:events';

let owner: any;
let guest: any;
let manager: any;
let prepare: jest.Mock;
let children: any[];
let sessions: Map<string, object>;
let session: object;
let contents: Map<number, any>;

beforeEach(() => {
  jest.resetModules();
  children = [];
  sessions = new Map();
  session = {};
  sessions.set('persist:service-qa', session);
  owner = Object.assign(new EventEmitter(), { webContents: {} });
  guest = {
    url: 'https://web.whatsapp.com/login/',
    destroyed: false,
    session,
    hostWebContents: owner.webContents,
    isDestroyed: () => guest.destroyed,
    getType: () => 'webview',
    getURL: () => guest.url,
    getUserAgent: () => 'Existing account browser',
    getWebRTCIPHandlingPolicy: () => 'disable_non_proxied_udp',
    executeJavaScript: jest.fn(async () => ({
      state: 'login',
      navigationStart: 1000,
      chatPresent: false,
      composerPresent: false,
    })),
    loadURL: jest.fn(async url => {
      guest.url = url;
    }),
  };
  contents = new Map([[7, guest]]);
  jest.doMock('electron', () => ({
    webContents: { fromId: id => contents.get(id) },
    session: {
      fromPartition: id => {
        if (!sessions.has(id)) sessions.set(id, {});
        return sessions.get(id);
      },
    },
    BrowserWindow: class extends EventEmitter {
      options: any;
      webContents: any;
      destroyed = false;
      show = jest.fn();
      focus = jest.fn();
      setMenu = jest.fn();
      constructor(options: any) {
        super();
        this.options = options;
        this.webContents = Object.assign(new EventEmitter(), {
          session: options.webPreferences.session,
          setUserAgent: jest.fn(),
          setWebRTCIPHandlingPolicy: jest.fn(),
          setWindowOpenHandler: jest.fn(),
        });
        children.push(this);
      }
      isDestroyed() {
        return this.destroyed;
      }
      loadURL = jest.fn(async () => {});
      close() {
        this.destroy();
      }
      destroy() {
        this.destroyed = true;
        this.emit('closed');
      }
    },
  }));
  prepare = jest.fn(async () => {});
  const Controller = require('../src/electron/OfficialWhatsAppLogin').default;
  manager = new Controller(owner, prepare);
});
afterEach(() => {
  owner.emit('closed');
  jest.dontMock('electron');
});

it('hands a logged-out page to a window with the exact Session, UA and network policy, then restores the normal page', async () => {
  await manager.open('qa', 7);
  const child = children[0];
  expect(guest.loadURL).toHaveBeenCalledWith('about:blank');
  expect(child.options.webPreferences).toEqual({
    session,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  expect(child.options.webPreferences).not.toHaveProperty('preload');
  expect(child.webContents.setUserAgent).toHaveBeenCalledWith(
    'Existing account browser',
  );
  expect(child.webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith(
    'disable_non_proxied_udp',
  );
  expect(child.loadURL).toHaveBeenCalledWith('https://web.whatsapp.com/');
  child.close();
  await Promise.resolve();
  expect(guest.loadURL.mock.calls.map(call => call[0])).toEqual([
    'about:blank',
    'https://web.whatsapp.com/',
  ]);
  expect(manager.diagnostics('qa').open).toBe(false);
});

it.each(['chat', 'loading', 'covered-frame', 'error-document'])(
  'does not interrupt a %s page',
  async state => {
    guest.executeJavaScript.mockResolvedValue({
      state,
      chatPresent: state === 'chat',
      composerPresent: false,
    });
    await expect(manager.open('qa', 7)).rejects.toThrow('仅在二维码');
    expect(children).toHaveLength(0);
    expect(guest.loadURL).not.toHaveBeenCalled();
  },
);

it('rechecks readiness and does not interrupt a login that completed while the request was pending', async () => {
  guest.executeJavaScript
    .mockResolvedValueOnce({ state: 'login', navigationStart: 1000 })
    .mockResolvedValueOnce({
      state: 'chat',
      navigationStart: 1000,
      chatPresent: true,
    });
  await expect(manager.open('qa', 7)).rejects.toThrow('登录状态已变化');
  expect(children).toHaveLength(0);
  expect(guest.loadURL).not.toHaveBeenCalled();
});

it.each([
  'missing',
  'wrong-parent',
  'wrong-session',
  'wrong-type',
  'destroyed',
])('refuses an unowned or unavailable guest: %s', async condition => {
  if (condition === 'missing') contents.clear();
  if (condition === 'wrong-parent') guest.hostWebContents = {};
  if (condition === 'wrong-session') guest.session = {};
  if (condition === 'wrong-type') guest.getType = () => 'window';
  if (condition === 'destroyed') guest.destroyed = true;
  await expect(manager.open('qa', 7)).rejects.toThrow('账号窗口不匹配');
  expect(prepare).not.toHaveBeenCalled();
  expect(children).toHaveLength(0);
});

it('deduplicates concurrent requests and focuses the existing login window', async () => {
  let resume: () => void = () => {};
  prepare.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        resume = resolve;
      }),
  );
  const first = manager.open('qa', 7),
    second = manager.open('qa', 7);
  resume();
  await Promise.all([first, second]);
  expect(children).toHaveLength(1);
  expect(prepare).toHaveBeenCalledTimes(1);
  await expect(manager.open('qa', 7)).resolves.toMatchObject({ reused: true });
  expect(children[0].focus).toHaveBeenCalledTimes(2);
});

it('does not restore over a page the user changed while the window was open', async () => {
  await manager.open('qa', 7);
  guest.url = 'https://web.whatsapp.com/another-page';
  children[0].close();
  await Promise.resolve();
  expect(guest.loadURL).toHaveBeenCalledTimes(1);
  expect(manager.diagnostics('qa').events.at(-1).event).toBe('restore-skipped');
});

it('cancels an in-flight handoff when that account is removed', async () => {
  let resume: () => void = () => {};
  prepare.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        resume = resolve;
      }),
  );
  const first = manager.open('qa', 7);
  manager.close('qa');
  resume();
  await expect(first).rejects.toThrow('账号页面已变化');
  expect(children).toHaveLength(0);
  expect(guest.loadURL).not.toHaveBeenCalled();
});

it('restores safely if pausing navigated to blank but its completion failed', async () => {
  guest.loadURL.mockImplementationOnce(async () => {
    guest.url = 'about:blank';
    throw Error('cancelled navigation');
  });
  await expect(manager.open('qa', 7)).rejects.toThrow('cancelled navigation');
  await Promise.resolve();
  expect(guest.url).toBe('https://web.whatsapp.com/');
  expect(children[0].isDestroyed()).toBe(true);
});

it('preserves the original page if network review preparation fails', async () => {
  prepare.mockRejectedValue(Error('review required'));
  await expect(manager.open('qa', 7)).rejects.toThrow('review required');
  expect(guest.loadURL).not.toHaveBeenCalled();
  expect(children).toHaveLength(0);
});

it('does not retain page URLs, account text or request details in the navigation trace', async () => {
  await manager.open('qa', 7);
  children[0].webContents.emit('will-navigate', {
    url: 'https://web.whatsapp.com/?PRIVATE_TOKEN',
  });
  children[0].webContents.emit('did-redirect-navigation', {
    isMainFrame: true,
    url: 'PRIVATE',
  });
  const value = JSON.stringify(manager.diagnostics('qa'));
  expect(value).not.toMatch(/PRIVATE|https|Existing account browser/);
  expect(
    manager
      .diagnostics('qa')
      .events.some(event => event.event === 'server-redirect'),
  ).toBe(true);
});

it('inspects only trusted WhatsApp frames and bounds the returned metadata', async () => {
  const main: any = {
    url: 'https://web.whatsapp.com/?PRIVATE_TOKEN',
    origin: 'https://web.whatsapp.com',
    executeJavaScript: jest.fn(async () => ({
      loadingChats: true,
      storagePersisted: true,
    })),
  };
  const opaque: any = {
    url: 'https://web.whatsapp.com/client/?PRIVATE',
    origin: 'null',
    executeJavaScript: jest.fn(async () => ({ storageError: 'SecurityError' })),
  };
  const other: any = {
    url: 'https://unrelated.invalid/?PRIVATE',
    origin: 'https://unrelated.invalid',
    executeJavaScript: jest.fn(),
  };
  main.framesInSubtree = [main, opaque, other];
  guest.mainFrame = main;
  const value = await manager.inspect('qa', 7);
  expect(value.original).toHaveLength(3);
  expect(value.original[1]).toMatchObject({
    opaque: true,
    state: { storageError: 'SecurityError' },
  });
  expect(other.executeJavaScript).not.toHaveBeenCalled();
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE|https/);
});

it('bounds a hung guest readiness read without navigating it', async () => {
  jest.useFakeTimers();
  try {
    guest.executeJavaScript.mockImplementation(() => new Promise(() => {}));
    const result = manager.open('qa', 7);
    const rejected = expect(result).rejects.toThrow('读取登录页面超时');
    await jest.advanceTimersByTimeAsync(4100);
    await rejected;
    expect(guest.loadURL).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
  } finally {
    jest.useRealTimers();
  }
});
