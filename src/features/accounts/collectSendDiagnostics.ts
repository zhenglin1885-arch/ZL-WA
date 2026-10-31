import { readSendDiagnostics } from './sendDiagnostics';

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
    webview?: { executeJavaScript: (source: string) => Promise<unknown> };
  },
  readProxy: () => Promise<unknown>,
) {
  const view = service.webview;
  const [proxy, connection] = await Promise.all([
    bounded(readProxy, { unavailable: true }),
    view && !service.isError
      ? bounded(
          () => view.executeJavaScript(`(${readSendDiagnostics.toString()})()`),
          { unavailable: true, reason: 'guest-execution-failed-or-timed-out' },
        )
      : Promise.resolve({ unavailable: true, reason: 'page-not-loaded' }),
  ]);
  return {
    proxy,
    page: {
      present: Boolean(view),
      loadFailed: service.isError,
      errorCode: service.isError
        ? /\bERR_[A-Z_]+\b/.exec(service.errorMessage || '')?.[0] || null
        : null,
      changedDuringRead: service.webview !== view,
    },
    connection:
      service.webview === view
        ? connection
        : { unavailable: true, reason: 'page-changed' },
  };
}
