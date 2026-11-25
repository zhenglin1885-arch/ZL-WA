import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { configureNativeConnection } from '../src/features/accounts/nativeConnection';
import { readSendDiagnostics } from '../src/features/accounts/sendDiagnostics';
import {
  collectSendDiagnostics,
  recordNativeConnection,
} from '../src/features/accounts/collectSendDiagnostics';
import ts from 'typescript';
const prepare = require('../build-helpers/prepare-whatsapp-library.cjs');
function fixture(modern = true) {
  const bus = Object.assign(new EventEmitter(), {
    socketState: 'PAIRING',
    isMainStreamReadyMd: false,
    triggerLogout: jest.fn(),
    triggerReconnectSocket: jest.fn(),
  });
  const links = new EventEmitter();
  let chat = false,
    critical = false;
  const legacy = Object.assign(new EventEmitter(), { state: 'CONNECTED' });
  const modules: any = modern
    ? {
        WAWebBackendEventBus: { BackendEventBus: bus },
        WAWebLinkDeviceEvents: { WAWebLinkDeviceEvents: links },
        WAWebUserPrefsAppStateSync: {
          getAllCriticalDataSynced: async () => critical,
        },
      }
    : { WAWebSocketModel: { Socket: legacy } };
  const events = new Map<string, () => void>();
  const req = jest.fn((name: string) => {
    if (name === '__debug')
      return {
        modulesMap: Object.fromEntries(
          Object.keys(modules).map(k => [
            k,
            { isInitialized: true, exports: modules[k] },
          ]),
        ),
      };
    if (!(name in modules)) throw Error('Unknown native module ' + name);
    return modules[name];
  });
  const page: any = {
    require: req,
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
    history: { pushState: jest.fn() },
    fetch: jest.fn(),
    indexedDB: { open: jest.fn() },
    PublicKeyCredential: function PublicKeyCredential() {},
  };
  const context: any = vm.createContext({
    window: page,
    location: { hostname: 'web.whatsapp.com' },
    navigator: { onLine: true },
    document: {
      querySelector: (s: string) => (chat && s.includes('#side') ? {} : null),
      querySelectorAll: () => [],
    },
    Date,
    setInterval: jest.fn(() => 1),
    clearInterval: jest.fn(),
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(`(${configureNativeConnection.toString()})()`, context);
  return {
    page,
    context,
    bus,
    legacy,
    links,
    modules,
    req,
    events,
    setChat: (value: boolean) => {
      chat = value;
    },
    setCritical: (value: boolean) => {
      critical = value;
    },
    dispose: () => events.get('pagehide')?.(),
  };
}
function sdkModules(source: string) {
  const begin =
    source.indexOf('__webpack_modules__=') + '__webpack_modules__='.length;
  return vm.runInNewContext(
    '(' +
      source.slice(begin, source.indexOf(';const __webpack_module_cache__')) +
      ')',
  );
}
it('reads the new login bus and phone-link failures without touching the missing legacy module or browser APIs', () => {
  const f = fixture();
  try {
    const before = {
      push: f.page.history.pushState,
      fetch: f.page.fetch,
      open: f.page.indexedDB.open,
      trigger: f.bus.emit,
    };
    vm.runInContext(`(${configureNativeConnection.toString()})()`, f.context);
    f.links.emit('link_device_events:error_alt_linking', {
      phone: 'PRIVATE_PHONE',
      code: 'PRIVATE_CODE',
    });
    f.bus.socketState = 'UNPAIRED';
    f.bus.emit('set_socket_state', 'UNPAIRED');
    expect(f.page.__zlWaNativeConnection.read()).toMatchObject({
      source: 'backend-event-bus',
      socket: 'UNPAIRED',
      mainReady: false,
    });
    expect(f.req.mock.calls.some(([name]) => name === 'WAWebSocketModel')).toBe(
      false,
    );
    expect(f.context.setInterval).toHaveBeenCalledTimes(1);
    expect(f.page.history.pushState).toBe(before.push);
    expect(f.page.fetch).toBe(before.fetch);
    expect(f.page.indexedDB.open).toBe(before.open);
    expect(f.bus.emit).toBe(before.trigger);
    expect(f.bus.triggerLogout).not.toHaveBeenCalled();
    expect(f.bus.triggerReconnectSocket).not.toHaveBeenCalled();
    f.page.__zlWaNativeConnection.trace.push({
      at: 0,
      event: 'phone-link-error',
      code: 'PRIVATE_CODE',
    });
    const diagnostic = vm.runInContext(
      `(${readSendDiagnostics.toString()})()`,
      f.context,
    );
    expect(diagnostic.nativeConnection.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'phone-link-error', code: null }),
      ]),
    );
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_/);
  } finally {
    f.dispose();
  }
});

