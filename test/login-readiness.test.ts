import vm from 'node:vm';
import { readWhatsAppSnapshot } from '../src/features/accounts/whatsapp';
import { readSendDiagnostics } from '../src/features/accounts/sendDiagnostics';
import { configurePairingDiagnostics } from '../src/features/accounts/pairingDiagnostics';
import { readCustomerContext } from '../src/features/customers/guest';
import { watchWhatsAppUnread } from '../src/features/accounts/unread';
import { configureWhatsAppVoice } from '../src/features/accounts/voice';
import { translationTick } from '../src/features/accountTools/guest';

it.each(['login', 'loading'])(
  'does not invoke the native lazy loader while %s, even with stale SDK and customer adapters',
  async state => {
    // Meta logs dependency errors before throwing; catching them is insufficient.
    const requireModule = jest.fn(() => {
      throw new Error('unresolved dependencies');
    });
    const owners = jest.fn(() => {
      requireModule();
    });
    const timers: (() => void)[] = [];
    const page: any = {
      require: requireModule,
      WPP: { isReady: true },
      __zlCustomerAdapter: { owners, models: owners },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    const context = vm.createContext({
      window: page,
      location: { hostname: 'web.whatsapp.com' },
      navigator: { onLine: true },
      document: {
        body: {},
        head: {},
        documentElement: {},
        visibilityState: 'visible',
        querySelector: (selector: string) =>
          state === 'login' && selector.includes('qrcode') ? {} : null,
        querySelectorAll: () => [],
      },
      MutationObserver: class {
        observe() {}

        disconnect() {}
      },
      setInterval: (callback: () => void) => {
        timers.push(callback);
        return 1;
      },
      clearInterval: jest.fn(),
      queueMicrotask: (fn: () => void) => fn(),
    });
    const snapshot = await vm.runInContext(
      `(${readWhatsAppSnapshot.toString()})(false, {state:${JSON.stringify(state)}})`,
      context,
    );
    expect(snapshot.status).toBe(state === 'login' ? 'logged-out' : 'loading');
    const diagnostics = vm.runInContext(
      `(${readSendDiagnostics.toString()})()`,
      context,
    );
    expect(diagnostics.socket).toBeNull();
    expect(diagnostics.sdkReady).toBeNull();
    const customer = vm.runInContext(
      `(${readCustomerContext.toString()})()`,
      context,
    );
    expect(customer.canInitialize).toBe(false);
    expect(customer.needsLibrary).toBe(false);
    expect(
      vm.runInContext(`(${translationTick.toString()})({})`, context),
    ).toEqual([]);
    vm.runInContext(`(${watchWhatsAppUnread.toString()})()`, context);
    expect(
      vm.runInContext(`(${configureWhatsAppVoice.toString()})()`, context),
    ).toBe(false);
    vm.runInContext(`(${configurePairingDiagnostics.toString()})()`, context);
    for (let i = 0; i < 10; i += 1) timers.forEach(callback => callback());
    expect(requireModule).not.toHaveBeenCalled();
    expect(owners).not.toHaveBeenCalled();
  },
);

it('retained customer adapters stop loading modules when a logged-in document returns to login', () => {
  let loggedIn = true;
  const native = jest.fn(() => undefined);
  const page: any = { require: native };
  const context = vm.createContext({
    window: page,
    location: { hostname: 'web.whatsapp.com' },
    crypto: { randomUUID: () => 'test-document' },
    document: {
      querySelector: (selector: string) =>
        loggedIn && selector === '#pane-side, #side' ? {} : null,
    },
  });
  vm.runInContext(`(${readCustomerContext.toString()})()`, context);
  expect(native).toHaveBeenCalled();
  native.mockClear();
  loggedIn = false;
  expect(page.__zlCustomerAdapter.owners()).toEqual([]);
  expect(page.__zlCustomerAdapter.models()).toEqual([]);
  expect(native).not.toHaveBeenCalled();
});
