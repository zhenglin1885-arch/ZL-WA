import vm from 'node:vm';
import { configurePairingDiagnostics } from '../src/features/accounts/pairingDiagnostics';
import { readSendDiagnostics } from '../src/features/accounts/sendDiagnostics';
import {
  recordPageTransition,
  collectSendDiagnostics,
} from '../src/features/accounts/collectSendDiagnostics';

it('observes QR changes and bounded error types without reading QR data or replacing browser APIs', () => {
  const listeners = new Map<string, any>();
  let mutate: any;
  const observe = jest.fn();
  const disconnect = jest.fn();
  const native = {
    pushState: jest.fn(),
    WebSocket: function NativeSocket() {},
    open: jest.fn(),
    fetch: jest.fn(),
  };
  const page: any = {
    history: { pushState: native.pushState },
    WebSocket: native.WebSocket,
    indexedDB: { open: native.open },
    fetch: native.fetch,
    require: () => ({ Socket: { state: 'PAIRING' } }),
  };
  page.addEventListener = (name: string, f: any) => listeners.set(name, f);
  page.removeEventListener = jest.fn();
  const document = {
    documentElement: {},
    visibilityState: 'visible',
    querySelector: (selector: string) =>
      selector.includes('qrcode') ? {} : null,
    querySelectorAll: () => [],
  };
  const context: any = {
    window: page,
    location: { hostname: 'web.whatsapp.com' },
    navigator: { onLine: true },
    document,
    Date,
    setInterval: jest.fn(() => 1),
    clearInterval: jest.fn(),
    MutationObserver: class {
      constructor(callback: any) {
        mutate = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  };
  expect(
    vm.runInNewContext(
      `(${configurePairingDiagnostics.toString()})()`,
      context,
    ),
  ).toBe(true);
  vm.runInNewContext(`(${configurePairingDiagnostics.toString()})()`, context);
  expect(observe).toHaveBeenCalledTimes(1);
  const target = {
    querySelector: () => ({}),
    getAttribute: () => {
      throw Error('QR secret must never be read');
    },
  };
  for (let i = 0; i < 80; i += 1)
    mutate([{ type: 'attributes', attributeName: 'data-ref', target }]);
  listeners.get('error')({
    error: { name: 'QuotaExceededError', message: 'PRIVATE_QR PRIVATE_PHONE' },
  });
  listeners.get('unhandledrejection')({
    reason: { name: 'PRIVATE_PHONE', message: 'PRIVATE_CHAT' },
  });
  const output = JSON.parse(
    JSON.stringify(
      vm.runInNewContext(`(${readSendDiagnostics.toString()})()`, context),
    ),
  );
  expect(output.pairing.qrChanges).toBe(80);
  expect(output.pairing.events).toHaveLength(64);
  expect(output.pairing.events.at(-1)).toMatchObject({
    event: 'exception',
    code: 'QuotaExceededError',
  });
  expect(JSON.stringify(output)).not.toMatch(/PRIVATE_/);
  expect(page.history.pushState).toBe(native.pushState);
  expect(page.WebSocket).toBe(native.WebSocket);
  expect(page.fetch).toBe(native.fetch);
  expect(native.open).not.toHaveBeenCalled();
  listeners.get('pagehide')();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(context.clearInterval).toHaveBeenCalled();
});

it('redacts unknown diagnostic fields and bounds browser-originated pairing events', () => {
  const page = {
    __zlPairingTrace: {
      qrChanges: 1,
      events: [
        { event: 'login', at: 1, code: 'PRIVATE_CODE', qr: 'PRIVATE_QR' },
        { event: 'PRIVATE_EVENT', at: 2, code: null },
      ],
    },
  };
  const context = {
    window: page,
    location: { hostname: 'web.whatsapp.com' },
    navigator: { onLine: true },
    document: { querySelector: () => null, querySelectorAll: () => [] },
  };
  const r = JSON.parse(
    JSON.stringify(
      vm.runInNewContext(`(${readSendDiagnostics.toString()})()`, context),
    ),
  );
  expect(r.pairing.events).toEqual([{ at: 1, event: 'login', code: null }]);
  expect(JSON.stringify(r)).not.toMatch(/PRIVATE_/);
});

it('keeps host loading observations scoped to the selected guest and bounded without URLs', async () => {
  const view: any = {
    executeJavaScript: jest.fn(async () => ({ unavailable: true })),
  };
  const other: any = {
    executeJavaScript: jest.fn(async () => ({ unavailable: true })),
  };
  for (let i = 0; i < 40; i += 1) recordPageTransition(view, 'loading-started');
  recordPageTransition(view, 'main-frame-navigated');
  const r = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
  );
  expect(r.page.transitions).toHaveLength(32);
  expect(r.page.transitions.at(-1)?.event).toBe('main-frame-navigated');
  const b = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: other },
    async () => ({}),
  );
  expect(b.page.transitions).toEqual([]);
  const changed = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
    () => false,
  );
  expect(changed.page.transitions).toEqual([]);
});