it('keeps native close categories through the preload and host boundaries across document navigation', async () => {
  const f = fixture();
  const view = {
    executeJavaScript: jest.fn(async () => ({ unavailable: true })),
  };
  const original = readFileSync('src/webview/recipe.ts', 'utf8');
  const begin =
    original.indexOf('pushWhatsAppConnectionEvent: ') +
    'pushWhatsAppConnectionEvent: '.length;
  const callback = original
    .slice(begin, original.indexOf('  pushWhatsAppUnread:', begin))
    .trim()
    .replace(/,$/, '');
  const calls: any[] = [];
  const code = ts.transpileModule(
    'const callback = ' + callback + ';callback;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const bridge = vm.runInNewContext(code, {
    process: { isMainFrame: true },
    location: { hostname: 'web.whatsapp.com' },
    ipcRenderer: {
      sendToHost: (_channel: string, value: any) => {
        calls.push(value);
        recordNativeConnection(view, value);
      },
    },
  });
  f.page.ferdium = { pushWhatsAppConnectionEvent: bridge };
  for (const code of Object.values(
    JSON.parse(
      readFileSync('test/fixtures/whatsapp-registration-stages.json', 'utf8'),
    ),
  )) {
    bridge({ event: 'registration-stage', code });
    expect(calls.at(-1).code).toBe(code);
  }
  bridge({ event: 'registration-stage', code: 'PRIVATE_TOKEN' });
  expect(calls.at(-1).code).toBe(null);
  const registrationCopy = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
  );
  expect(registrationCopy.page.nativeTransitions.map(e => e.code)).toEqual([
    ...Object.values(
      JSON.parse(
        readFileSync('test/fixtures/whatsapp-registration-stages.json', 'utf8'),
      ),
    ),
    null,
  ]);
  const publicModules = JSON.parse(
    readFileSync('test/fixtures/whatsapp-native-link-events.json', 'utf8'),
  );
  const nativeReasons: any = {};
  vm.runInNewContext(publicModules.WASocketCloseReason.definition, {
    __d: (_name: string, _deps: string[], factory: Function) =>
      factory(null, null, null, null, null, nativeReasons),
  });
  const nativeAppReasons: any = {};
  vm.runInNewContext(publicModules.WAWebAppCommsCloseReason.definition, {
    __d: (_name: string, _deps: string[], factory: Function) =>
      factory(
        null,
        null,
        () => nativeReasons,
        () => nativeReasons,
        null,
        nativeAppReasons,
        nativeAppReasons,
      ),
  });
  const reasons = [
    ...Object.values(nativeReasons.CommsCloseReason),
    ...Object.values(nativeAppReasons.AppCommsCloseReason),
  ];
  expect(reasons).toHaveLength(47);
  try {
    for (const reason of reasons) {
      f.bus.emit('socket_stream_disconnected', reason);
      expect(f.page.__zlWaNativeConnection.trace.at(-1).code).toBe(reason);
      const diagnostic = vm.runInContext(
        `(${readSendDiagnostics.toString()})()`,
        f.context,
      );
      expect(diagnostic.nativeConnection.events.at(-1).code).toBe(reason);
    }
    f.bus.emit('socket_stream_disconnected', {
      reason: 'registration_failure',
      secret: 'PRIVATE_TOKEN',
    });
    f.bus.emit('socket_stream_disconnected');
    const reasonGetter = jest.fn(() => {
      throw Error('PRIVATE_GETTER');
    });
    f.bus.emit(
      'socket_stream_disconnected',
      Object.defineProperty({}, 'reason', { get: reasonGetter }),
    );
    expect(reasonGetter).not.toHaveBeenCalled();
    f.links.emit('link_device_events:passkey_prologue_request');
    f.links.emit('link_device_events:shortcake_prologue_sent');
    f.links.emit('link_device_events:shortcake_verification_code_ready', {
      code: 'PRIVATE_CODE',
    });
    f.links.emit('link_device_events:shortcake_error', {
      name: 'NotAllowedError',
      message: 'PRIVATE_MESSAGE',
    });
    bridge({ event: 'passkey-surface', code: 'error' });
    f.bus.emit('socket_stream_disconnected', 'PRIVATE_REASON');
    bridge({ event: 'PRIVATE_EVENT', code: 'ws_close_normal' });
    bridge({
      event: 'socket-disconnected',
      code: 'PRIVATE_REASON',
      secret: 'PRIVATE_TOKEN',
    });
    f.dispose();
    const result = await collectSendDiagnostics(
      { isError: false, errorMessage: '', webview: view },
      async () => ({}),
    );
    expect(
      result.page.nativeTransitions
        .filter(e => e.event !== 'registration-stage')
        .map(e => e.code),
    ).toEqual([
      ...reasons,
      'registration_failure',
      null,
      null,
      null,
      null,
      null,
      'NotAllowedError',
      'error',
      null,
      null,
    ]);
    expect(
      result.page.nativeTransitions.slice(-7, -3).map(e => e.event),
    ).toEqual([
      'passkey-request',
      'passkey-prologue-sent',
      'passkey-verification-ready',
      'passkey-error',
    ]);
    expect(JSON.stringify({ result, calls })).not.toContain('PRIVATE_');
    expect(
      result.page.nativeTransitions.find(
        e => e.code === 'registration_failure' && e.payloadKind === 'object',
      ),
    ).toMatchObject({
      code: 'registration_failure',
      payloadKind: 'object',
    });
    expect(
      result.page.nativeTransitions.find(e => e.payloadKind === 'undefined'),
    ).toMatchObject({
      code: null,
      payloadKind: 'undefined',
    });
  } finally {
    f.dispose();
  }
});

