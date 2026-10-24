// ZL-WA modification: cover branding when switching to an active service.
import type ServicesStoreClass from '../../src/stores/ServicesStore';

function mockCreateDebugLogger() {
  return jest.fn();
}

function mockFilterServicesByActiveWorkspace<T>(services: T): T {
  return services;
}

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
}));

jest.mock('../../src/environment-remote', () => ({
  ferdiumVersion: 'test-version',
  userDataRecipesPath: (...segments: string[]) => segments.join('/'),
}));

jest.mock('../../src/features/workspaces', () => ({
  workspaceStore: {
    filterServicesByActiveWorkspace: mockFilterServicesByActiveWorkspace,
  },
}));
jest.mock('../../src/preload-safe-debug', () => mockCreateDebugLogger);

const ServicesStore = jest.requireActual<
  typeof import('../../src/stores/ServicesStore')
>('../../src/stores/ServicesStore').default;

const makeStore = (services: any[], activeService?: string) => {
  for (const service of services) service.isEnabled ??= true;
  const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
  Object.defineProperty(store, 'allDisplayed', { value: services });
  Object.assign(store, {
    stores: {
      router: { location: { pathname: '/' } },
      settings: { all: { service: { activeService } } },
    },
    _setActive: jest.fn(),
  });
  return store;
};

