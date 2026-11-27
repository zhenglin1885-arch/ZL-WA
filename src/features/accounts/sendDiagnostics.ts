/* eslint-disable unicorn/consistent-function-scoping, no-continue -- Serialized read-only guest helper with bounded filtering. */
export function readSendDiagnostics() {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const page = window as any;
  const read = (fn: () => any): any => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const token = (value: any): string | null =>
    typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value) ? value : null;
  const bool = (value: any): boolean | null =>
    typeof value === 'boolean' ? value : null;
  const version = (value: any): string | null =>
    typeof value === 'string' && /^\d+(?:\.\d+){1,5}$/.test(value)
      ? value
      : null;
  const chatReady =
    Boolean(document.querySelector('#pane-side, #side, #main')) &&
    !document.querySelector(
      '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
    );
  const wpp = chatReady ? page.WPP : undefined;
  const stream = read(() => wpp.conn.getStreamData());
  const native = read(() => page.__zlWaNativeConnection.read());
  const socket =
    native?.socket ??
    (chatReady
      ? (read(
          () =>
            page.require('WAWebBackendEventBus')?.BackendEventBus?.socketState,
        ) ?? read(() => page.require('WAWebSocketModel').Socket.state))
      : undefined);
  const nativeStore = chatReady
    ? read(() => page.require('WAWebCollections').Msg)
    : undefined;
  const store = nativeStore || read(() => wpp.whatsapp.MsgStore);
  const models = read(() => store.getModelsArray());
  const outgoing = {
    inspected: 0,
    pending: 0,
    pendingOverTwoMinutes: 0,
    accepted: 0,
    failed: 0,
    ackCodes: {} as Record<string, number>,
  };
  if (Array.isArray(models)) {
    for (const message of models.slice(-200)) {
      const key = read(() => message.id);
      const own = read(
        () =>
          key?.fromMe === true ||
          message.isSentByMe === true ||
          (typeof key === 'string' && key.startsWith('true_')) ||
          (typeof key?._serialized === 'string' &&
            key._serialized.startsWith('true_')),
      );
      if (!own) continue;
      outgoing.inspected += 1;
      const ack = Number(read(() => message.ack ?? message.attributes?.ack));
      if (!Number.isInteger(ack) || ack < -7 || ack > 8) continue;
      outgoing.ackCodes[String(ack)] =
        (outgoing.ackCodes[String(ack)] || 0) + 1;
      if (ack < 0) outgoing.failed += 1;
      else if (ack >= 1) outgoing.accepted += 1;
      else {
        outgoing.pending += 1;
        const timestamp = Number(read(() => message.t));
        const milliseconds = timestamp > 1e12 ? timestamp : timestamp * 1000;
        if (timestamp > 0 && Date.now() - milliseconds > 120_000)
          outgoing.pendingOverTwoMinutes += 1;
      }
    }
  }
  // Only booleans/counts leave the page. Native IDs and customer text stay
  // local, including when a virtual row cannot be matched to a chat model.
  const customer = chatReady ? page.__zlCustomers : undefined;
  const adapter = chatReady ? page.__zlCustomerAdapter : undefined;
  const customerModels = read(() => adapter.models());
  const active = read(() => customer.activeChatId) || '';
  const canonical = (id: string) => customer?.data?.aliases?.[id] || id;
  const rows: HTMLElement[] =
    read(() =>
      [
        ...new Set(
          [
            ...document.querySelectorAll<HTMLElement>(
              '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
            ),
          ].map(row => row.closest<HTMLElement>('[role="row"]') || row),
        ),
      ].slice(0, 100),
    ) || [];
  const resolved = rows.map(row => read(() => customer.resolveRow(row)) || '');
  const activeRow =
    rows.find(
      (_row, i) =>
        active && resolved[i] && canonical(resolved[i]) === canonical(active),
    ) ||
    rows.find(
      row =>
        row.getAttribute('aria-selected') === 'true' ||
        row.querySelector('[aria-selected="true"]'),
    );
  const resolution = read(() => customer.rowIdentity.get(activeRow));
  const renderStage = read(() => customer.rowStatus.get(activeRow));
  const customers = {
    installed: Boolean(customer?.data),
    ownerMatches:
      read(() => adapter.owners().includes(customer.data.owner)) === true,
    models: Array.isArray(customerModels) ? customerModels.length : null,
    loadedRows: rows.length,
    resolvedRows: resolved.filter(Boolean).length,
    rowsWithNotes: rows.filter(row => row.querySelector('.zl-chat-note'))
      .length,
    activeChatKnown: Boolean(active),
    activeModelPresent: Boolean(
      active &&
        Array.isArray(customerModels) &&
        customerModels.some(
          model => canonical(adapter.wid(model.id)) === canonical(active),
        ),
    ),
    activeSummaryPresent: Boolean(
      active && customer?.data?.summaries?.[canonical(active)],
    ),
    activeRowLocated: Boolean(activeRow),
    activeRowResolved: Boolean(
      activeRow &&
        active &&
        resolved[rows.indexOf(activeRow)] &&
        canonical(resolved[rows.indexOf(activeRow)]) === canonical(active),
    ),
    activeResolution: [
      'react-props',
      'native-id',
      'react-fiber',
      'unique-title',
    ].includes(resolution)
      ? resolution
      : null,
    activeRenderStage: [
      'unresolved',
      'missing-title',
      'waiting-layout',
      'rendered',
    ].includes(renderStage)
      ? renderStage
      : null,
    unresolvedRows: resolved.filter(id => !id).length,
    waitingLayoutRows: rows.filter(
      row => read(() => customer.rowStatus.get(row)) === 'waiting-layout',
    ).length,
    missingTitleRows: rows.filter(
      row => read(() => customer.rowStatus.get(row)) === 'missing-title',
    ).length,
    activeTitleContainer: Boolean(
      activeRow?.querySelector('[data-testid="cell-frame-title"]'),
    ),
    activeNotePresent: Boolean(activeRow?.querySelector('.zl-chat-note')),
    activeFlagCount:
      activeRow?.querySelectorAll('.zl-customer-flag').length ?? null,
  };
  const pairing = read(() => page.__zlPairingTrace);
  const eventNames = new Set([
    'observing',
    'login',
    'chat',
    'loading',
    'qr-changed',
    'exception',
    'online',
    'offline',
    'pagehide',
  ]);
  const eventCodes = [
    'CONNECTED',
    'OPENING',
    'PAIRING',
    'UNPAIRED',
    'UNPAIRED_IDLE',
    'CONFLICT',
    'TIMEOUT',
    'PROXYBLOCK',
    'TOS_BLOCK',
    'SMB_TOS_BLOCK',
    'NotAllowedError',
    'ConstraintError',
    'TimeoutError',
    'SecurityError',
    'QuotaExceededError',
    'DataError',
    'OperationError',
    'UnknownError',
    'InvalidStateError',
    'NotSupportedError',
    'TypeError',
    'AbortError',
  ];
  const pairingEvents = Array.isArray(pairing?.events)
    ? pairing.events
        .slice(-64)
        .filter(
          (e: any) =>
            e && eventNames.has(e.event) && Number.isFinite(e.at) && e.at >= 0,
        )
        .map((e: any) => ({
          at: e.at,
          event: e.event,
          code: eventCodes.includes(e.code) ? e.code : null,
        }))
    : [];
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
  return {
    format: 6,
    nativeConnection: {
      source: ['backend-event-bus', 'legacy-socket', 'unavailable'].includes(
        native?.source,
      )
        ? native.source
        : null,
      mainReady: bool(native?.mainReady),
      linkEventsObserved: bool(native?.linkEventsObserved),
      registrationEventsObserved: bool(native?.registrationEventsObserved),
      passkeySurface: passkeySurfaces.includes(native?.passkeySurface)
        ? native.passkeySurface
        : null,
      events: (read(() => page.__zlWaNativeConnection.trace) || [])
        .slice(-64)
        .filter((row: any) =>
          [
            'backend-observed',
            'socket-state',
            'socket-open',
            'main-ready',
            'critical-sync',
            'socket-disconnected',
            'storage-error',
            'logout',
            'phone-link-error',
            'phone-link-hello',
            'phone-link-refresh',
            'passkey-request',
            'passkey-surface',
            'registration-stage',
            'passkey-prologue-sent',
            'passkey-verification-ready',
            'passkey-error',
          ].includes(row?.event),
        )
        .map((row: any) => ({
          at:
            Number.isFinite(row.at) && row.at >= 0
              ? Math.min(row.at, 86_400_000)
              : 0,
          event: row.event,
          payloadKind:
            row.event === 'socket-disconnected' &&
            [
              'undefined',
              'null',
              'string',
              'number',
              'boolean',
              'object',
              'other',
            ].includes(row.payloadKind)
              ? row.payloadKind
              : null,
          code: (row.event === 'socket-disconnected'
            ? closeReasons
            : row.event === 'registration-stage'
              ? registrationStages
              : row.event === 'passkey-surface'
                ? passkeySurfaces
                : row.event === 'passkey-error'
                  ? errorNames
                  : [...eventCodes, 'UNLAUNCHED']
          ).includes(row.code)
            ? row.code
            : null,
        })),
    },
    pairing: {
      observing: Boolean(pairing),
      qrChanges:
        Number.isInteger(pairing?.qrChanges) &&
        pairing.qrChanges >= 0 &&
        pairing.qrChanges <= 10_000
          ? pairing.qrChanges
          : null,
      events: pairingEvents,
    },
    browserContext: {
      secure: bool(read(() => page.isSecureContext)),
      crossOriginIsolated: bool(read(() => page.crossOriginIsolated)),
      cookiesEnabled: bool(read(() => navigator.cookieEnabled)),
      browserBrandInUserAgent: bool(
        read(() => /electron|ferdium|zl-wa/i.test(navigator.userAgent)),
      ),
      indexedDBAvailable: bool(
        read(() => typeof page.indexedDB?.open === 'function'),
      ),
      webCryptoAvailable: bool(read(() => Boolean(page.crypto?.subtle))),
      publicKeyCredentialAvailable: bool(
        read(() => typeof page.PublicKeyCredential === 'function'),
      ),
      credentialsGetAvailable: bool(
        read(() => typeof navigator.credentials?.get === 'function'),
      ),
      serviceWorkerControlled: bool(
        read(() => Boolean(navigator.serviceWorker?.controller)),
      ),
    },
    browserOnline: bool(read(() => navigator.onLine)),
    socket: token(socket),
    sdkReady: bool(read(() => wpp.isReady)),
    sdkVersion: version(read(() => wpp.version)),
    sdkLidCompatibility: bool(
      read(() => {
        const getter = wpp.conn.getMyUserLid;
        if (typeof getter !== 'function') return null;
        const source = Function.prototype.toString.call(getter);
        return (
          !source.includes('getMeLidUserOrThrow') ||
          source.includes('ZL_LID_UNAVAILABLE')
        );
      }),
    ),
    whatsappVersion: version(read(() => page.Debug.VERSION)),
    stream: { mode: token(stream?.mode), info: token(stream?.info) },
    authenticated: bool(read(() => wpp.conn.isAuthenticated())),
    registered: bool(read(() => wpp.conn.isRegistered())),
    mainReady: bool(read(() => wpp.conn.isMainReady())),
    mainLoaded: bool(read(() => wpp.conn.isMainLoaded())),
    messageStoreReadable: Array.isArray(models),
    outgoing,
    customers,
  };
}