it('records caught official passkey error surfaces without reading verification text', () => {
  const f = fixture();
  let selectors = new Set<string>();
  const privateElement = new Proxy(
    {},
    {
      get() {
        throw Error('Verification text was read');
      },
    },
  );
  f.context.document.querySelector = jest.fn((selector: string) =>
    selectors.has(selector) ? privateElement : null,
  );
  const poll = f.context.setInterval.mock.calls.at(-1)[0];
  try {
    selectors = new Set([
      '[data-testid="shortcake_passkey_screen"]',
      '[data-testid="shortcake_passkey_prompt_card"]',
    ]);
    poll();
    expect(f.page.__zlWaNativeConnection.read().passkeySurface).toBe('prompt');
    selectors.add('[data-testid="shortcake_passkey_error_message"]');
    poll();
    expect(f.page.__zlWaNativeConnection.trace.at(-1)).toMatchObject({
      event: 'passkey-surface',
      code: 'error',
    });
    const diagnostic = vm.runInContext(
      `(${readSendDiagnostics.toString()})()`,
      f.context,
    );
    expect(diagnostic.nativeConnection.passkeySurface).toBe('error');
    expect(diagnostic.nativeConnection.events.at(-1).code).toBe('error');
    selectors.clear();
    poll();
    expect(f.page.__zlWaNativeConnection.trace.at(-1).code).toBe('absent');
    expect(
      f.context.document.querySelector.mock.calls.flat().join(' '),
    ).not.toContain('shortcake_verification_code_display');
  } finally {
    f.dispose();
  }
});

it('observes Shortcake events without reading verification secrets or calling the authenticator', () => {
  const f = fixture();
  const secret = new Proxy(
    {},
    {
      get() {
        throw Error('Verification payload was inspected');
      },
    },
  );
  const credentialGet = jest.fn();
  f.context.navigator.credentials = { get: credentialGet };
  try {
    for (const event of [
      'passkey_prologue_request',
      'shortcake_prologue_sent',
      'shortcake_verification_code_ready',
    ])
      f.links.emit('link_device_events:' + event, secret, secret);
    f.links.emit('link_device_events:shortcake_error', {
      name: 'NotAllowedError',
      message: 'PRIVATE_CHALLENGE',
    });
    f.links.emit('link_device_events:shortcake_error', secret);
    const result = vm.runInContext(
      `(${readSendDiagnostics.toString()})()`,
      f.context,
    );
    expect(result.format).toBe(6);
    expect(result.nativeConnection.linkEventsObserved).toBe(true);
    expect(result.nativeConnection.events.slice(-5)).toEqual([
      expect.objectContaining({ event: 'passkey-request', code: null }),
      expect.objectContaining({ event: 'passkey-prologue-sent', code: null }),
      expect.objectContaining({
        event: 'passkey-verification-ready',
        code: null,
      }),
      expect.objectContaining({
        event: 'passkey-error',
        code: 'NotAllowedError',
      }),
      expect.objectContaining({ event: 'passkey-error', code: null }),
    ]);
    expect(result.browserContext).toMatchObject({
      publicKeyCredentialAvailable: true,
      credentialsGetAvailable: true,
    });
    expect(credentialGet).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    f.dispose();
    for (const event of [
      'passkey_prologue_request',
      'shortcake_prologue_sent',
      'shortcake_verification_code_ready',
      'shortcake_error',
    ])
      expect(f.links.listenerCount('link_device_events:' + event)).toBe(0);
  } finally {
    f.dispose();
  }
});

