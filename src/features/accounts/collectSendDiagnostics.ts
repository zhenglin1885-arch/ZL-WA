import { readSendDiagnostics, readWhatsAppPageHealth } from './sendDiagnostics';

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
