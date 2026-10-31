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
