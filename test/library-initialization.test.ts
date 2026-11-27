jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
const { ensureBulkLibrary } = jest.requireActual<
  typeof import('../src/features/accountTools/bulkRuntime')
>('../src/features/accountTools/bulkRuntime');

it('expires a hung page initialization and permits a fresh attempt without late injection', async () => {
  jest.useFakeTimers();
  try {
    let resolveOld!: (value: boolean) => void;
    const view: any = {
      executeJavaScript: jest.fn(
        () =>
          new Promise(resolve => {
            resolveOld = resolve;
          }),
      ),
    };
    const old = ensureBulkLibrary(view).catch(error => error);
    await jest.advanceTimersByTimeAsync(25_000);
    await expect(old).resolves.toMatchObject({
      message: expect.stringContaining('超时'),
    });
    view.executeJavaScript.mockImplementation(
      async (code: string) => !code.includes('location.hostname'),
    );
    await ensureBulkLibrary(view);
    const calls = view.executeJavaScript.mock.calls.length;
    resolveOld(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.executeJavaScript).toHaveBeenCalledTimes(calls);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('retries a failed embedded library read instead of permanently caching its rejection', async () => {
  const { ipcRenderer } = jest.requireMock('electron');
  ipcRenderer.invoke
    .mockRejectedValueOnce(new Error('temporary read failure'))
    .mockResolvedValueOnce('fixture-library');
  const view: any = {
    executeJavaScript: jest.fn(
      async (code: string) =>
        code.startsWith('new Promise') || code.includes('ZL_LID_UNAVAILABLE'),
    ),
  };
  await expect(ensureBulkLibrary(view)).rejects.toThrow(
    'temporary read failure',
  );
  await ensureBulkLibrary(view);
  expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
  expect(view.executeJavaScript).toHaveBeenCalledWith('fixture-library');
});

it('replaces an existing legacy SDK before using a group interface', async () => {
  jest.resetModules();
  const { runInNewContext } = require('node:vm');
  const { ipcRenderer } = require('electron');
  const { ensureBulkLibrary: initialize } = jest.requireActual<
    typeof import('../src/features/accountTools/bulkRuntime')
  >('../src/features/accountTools/bulkRuntime');
  const page: any = {
    WPP: {
      isReady: true,
      conn: {
        getMyUserLid: new Function('return n.UserPrefs.getMeLidUserOrThrow()'),
      },
    },
  };
  const script =
    "window.WPP={isReady:true,conn:{getMyUserLid:function(){throw Object.assign(new Error('unavailable'),{code:'ZL_LID_UNAVAILABLE'});}}};window.injected=(window.injected||0)+1";
  (ipcRenderer.invoke as jest.Mock).mockResolvedValue(script);
  const view: any = {
    executeJavaScript: jest.fn(async (code: string) =>
      runInNewContext(code, {
        window: Object.assign(page, { addEventListener: jest.fn() }),
        document: { querySelector: () => null },
        setInterval: jest.fn(() => 1),
        clearInterval: jest.fn(),
        location: { hostname: 'web.whatsapp.com' },
      }),
    ),
  };
  await Promise.all([initialize(view), initialize(view)]);
  expect(page.injected).toBe(1);
  expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  await initialize(view);
  expect(page.injected).toBe(1);
});

it('blocks a still-incompatible SDK after injection instead of exposing a raw guest exception', async () => {
  jest.resetModules();
  const { runInNewContext } = require('node:vm');
  const { ipcRenderer } = require('electron');
  const { ensureBulkLibrary: initialize } = jest.requireActual<
    typeof import('../src/features/accountTools/bulkRuntime')
  >('../src/features/accountTools/bulkRuntime');
  const page = {
    WPP: {
      isReady: true,
      conn: {
        getMyUserLid: new Function('return n.UserPrefs.getMeLidUserOrThrow()'),
      },
    },
  };
  (ipcRenderer.invoke as jest.Mock).mockResolvedValue('true');
  const view: any = {
    executeJavaScript: jest.fn(async (code: string) =>
      runInNewContext(code, {
        window: Object.assign(page, { addEventListener: jest.fn() }),
        document: { querySelector: () => null },
        setInterval: jest.fn(() => 1),
        clearInterval: jest.fn(),
        location: { hostname: 'web.whatsapp.com' },
      }),
    ),
  };
  await expect(initialize(view)).rejects.toThrow('不兼容的旧接口');
});

it('does not replace the interface while an earlier group request is pending', async () => {
  jest.resetModules();
  const { runInNewContext } = require('node:vm');
  const { ipcRenderer } = require('electron');
  const { ensureBulkLibrary: initialize } = jest.requireActual<
    typeof import('../src/features/accountTools/bulkRuntime')
  >('../src/features/accountTools/bulkRuntime');
  const page = {
    WPP: {
      isReady: true,
      conn: {
        getMyUserLid: new Function('return n.UserPrefs.getMeLidUserOrThrow()'),
      },
    },
    __zlGroupOperations: new Map([['token', { pending: true }]]),
  };
  const view: any = {
    executeJavaScript: jest.fn(async (code: string) =>
      runInNewContext(code, {
        window: Object.assign(page, { addEventListener: jest.fn() }),
        document: { querySelector: () => null },
        setInterval: jest.fn(() => 1),
        clearInterval: jest.fn(),
        location: { hostname: 'web.whatsapp.com' },
      }),
    ),
  };
  await expect(initialize(view)).rejects.toThrow('仍在执行');
  expect(ipcRenderer.invoke).not.toHaveBeenCalled();
});
