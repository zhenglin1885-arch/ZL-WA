/* Read-only pairing observations. Never read QR contents, identifiers or message text. */
export function configurePairingDiagnostics(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (page.__zlPairingTrace) return true;
  const started = Date.now();
  const state = {
    events: [] as { at: number; event: string; code: string | null }[],
    qrChanges: 0,
  };
  page.__zlPairingTrace = state;
  const record = (event: string, code: string | null = null) => {
    state.events.push({ at: Math.max(0, Date.now() - started), event, code });
    if (state.events.length > 64) state.events.shift();
  };
  const failure = (error: any) => {
    const names = [
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
    if (names.includes(error?.name)) record('exception', error.name);
  };
  let previous = '';
  const sample = () => {
    const login = Boolean(
      document.querySelector(
        '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
      ),
    );
    const chat = Boolean(document.querySelector('#pane-side, #side'));
    let socket: string | undefined;
    try {
      if (chat && !login)
        socket = page.require?.('WAWebSocketModel')?.Socket?.state;
    } catch {
      /* Native login modules may be unavailable. */
    }
    const allowed = [
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
    ];
    const status = chat ? 'chat' : login ? 'login' : 'loading';
    const code = allowed.includes(socket || '') ? socket! : null;
    const key = `${status}:${code}`;
    if (key !== previous) {
      previous = key;
      record(status, code);
    }
    if (chat) {
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    }
  };
  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      if (
        change.type === 'attributes' &&
        change.attributeName === 'data-ref' &&
        (change.target as Element).querySelector?.('canvas')
      ) {
        state.qrChanges = Math.min(state.qrChanges + 1, 10000);
        record('qr-changed');
      }
    }
    sample();
  });
  if (document.documentElement)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-ref'],
    });
  const error = (event: ErrorEvent) => failure(event.error);
  const rejection = (event: PromiseRejectionEvent) => failure(event.reason);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  const online = () => record(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online', online);
  window.addEventListener('offline', online);
  // Bound the polling budget. DOM observations remain available after five minutes.
  const timer = setInterval(() => {
    if (Date.now() - started > 300000) clearInterval(timer);
    else if (document.visibilityState !== 'hidden') sample();
  }, 500);
  window.addEventListener(
    'pagehide',
    () => {
      record('pagehide');
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    },
    { once: true },
  );
  record('observing');
  sample();
  return true;
}