describe('ServicesStore', () => {
  it('does not replace live WhatsApp unread totals with the slower DOM recipe badge', () => {
    const service = { recipe: { id: 'whatsapp' }, accountUnreadLive: true };
    const setUnreadMessageCount = jest.fn();
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, {
      one: () => service,
      actions: { service: { setUnreadMessageCount } },
    });
    store._handleIPCMessage({
      serviceId: 'target',
      channel: 'message-counts',
      args: [{ direct: 1, indirect: 0 }],
    });
    expect(setUnreadMessageCount).not.toHaveBeenCalled();
    service.accountUnreadLive = false;
    store._handleIPCMessage({
      serviceId: 'target',
      channel: 'message-counts',
      args: [{ direct: 1, indirect: 0 }],
    });
    expect(setUnreadMessageCount).toHaveBeenCalledTimes(1);
  });

  it('manually sleeps only the selected account even when automatic hibernation is disabled', () => {
    const target = {
      canHibernate: false,
      isHibernationEnabled: false,
      isActive: true,
      name: 'Target',
      isHibernationRequested: false,
      isManuallyHibernating: false,
      lastHibernated: null,
    };
    const other = { isManuallyHibernating: false };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, {
      one: (id: string) => (id === 'target' ? target : other),
    });
    store._hibernate({ serviceId: 'target', manual: true });
    expect(target.isManuallyHibernating).toBe(true);
    expect(target.isHibernationRequested).toBe(true);
    expect(target.isHibernationEnabled).toBe(false);
    expect(target.isActive).toBe(true);
    expect(other.isManuallyHibernating).toBe(false);
  });

  it('does not let automatic wakeup reopen a manually closed account', () => {
    const service = {
      isManuallyHibernating: true,
      isHibernationRequested: true,
      lastHibernated: 123,
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, { one: () => service });
    store._awake({ serviceId: 'sleeping', automatic: true });
    expect(service.isManuallyHibernating).toBe(true);
    expect(service.lastHibernated).toBe(123);
  });

  it('selects a sleeping window without waking or mounting the account', () => {
    const sleeping = {
      id: 'sleeping',
      isActive: false,
      isManuallyHibernating: true,
      isHibernationRequested: true,
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.defineProperty(store, 'all', { value: [sleeping] });
    Object.assign(store, {
      one: () => sleeping,
      stores: { router: { push: jest.fn() } },
      lastUsedServices: [],
      _awake: jest.fn(),
    });
    store._setActive({ serviceId: sleeping.id });
    expect(sleeping.isActive).toBe(true);
    expect(store._awake).not.toHaveBeenCalled();
    expect(sleeping.isManuallyHibernating).toBe(true);
    expect(sleeping.isHibernationRequested).toBe(true);
  });
  it('reopens a manually sleeping account and rechecks its live login status', () => {
    const service = {
      isManuallyHibernating: true,
      isHibernationRequested: true,
      lastHibernated: 123,
      accountSnapshot: { status: 'online', phone: '8613800000000' },
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, { one: () => service });
    store._awake({ serviceId: 'sleeping' });
    expect(service.isManuallyHibernating).toBe(false);
    expect(service.isHibernationRequested).toBe(false);
    expect(service.lastHibernated).toBeNull();
    expect(service.accountSnapshot).toEqual({
      status: 'loading',
      phone: '8613800000000',
    });
  });

  it('finishes inserting the created account before callers can activate it', async () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const response = { data: { id: 'new-account' }, status: [] };
    store.immediateStartupIds = new Set();
    let finishPatch!: () => void;
    const patchDone = new Promise<void>(resolve => {
      finishPatch = resolve;
    });
    Object.assign(store, {
      stores: {
        recipes: { isInstalled: () => true },
        settings: { app: { spellcheckerLanguage: 'en-US' } },
      },
      actions: { settings: { update: jest.fn() } },
      createServiceRequest: {
        execute: () => ({ promise: Promise.resolve(response) }),
      },
      allServicesRequest: { patch: jest.fn(() => patchDone) },
    });
    let completed = false;
    const creation = store
      ._createService({
        recipeId: 'whatsapp',
        serviceData: { name: 'New' },
        redirect: false,
        skipCleanup: true,
      })
      .then(() => {
        completed = true;
      });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(store.immediateStartupIds.has('new-account')).toBe(true);
    finishPatch();
    await creation;
    expect(completed).toBe(true);
  });

  it('retains account cards when deleting from the backend fails', async () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const patch = jest.fn();
    Object.assign(store, {
      deleteServiceRequest: {
        execute: () => ({ promise: Promise.reject(new Error('offline')) }),
      },
      allServicesRequest: { patch },
    });
    await expect(
      store._deleteService({ serviceId: 'keep-account', redirect: null }),
    ).rejects.toThrow('offline');
    expect(patch).not.toHaveBeenCalled();
  });

  describe('automatic selection after removing an account', () => {
    it('skips the first sleeping account and selects an already awake account', () => {
      const sleeping = { id: 'sleeping', isActive: false, isHibernating: true };
      const awake = { id: 'awake', isActive: false, isHibernating: false };
      const store = makeStore([sleeping, awake], 'deleted');
      store._mapActiveServiceToServiceModelReaction();
      store._checkForActiveService();
      expect(store._setActive).toHaveBeenCalledWith({ serviceId: 'awake' });
      expect(sleeping.isActive).toBe(false);
      expect(sleeping.isHibernating).toBe(true);
    });
    it.each([undefined, 'deleted'])(
      'keeps every remaining account asleep when selection is %s',
      activeService => {
        const sleeping = [
          { id: 'first', isActive: false, isHibernating: true },
          { id: 'second', isActive: false, isHibernating: true },
        ];
        const store = makeStore(sleeping, activeService);
        store._mapActiveServiceToServiceModelReaction();
        store._checkForActiveService();
        // Later preference updates rerun these same reactions.
        store._mapActiveServiceToServiceModelReaction();
        store._checkForActiveService();
        expect(store._setActive).not.toHaveBeenCalled();
        expect(
          sleeping.every(service => !service.isActive && service.isHibernating),
        ).toBe(true);
      },
    );
    it('never uses a disabled account as an automatic fallback', () => {
      const disabled = {
        id: 'disabled',
        isEnabled: false,
        isActive: false,
        isHibernating: false,
      };
      const sleeping = { id: 'sleeping', isActive: false, isHibernating: true };
      const store = makeStore([disabled, sleeping]);
      store._mapActiveServiceToServiceModelReaction();
      store._checkForActiveService();
      expect(store._setActive).not.toHaveBeenCalled();
      expect(disabled.isActive).toBe(false);
      expect(sleeping.isActive).toBe(false);
    });
    it('preserves the current awake account when an unrelated account is deleted', () => {
      const sleeping = { id: 'sleeping', isActive: false, isHibernating: true };
      const active = { id: 'current', isActive: true, isHibernating: false };
      const store = makeStore([sleeping, active], active.id);
      store._mapActiveServiceToServiceModelReaction();
      store._checkForActiveService();
      expect(store._setActive).not.toHaveBeenCalled();
      expect(active.isActive).toBe(true);
      expect(sleeping.isActive).toBe(false);
    });
    it('preserves an explicitly selected sleeping account without waking it', () => {
      const sleeping = { id: 'sleeping', isActive: true, isHibernating: true };
      const store = makeStore([sleeping], sleeping.id);
      store._mapActiveServiceToServiceModelReaction();
      store._checkForActiveService();
      expect(store._setActive).not.toHaveBeenCalled();
      expect(sleeping.isActive).toBe(true);
      expect(sleeping.isHibernating).toBe(true);
    });
    it('selects an awake account normally when no saved selection exists', () => {
      const sleeping = { id: 'sleeping', isActive: false, isHibernating: true };
      const awake = { id: 'awake', isActive: false, isHibernating: false };
      const store = makeStore([sleeping, awake]);
      store._mapActiveServiceToServiceModelReaction();
      expect(awake.isActive).toBe(true);
      expect(sleeping.isActive).toBe(false);
    });
  });

  it('uses ZL-WA in the active service window title', () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.defineProperty(store, 'active', {
      value: { name: 'WhatsApp', dialogTitle: 'Chat', pageTitle: 'Inbox' },
    });
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { title: '' },
    });
    try {
      store._updateWindowTitleReaction();
      expect(document.title).toBe('ZL-WA - WhatsApp - Chat - Inbox');
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });

  it('keeps settings input focus while accounts run, and resumes chat focus after closing settings', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    let settingsOpen = true;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { querySelector: () => (settingsOpen ? {} : null) },
    });
    const service = {
      id: 'account',
      webview: { focus: jest.fn(), blur: jest.fn() },
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.defineProperty(store, 'active', { value: service });
    Object.assign(store, {
      one: () => service,
      stores: {
        user: { isLoggedIn: true },
        settings: { app: { splitMode: false } },
      },
    });
    try {
      store._focusService({ serviceId: service.id });
      store._focusActiveService();
      expect(service.webview.focus).not.toHaveBeenCalled();
      expect(service.webview.blur).not.toHaveBeenCalled();
      settingsOpen = false;
      store._focusActiveService();
      expect(service.webview.focus).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(globalThis, 'document', original);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('clears UserAgent webview reference when detaching a service', () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const userAgentModel = {
      setWebviewReference: jest.fn(),
    };
    const service = {
      isAttached: true,
      userAgentModel,
      webview: { id: 'webview' },
    };

    store._detachService({ service });

    expect(userAgentModel.setWebviewReference).toHaveBeenCalledWith(null);
    expect(service.webview).toBeNull();
    expect(service.isAttached).toBe(false);
  });
});
