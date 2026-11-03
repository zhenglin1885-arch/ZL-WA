import { collectSendDiagnostics } from '../src/features/accounts/collectSendDiagnostics';

it('copies host failure details without executing an unreachable WhatsApp page or leaking provider text', async () => {
  const executeJavaScript = jest.fn();
  const result = await collectSendDiagnostics(
    {
      isError: true,
      errorMessage: 'ERR_SOCKS_CONNECTION_FAILED secret-host:1234 password',
      webview: { executeJavaScript },
    },
    async () => ({ protocol: 'socks5', route: 'PROXY' }),
  );
  expect(executeJavaScript).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    page: { errorCode: 'ERR_SOCKS_CONNECTION_FAILED', loadFailed: true },
    connection: { unavailable: true, reason: 'page-not-loaded' },
    proxy: { route: 'PROXY' },
  });
  expect(JSON.stringify(result)).not.toMatch(/secret-host|password/);
});

it('retains host diagnostics when guest execution rejects', async () => {
  const result = await collectSendDiagnostics(
    {
      isError: false,
      errorMessage: '',
      webview: {
        executeJavaScript: async () => {
          throw new Error('private-provider');
        },
      },
    },
    async () => ({ enabled: true }),
  );
  expect(result.proxy).toEqual({ enabled: true });
  expect(result.connection).toMatchObject({ unavailable: true });
  expect(JSON.stringify(result)).not.toContain('private-provider');
});

it('bounds hung guest and host operations and clears deadline timers', async () => {
  jest.useFakeTimers();
  try {
    const pending = collectSendDiagnostics(
      {
        isError: false,
        errorMessage: '',
        webview: {
          executeJavaScript: () => new Promise(() => {}),
        },
      },
      () => new Promise(() => {}),
    );
    await jest.advanceTimersByTimeAsync(4000);
    const result = await pending;
    expect(result.connection).toMatchObject({ unavailable: true });
    expect(result.proxy).toEqual({ unavailable: true });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('does not attribute a replaced page snapshot to the current session', async () => {
  const service = {
    isError: false,
    errorMessage: '',
    webview: {
      executeJavaScript: async () => ({ sdkReady: true }),
    },
  };
  const pending = collectSendDiagnostics(service, async () => ({}));
  service.webview = { executeJavaScript: async () => ({ sdkReady: false }) };
  const result = await pending;
  expect(result.connection).toEqual({
    unavailable: true,
    reason: 'page-changed',
  });
});

it('does not report an old load error as the current page failure after recovery', async () => {
  const result = await collectSendDiagnostics(
    {
      isError: false,
      errorMessage: 'ERR_TIMED_OUT',
      webview: { executeJavaScript: async () => ({ sdkReady: true }) },
    },
    async () => ({}),
  );
  expect(result.page).toMatchObject({ loadFailed: false, errorCode: null });
  expect(result.connection).toEqual({ sdkReady: true });
});

it('identifies an application error page independently of successful network loading and ignores stale SDK success', async () => {
  const surface = {
    state: 'error-document',
    origin: 'whatsapp-web',
    navigationStart: 10,
    recoveryRecommended: true,
  };
  const view = {
    executeJavaScript: jest
      .fn()
      .mockResolvedValueOnce({
        unavailable: true,
        reason: 'error-document',
        surface,
      })
      .mockResolvedValueOnce(surface),
  };
  const result = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
  );
  expect(result.page).toMatchObject({
    loadFailed: false,
    contentFailed: true,
    recoveryRecommended: true,
    changedDuringRead: false,
  });
  expect(result.connection).toEqual({
    unavailable: true,
    reason: 'error-document',
  });
  expect(result.sampledAt).toMatch(/^\d{4}-/);
});
it('does not attribute a previous document to the same webview after navigation during proxy diagnostics', async () => {
  const surface = {
    state: 'chat',
    origin: 'whatsapp-web',
    navigationStart: 10,
  };
  const view = {
    executeJavaScript: jest
      .fn()
      .mockResolvedValueOnce({ socket: 'CONNECTED', surface })
      .mockResolvedValueOnce({ ...surface, navigationStart: 20 }),
  };
  const result = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
  );
  expect(result.page.changedDuringRead).toBe(true);
  expect(result.connection).toEqual({
    unavailable: true,
    reason: 'page-changed',
  });
});
it('does not copy a diagnostic for a different account selected while the request was running', async () => {
  const result = await collectSendDiagnostics(
    {
      isError: false,
      errorMessage: '',
      webview: { executeJavaScript: async () => ({ socket: 'CONNECTED' }) },
    },
    async () => ({ route: 'PROXY' }),
    () => false,
  );
  expect(result.connection).toEqual({
    unavailable: true,
    reason: 'account-changed',
  });
  expect(result.proxy).toEqual({
    unavailable: true,
    reason: 'account-changed',
  });
});

it('does not keep a healthy SDK report when the final page verification fails', async () => {
  const view = {
    executeJavaScript: jest
      .fn()
      .mockResolvedValueOnce({
        socket: 'CONNECTED',
        surface: { state: 'chat', navigationStart: 1, origin: 'whatsapp-web' },
      })
      .mockRejectedValueOnce(new Error('private')),
  };
  const result = await collectSendDiagnostics(
    { isError: false, errorMessage: '', webview: view },
    async () => ({}),
  );
  expect(result.connection).toEqual({
    unavailable: true,
    reason: 'page-verification-failed',
  });
  expect(result.page.recoveryRecommended).toBe(false);
});
