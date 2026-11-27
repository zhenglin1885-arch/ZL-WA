/* Read-only bridge for the original WhatsApp Web connection. No SDK, credentials,
 * QR values, browser API replacements or native module mutations are involved. */
export function configureNativeConnection(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (page.__zlWaNativeConnection?.version === 1) return true;
  const chatPresent = () =>
    Boolean(document.querySelector('#pane-side, #side'));
  const module = (name: string, initializedOnly = false) => {
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
            (entry.waitingMap && Object.keys(entry.waitingMap).length > 0)
          )
            return undefined;
        }
      } else if (!chatPresent()) return undefined;
      if (initializedOnly) return undefined;
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
  const trace: {
    at: number;
    event: string;
    code: string | null;
    payloadKind: string | null;
  }[] = [];
  // Public CommsCloseReason and AppCommsCloseReason values. Never copy raw reason text.
  const closeReasons = [
    'client_close_unspecified',
    'connection_aborted',
    'dead_socket',
    'frame_socket_drained',
    'stanza_handler_requested',
    'unknown',
    'ws_close_abnormal',
    'ws_close_bad_gateway',
    'ws_close_extension_required',
    'ws_close_going_away',
    'ws_close_invalid_payload',
    'ws_close_no_status',
    'ws_close_normal',
    'ws_close_other',
    'ws_close_policy_violation',
    'ws_close_protocol_error',
    'ws_close_server_error',
    'ws_close_service_restart',
    'ws_close_tls_failure',
    'ws_close_too_big',
    'ws_close_try_again_later',
    'ws_close_unsupported_data',
    'app_lock',
    'beta_opt_in_changed',
    'client_failure_account_locked',
    'client_failure_client_too_old',
    'client_failure_not_authorized',
    'client_logout',
    'client_tab_takeover',
    'debug_close',
    'handshake_timeout',
    'network_offline',
    'page_unload',
    'reconnect_socket',
    'refresh_qr',
    'registration_failure',
    'server_failure',
    'stream_error_ack',
    'stream_error_code_515',
    'stream_error_code_516',
    'stream_error_code_other',
    'stream_error_device_removed',
    'stream_error_other',
    'stream_error_replaced',
    'stream_error_xml_not_well_formed',
    'windows_hybrid_disconnect',
    'windows_hybrid_reconnect',
  ];
  const errorNames = [
    'NotAllowedError',
    'SecurityError',
    'InvalidStateError',
    'NotSupportedError',
    'AbortError',
    'OperationError',
    'UnknownError',
    'TypeError',
    'DataError',
    'ConstraintError',
    'TimeoutError',
  ];
  const registrationStages = [
    'pair-success',
    'canonical-start',
    'canonical-missing-jid',
    'canonical-missing-metadata',
    'canonical-nonce-decryption-failed',
    'canonical-nonce-parse-failed',
    'canonical-success',
    'canonical-token-exchange-failed',
    'canonical-unexpected-error',
    'canonical-exchange-start',
    'canonical-exchange-success',
    'canonical-exchange-failed',
  ];
  const passkeySurfaces = [
    'absent',
    'prompt',
    'pending',
    'waiting-for-phone',
    'verification',
    'error',
    'present',
  ];
  const passkeySurface = () => {
    if (!document.querySelector('[data-testid="shortcake_passkey_screen"]'))
      return 'absent';
    if (
      document.querySelector('[data-testid="shortcake_passkey_error_message"]')
    )
      return 'error';
    if (document.querySelector('[data-testid="shortcake_code_matching_card"]'))
      return 'verification';
    if (
      document.querySelector('[data-testid="shortcake_waiting_for_phone_card"]')
    )
      return 'waiting-for-phone';
    if (
      document.querySelector(
        '[data-testid="shortcake_passkey_continue_button"]:disabled',
      )
    )
      return 'pending';
    if (document.querySelector('[data-testid="shortcake_passkey_prompt_card"]'))
      return 'prompt';
    return 'present';
  };
  const registrationKeys = [
    'web.pair.success',
    'web.app.canonical.registration.start',
    'web.app.canonical.registration.missing_jid',
    'web.app.canonical.registration.missing_metadata',
    'web.app.canonical.registration.nonce_decryption_failed',
    'web.app.canonical.registration.nonce_parse_failed',
    'web.app.canonical.registration.success',
    'web.app.canonical.registration.nonce_exchange_failed',
    'web.app.canonical.registration.unexpected_error',
    'web.app.canonical.exchange.attempt',
    'web.app.canonical.exchange.success',
    'web.app.canonical.exchange.failed',
  ];
  const started = Date.now();
  const record = (event: string, value?: unknown) => {
    let candidate = value;
    let payloadKind: string | null = null;
    if (event === 'socket-disconnected') {
      payloadKind =
        value === null
          ? 'null'
          : ['undefined', 'string', 'number', 'boolean', 'object'].includes(
                typeof value,
              )
            ? typeof value
            : 'other';
      if (value && typeof value === 'object') {
        // Read a data property only; never call arbitrary reason getters.
        try {
          candidate = Object.getOwnPropertyDescriptor(value, 'reason')?.value;
        } catch {
          candidate = undefined;
        }
      }
    }
    const allowed =
      event === 'socket-disconnected'
        ? closeReasons
        : event === 'registration-stage'
          ? registrationStages
          : event === 'passkey-surface'
            ? passkeySurfaces
            : event === 'passkey-error'
              ? errorNames
              : states;
    trace.push({
      at: Math.max(0, Date.now() - started),
      event,
      code:
        typeof candidate === 'string' && allowed.includes(candidate)
          ? candidate
          : null,
      payloadKind,
    });
    if (trace.length > 64) trace.shift();
    try {
      page.ferdium?.pushWhatsAppConnectionEvent?.({
        event,
        code: trace.at(-1)!.code,
        payloadKind,
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
      linkEventsObserved: Boolean(boundLinks),
      registrationEventsObserved: Boolean(boundObserver),
      passkeySurface: passkeySurface(),
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
  let boundObserver: any;
  let boundBus: any;
  let boundLinks: any;
  let checking = false;
  let disposed = false;
  let previousPasskeySurface = 'absent';
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
    const surface = passkeySurface();
    if (surface !== previousPasskeySurface) {
      previousPasskeySurface = surface;
      record('passkey-surface', surface);
    }
    // Observe the already initialized emitter; the WAWebODS wrapper would
    // initialize a lazy module, so it is intentionally never invoked here.
    const observer = module('WAWebODSObserver', true)?.default;
    if (
      observer &&
      observer !== boundObserver &&
      typeof observer.addListener === 'function'
    ) {
      try {
        const subscription = observer.addListener('event', (value: unknown) => {
          try {
            if (!value || typeof value !== 'object') return;
            const key = Object.getOwnPropertyDescriptor(value, 'key')?.value;
            const index =
              typeof key === 'string' ? registrationKeys.indexOf(key) : -1;
            if (index >= 0)
              record('registration-stage', registrationStages[index]);
          } catch {}
        });
        boundObserver = observer;
        bindings.push(() => subscription?.remove?.());
      } catch {}
    }
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
        ['link_device_events:passkey_prologue_request', 'passkey-request'],
        ['link_device_events:shortcake_prologue_sent', 'passkey-prologue-sent'],
        [
          'link_device_events:shortcake_verification_code_ready',
          'passkey-verification-ready',
        ],
        ['link_device_events:shortcake_error', 'passkey-error'],
      ])
        bind(links, event, value => {
          // Verification-ready arguments contain pairing secrets. Never inspect
          // them. For errors retain only a recognized exception class, not its
          // message, challenge, credential, identifier or arbitrary status value.
          let name: unknown;
          if (label === 'passkey-error') {
            try {
              name = typeof value === 'string' ? value : value?.name;
            } catch {}
          }
          record(label, name);
        });
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
        throw new Error('WhatsApp connection event unavailable');
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
      if (left.length > 0) socketListeners.set(fn, left);
      else socketListeners.delete(fn);
      return socketFacade;
    },
    logout() {
      const bus = backend();
      if (typeof bus?.triggerLogout !== 'function')
        throw new Error('WhatsApp logout unavailable');
      return bus.triggerLogout();
    },
    poke() {
      const bus = backend();
      if (typeof bus?.triggerReconnectSocket !== 'function')
        throw new Error('WhatsApp reconnect unavailable');
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