// Self-contained surface inspection. Only fixed categories/counts leave the page.
export function readWhatsAppPageHealth() {
  const safe = (read: () => any) => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  const originOf = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'web.whatsapp.com')
        return 'whatsapp-web';
      if (
        url.protocol === 'https:' &&
        ['www.whatsapp.com', 'whatsapp.com'].includes(url.hostname)
      )
        return 'whatsapp-site';
      if (url.protocol === 'chrome-error:') return 'browser-error';
      return 'other';
    } catch {
      return 'unknown';
    }
  };
  const origin = originOf(
    safe(() => globalThis.location.href) ||
      `https://${safe(() => globalThis.location.hostname) || ''}/`,
  );
  const visible = (node: Element) =>
    Boolean(safe(() => node.getClientRects().length)) &&
    safe(() => getComputedStyle(node).visibility) !== 'hidden' &&
    !safe(() => node.closest('[aria-hidden="true"]'));
  const present = (selector: string) =>
    (safe(() =>
      [...document.querySelectorAll(selector)].some(node => visible(node)),
    ) || false) as boolean;
  const fatal = (doc: Document) =>
    (safe(() =>
      [...doc.querySelectorAll('h1,h2,[role="heading"]')].some(
        node =>
          !node.closest(
            '#main,#side,#pane-side,[data-id],.message-in,.message-out,[contenteditable],[data-testid="conversation-panel-messages"]',
          ) &&
          visible(node) &&
          /^sorry,?\s+something went wrong\.?$/i.test(
            (node.textContent || '').trim(),
          ),
      ),
    ) || false) as boolean;
  const chatPresent = present(
    '#side,#pane-side,[data-testid="conversation-panel-messages"],#main footer [contenteditable]',
  );
  const composerPresent = present(
    '[contenteditable]:not([contenteditable="false"])',
  );
  const loginPresent = present(
    '[data-ref] canvas,[data-testid="qrcode"],[data-testid="link-device-phone-number-code-screen"]',
  );
  const fatalHeading = Boolean(safe(() => fatal(document)));
  let coveringFrames = 0;
  let errorFrames = 0;
  let unreadableFrames = 0;
  for (const frame of (safe(() =>
    [...document.querySelectorAll<HTMLIFrameElement>('iframe')].slice(0, 16),
  ) || []) as HTMLIFrameElement[]) {
    if (!visible(frame)) continue;
    const bounds = frame.getBoundingClientRect();
    if (
      bounds.width * bounds.height <
      window.innerWidth * window.innerHeight * 0.5
    )
      continue;
    coveringFrames += 1;
    const content = safe(() => frame.contentDocument);
    if (!content) unreadableFrames += 1;
    else if (fatal(content)) errorFrames += 1;
  }
  const state =
    origin === 'whatsapp-web'
      ? fatalHeading
        ? chatPresent || composerPresent
          ? 'error-overlay'
          : 'error-document'
        : errorFrames > 0
          ? 'error-frame'
          : unreadableFrames > 0
            ? 'covered-frame'
            : chatPresent
              ? 'chat'
              : loginPresent
                ? 'login'
                : 'loading'
      : 'unexpected-origin';
  const navigationStart = safe(() => performance.timeOrigin);
  return {
    state,
    origin,
    documentState: safe(() => document.readyState) || null,
    navigationStart: Number.isFinite(navigationStart) ? navigationStart : null,
    chatPresent,
    composerPresent,
    loginPresent,
    fatalHeading,
    coveringFrames,
    errorFrames,
    unreadableFrames,
    recoveryRecommended:
      !chatPresent &&
      !composerPresent &&
      !loginPresent &&
      coveringFrames === 0 &&
      (state === 'error-document' ||
        (state === 'unexpected-origin' && origin === 'whatsapp-site')),
  };
}
