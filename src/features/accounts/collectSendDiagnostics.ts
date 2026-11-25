import { readSendDiagnostics, readWhatsAppPageHealth } from './sendDiagnostics';

const transitions = new WeakMap<object, { at: number; event: string }[]>();
const nativeTransitions = new WeakMap<
  object,
  { at: number; event: string; code: string | null }[]
>();
export function recordNativeConnection(view: object, value: any) {
  const allowed = [
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
    'passkey-prologue-sent',
    'passkey-verification-ready',
    'passkey-error',
  ];
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
  if (!value || !allowed.includes(value.event)) return;
  const rows = nativeTransitions.get(view) || [];
  rows.push({
    at: Date.now(),
    event: value.event,
    code: (value.event === 'socket-disconnected'
      ? closeReasons
      : value.event === 'passkey-error'
        ? errorNames
        : states
    ).includes(value.code)
      ? value.code
      : null,
  });
  if (rows.length > 64) rows.shift();
  nativeTransitions.set(view, rows);
}

export function recordPageTransition(
  view: object,
  event:
    | 'loading-started'
    | 'main-frame-navigated'
    | 'page-navigation-requested'
    | 'server-redirect'
    | 'host-reload-requested'
    | 'startup-recovery-requested',
) {
  const events = transitions.get(view) || [];
  events.push({ at: Date.now(), event });
  if (events.length > 32) events.shift();
  transitions.set(view, events);
}

// Host diagnostics must survive error documents, a hung guest, and a missing SDK.
// Never copy raw exception messages: Chromium errors can contain addresses/URLs.
async function bounded<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), 4000);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectSendDiagnostics(
  service: {
    isError: boolean;
    errorMessage: string;
    webview?: {
      executeJavaScript: (source: string) => Promise<unknown>;
      getURL?: () => string;
    };
  },
  readProxy: () => Promise<unknown>,
  sameAccount: () => boolean = () => true,
) {
  const view = service.webview;
  const url = () => {
    try {
      return view?.getURL?.();
    } catch {
      return null;
    }
  };
  const startedUrl = url();
  const [proxy, connection] = await Promise.all([
    bounded(readProxy, { unavailable: true }),
    view && !service.isError
      ? bounded(
          () =>
            view.executeJavaScript(
              `(()=>{const surface=(${readWhatsAppPageHealth.toString()})();if(['unexpected-origin','error-document','error-overlay','error-frame','covered-frame'].includes(surface.state))return {unavailable:true,reason:surface.state,surface};return {...(${readSendDiagnostics.toString()})(),surface};})()`,
            ),
          { unavailable: true, reason: 'guest-execution-failed-or-timed-out' },
        )
      : Promise.resolve({ unavailable: true, reason: 'page-not-loaded' }),
  ]);
  const sampled = connection as {
    surface?: ReturnType<typeof readWhatsAppPageHealth>;
  };
  const verified =
    sampled?.surface && service.webview === view && view
      ? ((await bounded(
          () =>
            view.executeJavaScript(`(${readWhatsAppPageHealth.toString()})()`),
          null,
        )) as ReturnType<typeof readWhatsAppPageHealth> | null)
      : null;
  const endedUrl = url();
  const verificationFailed = Boolean(sampled?.surface && !verified);
  const accountChanged = !sameAccount();
  const changed =
    service.webview !== view ||
    Boolean(startedUrl && endedUrl && startedUrl !== endedUrl) ||
    Boolean(
      sampled?.surface &&
        verified &&
        (sampled.surface.navigationStart !== verified.navigationStart ||
          sampled.surface.origin !== verified.origin),
    );
  const surface = verified || sampled?.surface;
  const contentFailed = Boolean(
    surface &&
      [
        'unexpected-origin',
        'error-document',
        'error-overlay',
        'error-frame',
      ].includes(surface.state),
  );
  return {
    sampledAt: new Date().toISOString(),
    proxy: accountChanged
      ? { unavailable: true, reason: 'account-changed' }
      : proxy,
    page: {
      present: Boolean(view),
      transitions:
        !accountChanged && !changed && view
          ? [...(transitions.get(view) || [])]
          : [],
      nativeTransitions:
        !accountChanged && !changed && view
          ? [...(nativeTransitions.get(view) || [])]
          : [],
      loadFailed: service.isError,
      errorCode: service.isError
        ? /\bERR_[A-Z_]+\b/.exec(service.errorMessage || '')?.[0] || null
        : null,
      changedDuringRead: changed,
      accountChanged,
      verificationFailed,
      contentFailed,
      surface: surface || null,
      recoveryRecommended:
        !changed &&
        !accountChanged &&
        !verificationFailed &&
        Boolean(surface?.recoveryRecommended),
    },
    connection: accountChanged
      ? { unavailable: true, reason: 'account-changed' }
      : changed
        ? { unavailable: true, reason: 'page-changed' }
        : verificationFailed
          ? { unavailable: true, reason: 'page-verification-failed' }
          : contentFailed || surface?.state === 'covered-frame'
            ? { unavailable: true, reason: surface!.state }
            : connection,
  };
}
