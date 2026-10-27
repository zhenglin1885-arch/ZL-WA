/* eslint-disable global-require -- Load modules after installing fresh privileged Electron mocks. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTools } from '../src/features/accountTools/config';
import { encodeReactionState } from '../src/features/reactions/types';

describe('privileged account tools IPC', () => {
  let root: string;
  let handlers: Record<string, any>;
  let sessions: Map<string, any>;
  let mainWindow: any;
  let safeStorage: any;
  let event: any;
  let login: any;
  let beforeQuit: () => void;
  const invoke = (name: string, ...args: any[]) =>
    handlers[`account-tools-${name}`](event, ...args);
  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), 'zl-tools-'));
    handlers = {};
    sessions = new Map();
    mainWindow = { webContents: { mainFrame: {} } };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
      decryptString: (buffer: Buffer) =>
        buffer.toString().replace('encrypted:', ''),
    };
    jest.doMock('electron', () => ({
      app: {
        getPath: () => root,
        on: (name: string, fn: any) => {
          if (name === 'login') login = fn;
          if (name === 'before-quit') beforeQuit = fn;
        },
      },
      ipcMain: {
        handle: (name: string, handler: any) => {
          handlers[name] = handler;
        },
      },
      safeStorage,
      session: {
        fromPartition: (name: string) => {
          if (!sessions.has(name))
            sessions.set(name, {
              setProxy: jest.fn().mockImplementation(async () => {}),
              closeAllConnections: jest.fn().mockImplementation(async () => {}),
              resolveProxy: jest.fn().mockResolvedValue('DIRECT'),
              fetch: jest.fn().mockResolvedValue({ ok: true }),
            });
          return sessions.get(name);
        },
      },
    }));
    jest.doMock('../src/electron/accountTranslation', () => ({
      translateAccount: jest
        .fn()
        .mockResolvedValue({ text: 'translated', error: false }),
    }));
    const init = require('../src/electron/ipc-api/accountTools').default;
    init({ mainWindow });
  });
  afterEach(() => {
    beforeQuit?.();
    jest.dontMock('electron');
    jest.dontMock('../src/electron/accountTranslation');
    rmSync(root, { recursive: true, force: true });
  });
  it('isolates group task storage, rejects guest frames and keeps the last snapshot if writing fails', () => {
    const loaded = handlers['group-tools-load'](event);
    expect(loaded.intervals).toEqual({ speech: 3, join: 5, leave: 5 });
    expect(() =>
      handlers['group-tools-load']({ ...event, senderFrame: {} }),
    ).toThrow('禁止访问');
    loaded.intervals.speech = 4;
    handlers['group-tools-save'](event, loaded);
    expect(
      JSON.parse(readFileSync(join(root, 'group-tools.json'), 'utf8')).intervals
        .speech,
    ).toBe(4);
    const copy = handlers['group-tools-load'](event);
    copy.intervals.speech = 0;
    expect(() => handlers['group-tools-save'](event, copy)).toThrow('执行间隔');
    expect(handlers['group-tools-load'](event).intervals.speech).toBe(4);
    rmSync(root, { recursive: true, force: true });
    loaded.intervals.speech = 5;
    expect(() => handlers['group-tools-save'](event, loaded)).toThrow();
    expect(handlers['group-tools-load'](event).intervals.speech).toBe(4);
  });

  it('stores reaction tasks separately and rejects untrusted frames or invalid settings without changing existing tools', () => {
    const state = handlers['reaction-tools-load'](event);
    expect(state.preferences.emojis).toEqual(['👍']);
    expect(() =>
      handlers['reaction-tools-save']({ ...event, senderFrame: {} }, state),
    ).toThrow('禁止访问');
    state.preferences.text = '你好吗';
    handlers['reaction-tools-save'](event, state);
    const stored = JSON.parse(
      readFileSync(join(root, 'reaction-tools-v2.json'), 'utf8'),
    );
    expect(stored.format).toBe('zl-reactions-1');
    expect(stored.texts[stored.preferences.textIndex]).toBe('你好吗');
    expect(handlers['reaction-tools-load'](event).preferences.text).toBe(
      '你好吗',
    );
    state.preferences.emojis = ['invalid'];
    expect(() => handlers['reaction-tools-save'](event, state)).toThrow();
    expect(handlers['reaction-tools-load'](event).preferences.emojis).toEqual([
      '👍',
    ]);
    expect(handlers['group-tools-load'](event).intervals).toEqual({
      speech: 3,
      join: 5,
      leave: 5,
    });
  });
  it('reads legacy reaction history and preserves its file when saving the compact format', () => {
    const state = handlers['reaction-tools-load'](event);
    state.preferences.text = '保留旧匹配正文';
    const legacy = JSON.stringify(state);
    writeFileSync(join(root, 'reaction-tools.json'), legacy);
    expect(handlers['reaction-tools-load'](event)).toEqual(state);
    handlers['reaction-tools-save'](event, state);
    expect(readFileSync(join(root, 'reaction-tools.json'), 'utf8')).toBe(
      legacy,
    );
    const stored = JSON.parse(
      readFileSync(join(root, 'reaction-tools-v2.json'), 'utf8'),
    );
    stored.preferences.textIndex = -1;
    const before = readFileSync(join(root, 'reaction-tools-v2.json'), 'utf8');
    expect(() => handlers['reaction-tools-save'](event, stored)).toThrow(
      '压缩记录无效',
    );
    expect(readFileSync(join(root, 'reaction-tools-v2.json'), 'utf8')).toBe(
      before,
    );
    expect(handlers['reaction-tools-load'](event)).toEqual(state);
  });
  it('persists large multi-account reaction checkpoints through compact IPC without dropping uncertain results', () => {
    const state = handlers['reaction-tools-load'](event);
    const body = 'x'.repeat(19_000);
    state.preferences.text = body;
    state.batches = [
      {
        id: 'multi-account',
        created: 1000,
        rules: state.preferences,
        tasks: Array.from({ length: 432 }, (_value, i) => ({
          id: `task-${i}`,
          accountId: `account-${i % 3}`,
          accountName: `账号${i % 3}`,
          ownerId: `861380000000${i % 3}@c.us`,
          target: `${10_001 + Math.floor(i / 3)}@g.us`,
          name: `群${Math.floor(i / 3)}`,
          messageId: `false_${10_001 + Math.floor(i / 3)}@g.us_M`,
          text: body,
          timestamp: 1000,
          emoji: '👍',
          plannedAt: 2000,
          status: i === 0 ? 'uncertain' : 'queued',
          result: i === 0 ? '保留未确认结果' : '等待计划时间',
        })),
      },
    ];
    expect(JSON.stringify(state).length).toBeGreaterThan(5_000_000);
    handlers['reaction-tools-save'](event, encodeReactionState(state));
    const transfer = handlers['reaction-tools-load'](event, 'compact');
    expect(transfer.format).toBe('zl-reactions-1');
    expect(transfer.texts).toHaveLength(1);
    expect(
      readFileSync(join(root, 'reaction-tools-v2.json'), 'utf8').length,
    ).toBeLessThan(1_000_000);
    expect(handlers['reaction-tools-load'](event)).toEqual(state);
  });
  it('keeps reply composer preferences independent of ordinary bulk preferences', () => {
    const bulk = invoke('bulk-preferences');
    const reply = invoke('reply-preferences');
    invoke('reply-preferences', {
      ...reply,
      replyText: '匹配内容',
      replyMatch: 'contains',
      intervalMin: 7,
    });
    expect(invoke('bulk-preferences')).toEqual(bulk);
    expect(invoke('reply-preferences')).toMatchObject({
      replyText: '匹配内容',
      replyMatch: 'contains',
      intervalMin: 7,
    });
    expect(() =>
      handlers['account-tools-reply-preferences'](
        { ...event, senderFrame: {} },
        reply,
      ),
    ).toThrow('禁止访问');
  });

  it('persists only the last confirmed identity per card and restores it after restart', async () => {
    const original = {
      status: 'online',
      ownerId: '8613800000001@c.us',
      phone: '8613800000001',
      nickname: 'Known user',
      avatar: 'data:image/png;base64,b3du',
      unreadMessages: 9,
    };
    invoke('profile', 'card-a', original);
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    expect(invoke('profile', 'card-a')).toMatchObject({
      ownerId: original.ownerId,
      phone: original.phone,
      nickname: original.nickname,
      avatar: original.avatar,
    });
    expect(invoke('profile', 'card-b')).toBeUndefined();
    const saved = JSON.parse(
      readFileSync(join(root, 'account-tools.json'), 'utf8'),
    ).accountProfiles['card-a'];
    expect(saved.status).toBeUndefined();
    expect(saved.unreadMessages).toBeUndefined();
    expect(() =>
      invoke('profile', 'card-a', { status: 'logged-out' }),
    ).toThrow();
    expect(
      invoke('profile', 'card-a', {
        status: 'online',
        ownerId: original.ownerId,
      }),
    ).toMatchObject({
      phone: original.phone,
      nickname: original.nickname,
      avatar: original.avatar,
    });
    invoke('profile', 'card-a', {
      status: 'online',
      ownerId: '8613800000002@c.us',
      phone: '8613800000002',
      nickname: 'New user',
    });
    const changed = invoke('profile', 'card-a');
    expect(changed).toMatchObject({
      ownerId: '8613800000002@c.us',
      phone: '8613800000002',
      nickname: 'New user',
    });
    expect(changed.avatar).toBeUndefined();
    await invoke('remove', 'card-a');
    expect(invoke('profile', 'card-a')).toBeUndefined();
  });
  it('protects identity history from guest access, invalid pictures and failed writes', () => {
    const original = {
      status: 'online',
      ownerId: '8613800000001@c.us',
      phone: '8613800000001',
      nickname: 'Known',
    };
    invoke('profile', 'card-a', original);
    expect(() =>
      invoke('profile', 'card-a', {
        ...original,
        avatar: 'https://example.invalid/picture',
      }),
    ).toThrow();
    event.senderFrame = {};
    expect(() => invoke('profile', 'card-a')).toThrow('禁止');
    event.senderFrame = mainWindow.webContents.mainFrame;
    rmSync(root, { recursive: true, force: true });
    expect(() => invoke('profile', 'card-a', original)).not.toThrow();
    expect(() =>
      invoke('profile', 'card-a', { ...original, nickname: 'Changed' }),
    ).toThrow();
    expect(invoke('profile', 'card-a').nickname).toBe('Known');
  });
  it('persists and restores bulk settings without storing recipients, content or an old scheduled date', () => {
    const saved = invoke('bulk-preferences', {
      type: 'video',
      scheduled: true,
      randomInterval: true,
      intervalMin: 4.5,
      intervalMax: 8,
      typingSeconds: 3,
      mentionAll: true,
      failure: 'continue',
      kind: 'group',
      text: 'must not persist',
      targets: ['private'],
      scheduledAt: '2026-10-21',
    });
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    expect(invoke('bulk-preferences')).toEqual(saved);
    const raw = readFileSync(join(root, 'account-tools.json'), 'utf8');
    expect(raw).not.toContain('must not persist');
    expect(raw).not.toContain('scheduledAt');
    expect(
      invoke('bulk-preferences', {
        intervalMin: -2,
        typingSeconds: 100,
        failure: 'bad',
      }),
    ).toMatchObject({ intervalMin: 1.5, typingSeconds: 0, failure: 'stop' });
    event.senderFrame = {};
    expect(() => invoke('bulk-preferences')).toThrow('禁止');
  });
  it('reuses translations across preview toggles and reloads, with separate account and target caches', async () => {
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    const translate =
      require('../src/electron/accountTranslation').translateAccount;
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    config.translation.preview = true;
    await invoke('save', 'account-1', config);
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    beforeQuit();
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    config.translation.receiveTarget = 'en';
    await invoke('save', 'account-1', config);
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(2);
    await invoke('save', 'account-2', config);
    await invoke('translate', 'account-2', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(3);
  });
  it('shares identical pending translation requests instead of calling Google twice', async () => {
    const Queue =
      require('../src/features/accountTools/TranslationQueue').default;
    const enqueued = jest.spyOn(Queue.prototype, 'enqueue');
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    const translate =
      require('../src/electron/accountTranslation').translateAccount;
    let release!: (value: any) => void;
    translate.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    const first = invoke(
      'translate',
      'account-1',
      'same pending source',
      'incoming',
    );
    const second = invoke(
      'translate',
      'account-1',
      'same pending source',
      'incoming',
    );
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(enqueued.mock.calls[0][3]).toBe(true);
    release({ text: 'shared translation', error: false });
    expect(await Promise.all([first, second])).toEqual([
      { text: 'shared translation', error: false },
      { text: 'shared translation', error: false },
    ]);
    await invoke('translate', 'account-1', 'same pending source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    enqueued.mockRestore();
  });
  it('persists successful MyMemory results across cooldown and restart; uses Google for new content and supports explicit refresh', async () => {
    jest.useFakeTimers();
    try {
      const config = defaultTools();
      config.translation.incoming = true;
      await invoke('save', 'account-1', config);
      const google =
        require('../src/electron/accountTranslation').translateAccount;
      google
        .mockResolvedValueOnce({ text: '', error: true, rateLimited: true })
        .mockResolvedValue({ text: 'Google restored', error: false });
      const s = sessions.get('persist:service-account-1');
      s.fetch.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              responseStatus: 200,
              quotaFinished: false,
              responseData: { translatedText: 'MyMemory result' },
            }),
          ),
      );
      expect(
        await invoke('translate', 'account-1', 'Hello', 'incoming'),
      ).toMatchObject({
        text: 'MyMemory result',
        provider: 'MyMemory',
        error: false,
      });
      expect(google).toHaveBeenCalledTimes(1);
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(
        new URL(s.fetch.mock.calls[0][0]).searchParams.get('langpair'),
      ).toBe('en|zh-CN');
      expect(
        await invoke('translate', 'account-1', 'Hello', 'incoming'),
      ).toMatchObject({ text: 'MyMemory result' });
      expect(s.fetch).toHaveBeenCalledTimes(1);
      const waiting = invoke(
        'translate',
        'account-1',
        'Are you OK',
        'incoming',
      );
      await jest.advanceTimersByTimeAsync(1000);
      await waiting;
      expect(google).toHaveBeenCalledTimes(1);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(4000);
      expect(
        await invoke('translate', 'account-1', 'Hello', 'incoming'),
      ).toMatchObject({ text: 'MyMemory result', error: false });
      expect(google).toHaveBeenCalledTimes(1);
      // Even after the old five-minute backup TTL, a restart can reuse the
      // persisted successful translation without a new provider request.
      beforeQuit();
      const Cache = require('../src/electron/TranslationCache').default;
      const persisted = new Cache(join(root, 'translation-cache.json'));
      const key = Cache.key([
        'account-1',
        'Google',
        'auto',
        'zh-CN',
        invoke('get', 'account-1').providers.Google.model,
        undefined,
        'Hello',
      ]);
      await jest.advanceTimersByTimeAsync(301_000);
      expect(persisted.get(key)).toBe('MyMemory result');
      require('../src/electron/ipc-api/accountTools').default({ mainWindow });
      expect(
        await invoke('translate', 'account-1', 'Hello', 'incoming'),
      ).toMatchObject({ text: 'MyMemory result', error: false });
      expect(google).toHaveBeenCalledTimes(1);
      expect(
        await invoke('translate', 'account-1', 'Hello again', 'incoming'),
      ).toEqual({ text: 'Google restored', error: false });
      expect(google).toHaveBeenCalledTimes(2);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      const refresh = invoke(
        'translate',
        'account-1',
        'Hello',
        'incoming',
        true,
      );
      await jest.advanceTimersByTimeAsync(1000);
      expect(await refresh).toEqual({ text: 'Google restored', error: false });
      expect(google).toHaveBeenCalledTimes(3);
      expect(invoke('get', 'account-1').translation.receiveEngine).toBe(
        'Google',
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
  it('recovers legacy expired backup translations without a provider request or settings changes', async () => {
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    beforeQuit();
    const Cache = require('../src/electron/TranslationCache').default;
    const primary = Cache.key([
      'account-1',
      'Google',
      'auto',
      'zh-CN',
      invoke('get', 'account-1').providers.Google.model,
      undefined,
      'Legacy source',
    ]);
    const legacy = Cache.key([primary, 'MyMemory']);
    writeFileSync(
      join(root, 'translation-cache.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            accountId: 'account-1',
            key: legacy,
            text: '保留旧译文',
            expiresAt: Date.now() - 3_600_000,
          },
        ],
      }),
    );
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    expect(
      await invoke('translate', 'account-1', 'Legacy source', 'incoming'),
    ).toMatchObject({ text: '保留旧译文', error: false });
    expect(
      require('../src/electron/accountTranslation').translateAccount,
    ).not.toHaveBeenCalled();
    expect(
      sessions.get('persist:service-account-1').fetch,
    ).not.toHaveBeenCalled();
    beforeQuit();
    expect(new Cache(join(root, 'translation-cache.json')).get(primary)).toBe(
      '保留旧译文',
    );
    expect(
      readFileSync(join(root, 'translation-cache.json'), 'utf8'),
    ).not.toContain('expiresAt');
  });
  it('rechecks disabled translation settings before a queued MyMemory fallback can run', async () => {
    jest.useFakeTimers();
    try {
      const config = defaultTools();
      config.translation.incoming = true;
      await invoke('save', 'account-1', config);
      const google =
        require('../src/electron/accountTranslation').translateAccount;
      google.mockResolvedValue({ text: '', error: true, rateLimited: true });
      const s = sessions.get('persist:service-account-1');
      s.fetch.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              responseStatus: 200,
              responseData: { translatedText: 'backup' },
            }),
          ),
      );
      await invoke('translate', 'account-1', 'Hello', 'incoming');
      const queued = invoke('translate', 'account-1', 'Are you OK', 'incoming');
      config.translation.incoming = false;
      await invoke('save', 'account-1', config);
      await jest.advanceTimersByTimeAsync(1000);
      expect(await queued).toMatchObject({ text: '', error: true });
      expect(s.fetch).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
  it('does not associate a new model response with an old cache key while session preparation is pending', async () => {
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    let release!: () => void;
    let entered!: () => void;
    const preparing = new Promise<void>(resolve => {
      entered = resolve;
    });
    sessions.get('persist:service-account-1').setProxy.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
          entered();
        }),
    );
    const preparation = invoke('prepare', 'account-1');
    await preparing;
    const request = invoke(
      'translate',
      'account-1',
      'pending model',
      'incoming',
    );
    await invoke('save', 'account-1', {
      ...config,
      providers: { Google: { model: 'changed-model' } },
    });
    release();
    await preparation;
    expect(await request).toMatchObject({ error: true });
    expect(
      require('../src/electron/accountTranslation').translateAccount,
    ).not.toHaveBeenCalled();
  });
  it('deleting selected local history preserves other records and account settings', async () => {
    await invoke('save', 'account-1', defaultTools());
    const record = {
      id: 'one',
      started: new Date().toISOString(),
      text: 'test',
      status: '已完成',
      total: 1,
      success: 1,
      failed: 0,
      details: [],
    };
    invoke('history', record);
    invoke('history', { ...record, id: 'two' });
    expect(invoke('history-delete', ['one'])).toEqual([
      { ...record, id: 'two' },
    ]);
    expect(
      JSON.parse(readFileSync(join(root, 'account-tools.json'), 'utf8'))
        .accounts['account-1'],
    ).toBeDefined();
    expect(() => invoke('history-delete', 'all')).toThrow('无效');
    event.senderFrame = {};
    expect(() => invoke('history-delete', ['two'])).toThrow('禁止');
  });
  it('rejects webview/subframe IPC access and path-like identifiers', () => {
    event.sender = {};
    expect(() => invoke('get', 'account-1')).toThrow('禁止');
    event.sender = mainWindow.webContents;
    event.senderFrame = {};
    expect(() => invoke('get', 'account-1')).toThrow('禁止');
    event.senderFrame = mainWindow.webContents.mainFrame;
    expect(() => invoke('get', '../../bad')).toThrow('无效账号');
  });
  it('isolates account network probes, shares pending requests, caches results and supports refresh', async () => {
    await Promise.all(
      ['account-1', 'account-2'].map(id => invoke('prepare', id)),
    );
    const first = sessions.get('persist:service-account-1');
    const second = sessions.get('persist:service-account-2');
    first.fetch.mockImplementation(
      async (url: string) =>
        new Response(url.includes('cdn-cgi') ? 'ip=203.0.113.1' : null),
    );
    second.fetch.mockImplementation(
      async (url: string) =>
        new Response(url.includes('cdn-cgi') ? 'ip=203.0.113.2' : null),
    );
    const [one, shared] = await Promise.all([
      invoke('network-status', 'account-1'),
      invoke('network-status', 'account-1'),
    ]);
    expect(one.ip).toBe('203.0.113.1');
    expect(shared).toEqual(one);
    expect(first.fetch).toHaveBeenCalledTimes(2);
    const other = await invoke('network-status', 'account-2');
    expect(other.ip).toBe('203.0.113.2');
    const cached = await invoke('network-status', 'account-1');
    expect(cached.ip).toBe('203.0.113.1');
    expect(first.fetch).toHaveBeenCalledTimes(2);
    await invoke('network-status', 'account-1', true);
    expect(first.fetch).toHaveBeenCalledTimes(4);
    event.senderFrame = {};
    await expect(invoke('network-status', 'account-1')).rejects.toThrow('禁止');
  });
  it('does not expose a direct IP when a configured proxy route fails', async () => {
    const config = defaultTools();
    config.proxy = {
      ...config.proxy,
      enabled: true,
      host: 'localhost',
      port: '8888',
    };
    await invoke('save', 'account-1', config);
    const s = sessions.get('persist:service-account-1');
    await expect(invoke('network-status', 'account-1')).rejects.toThrow(
      '未使用配置的代理',
    );
    expect(s.fetch).not.toHaveBeenCalled();
    s.resolveProxy.mockResolvedValue('PROXY localhost:8888');
    s.fetch.mockImplementation(
      async (url: string) =>
        new Response(url.includes('cdn-cgi') ? 'ip=203.0.113.3' : null),
    );
    const recovered = await invoke('network-status', 'account-1', true);
    expect(recovered.ip).toBe('203.0.113.3');
  });
  it('discards a probe completed after the account network configuration changes', async () => {
    await invoke('prepare', 'account-1');
    const s = sessions.get('persist:service-account-1');
    let finish!: (value: Response) => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      started = resolve;
    });
    s.fetch.mockImplementation(async (url: string) => {
      if (!url.includes('cdn-cgi')) return new Response(null);
      started();
      return new Promise<Response>(resolve => {
        finish = resolve;
      });
    });
    const request = invoke('network-status', 'account-1');
    await waiting;
    const config = defaultTools();
    config.proxy.enabled = true;
    config.proxy.mode = 'system';
    await invoke('save', 'account-1', config);
    finish(new Response('ip=203.0.113.4'));
    await expect(request).rejects.toThrow('网络配置已更改');
    s.fetch.mockImplementation(
      async (url: string) =>
        new Response(url.includes('cdn-cgi') ? 'ip=203.0.113.5' : null),
    );
    const current = await invoke('network-status', 'account-1');
    expect(current.ip).toBe('203.0.113.5');
  });
  it('migrates the removed direct option to disabled without losing manual settings', async () => {
    const config = defaultTools();
    writeFileSync(
      join(root, 'account-tools.json'),
      JSON.stringify({
        accounts: {
          'account-1': {
            ...config,
            proxy: {
              ...config.proxy,
              enabled: true,
              mode: 'direct',
              host: 'localhost',
              port: '8888',
            },
          },
        },
        history: [],
      }),
    );
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    const restored = await invoke('prepare', 'account-1');
    expect(restored.proxy).toMatchObject({
      enabled: false,
      mode: 'manual',
      host: 'localhost',
      port: '8888',
    });
    expect(
      sessions.get('persist:service-account-1').setProxy,
    ).toHaveBeenLastCalledWith({ mode: 'system' });
  });
  it('prepares independent Sessions, restores the system network on disable, and avoids disturbing another account', async () => {
    await invoke('prepare', 'account-1');
    await invoke('prepare', 'account-2');
    const config = defaultTools();
    config.proxy = {
      ...config.proxy,
      enabled: true,
      host: 'localhost',
      port: '8888',
    };
    await invoke('save', 'account-1', config);
    const first = sessions.get('persist:service-account-1');
    expect(first.setProxy).toHaveBeenLastCalledWith(
      expect.objectContaining({ proxyRules: 'http://localhost:8888' }),
    );
    expect(
      sessions.get('persist:service-account-2').setProxy,
    ).toHaveBeenCalledTimes(1);
    config.proxy.enabled = false;
    await invoke('save', 'account-1', config);
    expect(first.setProxy).toHaveBeenLastCalledWith({ mode: 'system' });
  });
  it('allocates distinct authenticated SOCKS bridges per account and releases only the disabled account', async () => {
    const c = defaultTools();
    c.proxy = {
      ...c.proxy,
      enabled: true,
      protocol: 'socks5',
      host: '127.0.0.1',
      port: '9',
      username: 'synthetic',
      password: 'synthetic-secret',
    };
    await invoke('save', 'account-1', c);
    await invoke('save', 'account-2', c);
    const first = sessions.get('persist:service-account-1');
    const second = sessions.get('persist:service-account-2');
    const a = first.setProxy.mock.calls.at(-1)[0];
    const b = second.setProxy.mock.calls.at(-1)[0];
    expect(a.proxyRules).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(a.proxyRules).not.toBe(b.proxyRules);
    c.proxy.enabled = false;
    await invoke('save', 'account-1', c);
    expect(first.setProxy).toHaveBeenLastCalledWith({ mode: 'system' });
    expect(second.setProxy).toHaveBeenCalledTimes(1);
    const saved = await invoke('get', 'account-2');
    expect(saved.proxy.password).toBeUndefined();
  });
  it('stores only encrypted passwords, redacts read results and matches proxy authentication to the account Session', async () => {
    const config = defaultTools();
    config.proxy = {
      ...config.proxy,
      enabled: true,
      host: 'localhost',
      port: '8888',
      username: 'tester',
      password: 'synthetic-secret',
    };
    const saved = await invoke('save', 'account-1', config);
    expect(saved.proxy.password).toBeUndefined();
    expect(saved.proxy.hasPassword).toBe(true);
    expect(
      readFileSync(join(root, 'account-tools.json'), 'utf8'),
    ).not.toContain('synthetic-secret');
    const callback = jest.fn();
    const e = { preventDefault: jest.fn() };
    login(
      e,
      { session: {} },
      {},
      { isProxy: true, host: 'localhost', port: 8888 },
      callback,
    );
    expect(callback).not.toHaveBeenCalled();
    login(
      e,
      { session: sessions.get('persist:service-account-1') },
      {},
      { isProxy: true, host: 'localhost', port: 8888 },
      callback,
    );
    expect(callback).toHaveBeenCalledWith('tester', 'synthetic-secret');
  });
  it('refuses password persistence if secure storage is unavailable', async () => {
    safeStorage.isEncryptionAvailable = () => false;
    const c = defaultTools();
    c.proxy.password = 'synthetic-secret';
    await expect(invoke('save', 'account-1', c)).rejects.toThrow(
      '安全存储不可用',
    );
  });
  it('does not translate disabled directions; uses account source and target languages', async () => {
    await expect(
      invoke('translate', 'account-1', 'hello', 'outgoing'),
    ).rejects.toThrow('未启用');
    const c = defaultTools();
    c.translation.outgoing = true;
    c.translation.source = 'es';
    await invoke('save', 'account-1', c);
    expect(await invoke('translate', 'account-1', 'hola', 'outgoing')).toEqual({
      text: 'translated',
      error: false,
    });
    expect(
      require('../src/electron/accountTranslation').translateAccount,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      'hola',
      'en',
      'Google',
      'es',
      '',
      '',
    );
  });
  it('uses independent incoming translation provider, source and target settings', async () => {
    const c = defaultTools();
    c.translation.incoming = true;
    c.translation.receiveEngine = 'LibreTranslate';
    c.translation.receiveSource = 'en';
    c.translation.receiveTarget = 'fr';
    await invoke('save', 'account-1', c);
    await invoke('translate', 'account-1', 'hello', 'incoming');
    expect(
      require('../src/electron/accountTranslation').translateAccount,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      'hello',
      'fr',
      'LibreTranslate',
      'en',
      '',
      '',
    );
  });
  it('does not claim proxy success after a direct-route fallback', async () => {
    const c = defaultTools();
    c.proxy = { ...c.proxy, enabled: true, host: 'localhost', port: '8888' };
    await invoke('save', 'account-1', c);
    await expect(invoke('test-proxy', 'account-1')).rejects.toThrow('未使用');
    expect(
      sessions.get('persist:service-account-1').fetch,
    ).not.toHaveBeenCalled();
  });
  it('encrypts and redacts API keys, preserves saved keys on blank UI, and supports clearing them', async () => {
    const c = defaultTools();
    c.providers = {
      OpenAI: { apiKey: 'synthetic-provider-key', model: 'gpt-4.1-mini' },
    };
    const saved = await invoke('save', 'account-1', c);
    expect(saved.providers.OpenAI).toEqual({
      model: 'gpt-4.1-mini',
      hasApiKey: true,
    });
    expect(
      readFileSync(join(root, 'account-tools.json'), 'utf8'),
    ).not.toContain('synthetic-provider-key');
    const preserved = await invoke('save', 'account-1', saved);
    expect(preserved.providers.OpenAI.hasApiKey).toBe(true);
    preserved.providers.OpenAI.apiKey = '';
    const cleared = await invoke('save', 'account-1', preserved);
    expect(cleared.providers.OpenAI.hasApiKey).toBe(false);
  });
  it.each(['OpenAI', 'Gemini'] as const)(
    'uses the user-supplied %s key only in privileged provider requests',
    async engine => {
      const c = defaultTools();
      c.translation.outgoing = true;
      c.translation.engine = engine;
      c.providers = {
        [engine]: { apiKey: 'synthetic-user-key', model: 'synthetic-model' },
      };
      const saved = await invoke('save', 'account-1', c);
      expect(JSON.stringify(saved)).not.toContain('synthetic-user-key');
      await invoke('translate', 'account-1', 'hello', 'outgoing');
      expect(
        require('../src/electron/accountTranslation').translateAccount,
      ).toHaveBeenCalledWith(
        expect.any(Function),
        'hello',
        'en',
        engine,
        'auto',
        'synthetic-user-key',
        'synthetic-model',
      );
    },
  );
  it('deleting an account removes its stored credential/configuration', async () => {
    await invoke('save', 'account-1', defaultTools());
    await invoke('remove', 'account-1');
    expect(
      JSON.parse(readFileSync(join(root, 'account-tools.json'), 'utf8'))
        .accounts,
    ).toEqual({});
  });
});
