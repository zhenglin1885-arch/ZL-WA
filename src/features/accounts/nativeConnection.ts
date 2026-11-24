/* Read-only bridge for the original WhatsApp Web connection. No SDK, credentials,
 * QR values, browser API replacements or native module mutations are involved. */
export function configureNativeConnection(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (page.__zlWaNativeConnection?.version === 1) return true;
  const chatPresent = () =>
    Boolean(document.querySelector('#pane-side, #side'));
  const module = (name: string) => {
    try {
      const req = page.require;
      if (typeof req !== 'function') return undefined;
      let registry;
      try {
        registry = req('__debug')?.modulesMap ?? req.m;
      } catch {}
      if (registry) {
        const known =
          typeof registry.has === 'function'
            ? registry.has(name)
            : Object.prototype.hasOwnProperty.call(registry, name);
        if (!known) return undefined;
        const entry =
          typeof registry.get === 'function'
            ? registry.get(name)
            : registry[name];
        // Read already-created exports first. Probing a registered but unresolved
        // Meta module can poison the page's own initialization during pairing.
        if (entry && typeof entry === 'object') {
          if (
            entry.hasError === true ||
            entry.isInitialized === false ||
            entry.initialized === false
          )
            return undefined;
          if ('exports' in entry) return entry.exports ?? undefined;
          if (
            entry.isReady === false ||
            (entry.waitingMap && Object.keys(entry.waitingMap).length)
          )
            return undefined;
        }
      } else if (!chatPresent()) return undefined;
      return req(name);
    } catch {
      return undefined;
    }
  };
  const backend = () => module('WAWebBackendEventBus')?.BackendEventBus;
  const states = [
    'CONNECTED',
    'OPENING',
    'PAIRING',
    'UNPAIRED',
    'UNPAIRED_IDLE',
    'UNLAUNCHED',
    'CONFLICT',
    'TIMEOUT',
    'PROXYBLOCK',
    'TOS_BLOCK',
    'SMB_TOS_BLOCK',
  ];
  const trace: { at: number; event: string; code: string | null }[] = [];
  const started = Date.now();
  const record = (event: string, value?: unknown) => {
    trace.push({
      at: Math.max(0, Date.now() - started),
      event,
      code: typeof value === 'string' && states.includes(value) ? value : null,
    });
    if (trace.length > 64) trace.shift();
    try {
      page.ferdium?.pushWhatsAppConnectionEvent?.({
        event,
        code: trace[trace.length - 1].code,
      });
    } catch {}
  };
  const read = () => {
    const bus = backend();
    // A present new bus is authoritative, even if its state is not ready yet.
    const socket = bus
      ? bus.socketState
      : chatPresent()
        ? module('WAWebSocketModel')?.Socket?.state
        : undefined;
    return {
      source: bus
        ? 'backend-event-bus'
        : typeof socket === 'string'
          ? 'legacy-socket'
          : 'unavailable',
      socket: states.includes(socket) ? socket : null,
      mainReady:
        typeof bus?.isMainStreamReadyMd === 'boolean'
          ? bus.isMainStreamReadyMd
          : null,
    };
  };
  const ready = async () => {
    const before = read();
    if (before.source !== 'backend-event-bus') return null;
    if (
      before.socket !== 'CONNECTED' ||
      before.mainReady !== true ||
      !chatPresent()
    )
      return false;
    const sync = module('WAWebUserPrefsAppStateSync');
    if (typeof sync?.getAllCriticalDataSynced === 'function') {
      try {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          const synced = await Promise.race([
            sync.getAllCriticalDataSynced(),
            new Promise(resolve => {
              deadline = setTimeout(() => resolve(false), 1500);
            }),
          ]);
          if (synced !== true) return false;
        } finally {
          if (deadline) clearTimeout(deadline);
        }
      } catch {
        return false;
      }
    }
    const after = read();
    return (
      after.socket === 'CONNECTED' && after.mainReady === true && chatPresent()
    );
  };
  const readyCallbacks = new Set<() => void>();
  const bindings: (() => void)[] = [];
  let boundBus: any,
    boundLinks: any,
    checking = false,
    disposed = false;
  const check = async () => {
    if (disposed || checking) return;
    checking = true;
    try {
      if ((await ready()) === true && !disposed)
        for (const callback of [...readyCallbacks]) {
          readyCallbacks.delete(callback);
          try {
            callback();
          } catch {}
        }
    } finally {
      checking = false;
    }
  };
  const bind = (object: any, event: string, fn: (...args: any[]) => void) => {
    if (typeof object?.on !== 'function' || typeof object?.off !== 'function')
      return;
    object.on(event, fn);
    bindings.push(() => object.off(event, fn));
  };
  const observe = () => {
    if (disposed) return;
    const bus = backend();
    if (bus && bus !== boundBus) {
      boundBus = bus;
      for (const [event, label] of [
        ['set_socket_state', 'socket-state'],
        ['open_socket_stream', 'socket-open'],
        ['main_stream_mode_ready', 'main-ready'],
        ['on_critical_sync_done', 'critical-sync'],
        ['socket_stream_disconnected', 'socket-disconnected'],
        ['storage_initialization_error', 'storage-error'],
        ['logout', 'logout'],
      ])
        bind(bus, event, value => {
          record(label, value);
          void check();
        });
      record('backend-observed', bus.socketState);
    }
    const links = module('WAWebLinkDeviceEvents')?.WAWebLinkDeviceEvents;
    if (links && links !== boundLinks) {
      boundLinks = links;
      for (const [event, label] of [
        ['link_device_events:error_alt_linking', 'phone-link-error'],
        ['link_device_events:primary_hello_received', 'phone-link-hello'],
        ['link_device_events:refresh_alt_linking_code', 'phone-link-refresh'],
      ])
        bind(links, event, () => record(label));
    }
    void check();
  };
  const socketListeners = new Map<
    Function,
    { bus: any; event: string; wrapped: Function }[]
  >();
  const socketFacade = {
    get state() {
      return read().socket;
    },
    on(event: string, fn: Function) {
      const bus = backend();
      const mapped =
        event === 'change:state'
          ? 'set_socket_state'
          : event === 'change:hasSynced'
            ? 'main_stream_mode_ready'
            : null;
      if (!bus || !mapped || typeof bus.on !== 'function')
        throw Error('WhatsApp connection event unavailable');
      const wrapped = (value: any) => fn(socketFacade, value);
      bus.on(mapped, wrapped);
      const rows = socketListeners.get(fn) || [];
      rows.push({ bus, event: mapped, wrapped });
      socketListeners.set(fn, rows);
      return socketFacade;
    },
    off(event: string, fn: Function) {
      const mapped =
        event === 'change:state'
          ? 'set_socket_state'
          : event === 'change:hasSynced'
            ? 'main_stream_mode_ready'
            : null;
      const rows = socketListeners.get(fn) || [];
      for (const row of rows)
        if (row.event === mapped) row.bus.off(row.event, row.wrapped);
      const left = rows.filter(row => row.event !== mapped);
      if (left.length) socketListeners.set(fn, left);
      else socketListeners.delete(fn);
      return socketFacade;
    },
    logout() {
      const bus = backend();
      if (typeof bus?.triggerLogout !== 'function')
        throw Error('WhatsApp logout unavailable');
      return bus.triggerLogout();
    },
    poke() {
      const bus = backend();
      if (typeof bus?.triggerReconnectSocket !== 'function')
        throw Error('WhatsApp reconnect unavailable');
      return bus.triggerReconnectSocket();
    },
  };
  const timer = setInterval(observe, 500);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    for (const stop of bindings) stop();
    for (const rows of socketListeners.values())
      for (const row of rows) row.bus.off(row.event, row.wrapped);
    socketListeners.clear();
    readyCallbacks.clear();
  };
  page.__zlWaNativeConnection = {
    version: 1,
    read,
    ready,
    socket: () => socketFacade,
    trace,
    onReady(callback: () => void) {
      readyCallbacks.add(callback);
      void check();
      return () => readyCallbacks.delete(callback);
    },
    dispose,
  };
  page.addEventListener('pagehide', dispose, { once: true });
  observe();
  return true;
}