it('waits for late native link events initialization and binds only once', () => {
  const f = fixture();
  try {
    f.page.__zlWaNativeConnection.dispose();
    delete f.page.__zlWaNativeConnection;
    delete f.modules.WAWebLinkDeviceEvents;
    vm.runInContext(`(${configureNativeConnection.toString()})()`, f.context);
    expect(f.page.__zlWaNativeConnection.read().linkEventsObserved).toBe(false);
    f.modules.WAWebLinkDeviceEvents = { WAWebLinkDeviceEvents: f.links };
    const poll = f.context.setInterval.mock.calls.at(-1)[0];
    poll();
    poll();
    f.links.emit('link_device_events:passkey_prologue_request');
    expect(
      f.page.__zlWaNativeConnection.trace.filter(
        (e: any) => e.event === 'passkey-request',
      ),
    ).toHaveLength(1);
  } finally {
    f.page.__zlWaNativeConnection.dispose();
  }
});
it('requires connected stream, a chat surface and completed critical sync, then rechecks after asynchronous sync', async () => {
  const f = fixture();
  try {
    const adapter = f.page.__zlWaNativeConnection;
    expect(await adapter.ready()).toBe(false);
    f.bus.socketState = 'CONNECTED';
    f.bus.isMainStreamReadyMd = true;
    expect(await adapter.ready()).toBe(false);
    f.setChat(true);
    expect(await adapter.ready()).toBe(false);
    f.setCritical(true);
    expect(await adapter.ready()).toBe(true);
    f.modules.WAWebUserPrefsAppStateSync.getAllCriticalDataSynced =
      async () => {
        f.bus.socketState = 'UNPAIRED';
        return true;
      };
    expect(await adapter.ready()).toBe(false);
  } finally {
    f.dispose();
  }
});
it('keeps legacy socket behavior and removes only its own listeners on document exit', async () => {
  const f = fixture(false);
  try {
    f.setChat(true);
    expect(f.page.__zlWaNativeConnection.read()).toMatchObject({
      source: 'legacy-socket',
      socket: 'CONNECTED',
    });
    expect(await f.page.__zlWaNativeConnection.ready()).toBe(null);
  } finally {
    f.dispose();
  }
  expect(f.context.clearInterval).toHaveBeenCalledTimes(1);
  const modern = fixture();
  const callback = jest.fn();
  modern.bus.on('set_socket_state', callback);
  modern.dispose();
  expect(modern.bus.listenerCount('set_socket_state')).toBe(1);
});
it('preserves unknown new-bus state instead of borrowing a stale connected legacy state', async () => {
  const f = fixture();
  try {
    f.setChat(true);
    f.modules.WAWebSocketModel = { Socket: { state: 'CONNECTED' } };
    f.bus.socketState = undefined as any;
    expect(f.page.__zlWaNativeConnection.read().socket).toBe(null);
    expect(await f.page.__zlWaNativeConnection.ready()).toBe(false);
    expect(f.req.mock.calls.some(([n]) => n === 'WAWebSocketModel')).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
});
it('uses the real SDK socket export and main-ready registrar on the new bus without changing native exports', async () => {
  const f = fixture();
  try {
    const original = readFileSync(
      'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js',
      'utf8',
    );
    const modules = sdkModules(prepare(original));
    const legacy = Object.assign(new EventEmitter(), { state: 'CONNECTED' });
    const definitions: any = {};
    const events = new EventEmitter();
    const exportModule = (out: any, _map: any) =>
      Object.defineProperty(out, 'Socket', {
        configurable: true,
        enumerable: true,
        get: () => legacy,
      });
    // Factories refer to their browser window, so run in the same native fixture.
    const socketFactory = vm.runInContext(
      '(' + modules[82183].toString().replace(/^82183\(/, 'function(') + ')',
      f.context,
    );
    socketFactory({}, definitions, () => ({ exportModule }));
    expect(definitions.Socket.state).toBe('PAIRING');
    const listener = jest.fn();
    definitions.Socket.on('change:state', listener);
    f.bus.socketState = 'CONNECTED';
    f.bus.emit('set_socket_state', 'CONNECTED');
    expect(listener).toHaveBeenCalledWith(definitions.Socket, 'CONNECTED');
    definitions.Socket.off('change:state', listener);
    const mainFactory = vm.runInContext(
      '(' + modules[28952].toString().replace(/^28952\(/, 'function(') + ')',
      f.context,
    );
    const ready = jest.fn();
    events.on('conn.main_ready', ready);
    mainFactory({}, {}, (id: number) =>
      id === 13691
        ? { internalEv: events }
        : id === 7222
          ? { onInjected: (fn: any) => fn() }
          : id === 17833
            ? () => () => {}
            : { StreamMode: { MAIN: 'MAIN', QR: 'QR' } },
    );
    f.setChat(true);
    f.bus.isMainStreamReadyMd = true;
    f.bus.emit('main_stream_mode_ready');
    await new Promise(r => setImmediate(r));
    expect(ready).not.toHaveBeenCalled();
    f.setCritical(true);
    f.bus.emit('on_critical_sync_done');
    await new Promise(r => setImmediate(r));
    expect(ready).toHaveBeenCalledTimes(1);
    f.bus.emit('main_stream_mode_ready');
    await new Promise(r => setImmediate(r));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(f.modules.WAWebBackendEventBus.BackendEventBus).toBe(f.bus);
    expect(f.bus.triggerLogout).not.toHaveBeenCalled();
    expect(f.bus.triggerReconnectSocket).not.toHaveBeenCalled();
  } finally {
    f.dispose();
  }
});

it('does not require registered but uninitialized native modules during login and sees exports after the page initializes them', () => {
  const f = fixture();
  try {
    const registry: any = {
      WAWebBackendEventBus: { isInitialized: false, exports: {} },
      WAWebODSObserver: {},
    };
    f.req.mockClear();
    f.req.mockImplementation((name: string) => {
      if (name === '__debug') return { modulesMap: registry };
      throw Error('Must not force native initialization');
    });
    expect(f.page.__zlWaNativeConnection.read().source).toBe('unavailable');
    f.context.setInterval.mock.calls[0][0]();
    expect(f.req.mock.calls.some(([name]) => name === 'WAWebODSObserver')).toBe(
      false,
    );
    expect(
      f.page.__zlWaNativeConnection.read().registrationEventsObserved,
    ).toBe(false);
    registry.WAWebBackendEventBus = {
      isInitialized: true,
      exports: { BackendEventBus: f.bus },
    };
    expect(f.page.__zlWaNativeConnection.read()).toMatchObject({
      source: 'backend-event-bus',
      socket: 'PAIRING',
    });
    expect(
      f.req.mock.calls.filter(([n]) => n === 'WAWebBackendEventBus'),
    ).toEqual([]);
  } finally {
    f.dispose();
  }
});

it('observes only public registration stages, binds once after initialization and removes its own subscription', () => {
  const f = fixture();
  const emitter = new EventEmitter();
  const external = jest.fn();
  emitter.on('event', external);
  const addListener = jest.fn((name, fn) => {
    emitter.on(name, fn);
    return { remove: () => emitter.off(name, fn) };
  });
  const stages = JSON.parse(
    readFileSync('test/fixtures/whatsapp-registration-stages.json', 'utf8'),
  );
  try {
    expect(
      f.page.__zlWaNativeConnection.read().registrationEventsObserved,
    ).toBe(false);
    expect(f.req.mock.calls.some(([name]) => name === 'WAWebODSObserver')).toBe(
      false,
    );
    f.modules.WAWebODSObserver = { default: { addListener } };
    const poll = f.context.setInterval.mock.calls[0][0];
    poll();
    poll();
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(
      f.page.__zlWaNativeConnection.read().registrationEventsObserved,
    ).toBe(true);
    for (const [key, code] of Object.entries(stages)) {
      emitter.emit('event', {
        key,
        count: 'PRIVATE_COUNT',
        token: 'PRIVATE_TOKEN',
      });
      expect(f.page.__zlWaNativeConnection.trace.at(-1)).toMatchObject({
        event: 'registration-stage',
        code,
      });
      const diagnostic = vm.runInContext(
        `(${readSendDiagnostics.toString()})()`,
        f.context,
      );
      expect(diagnostic.nativeConnection.events.at(-1).code).toBe(code);
    }
    const length = f.page.__zlWaNativeConnection.trace.length;
    const getter = jest.fn(() => {
      throw Error('PRIVATE_GETTER');
    });
    emitter.emit('event', Object.defineProperty({}, 'key', { get: getter }));
    emitter.emit('event', {
      key: 'web.app.canonical.registration.PRIVATE_VALUE',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(f.page.__zlWaNativeConnection.trace).toHaveLength(length);
    expect(JSON.stringify(f.page.__zlWaNativeConnection.trace)).not.toContain(
      'PRIVATE_',
    );
  } finally {
    f.dispose();
  }
  expect(emitter.listenerCount('event')).toBe(1);
});
