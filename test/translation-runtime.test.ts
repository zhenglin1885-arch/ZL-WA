jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  getBulkQueue: () => ({ start: jest.fn(), dispose: jest.fn() }),
}));
const { ipcRenderer } = jest.requireMock('electron');
const { startTranslations } = jest.requireActual<
  typeof import('../src/features/accountTools/runtime')
>('../src/features/accountTools/runtime');
const { defaultTools } = jest.requireActual<
  typeof import('../src/features/accountTools/config')
>('../src/features/accountTools/config');

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
it('cleans the guest request when its host runtime unmounts and never delivers a late success into the next runtime', async () => {
  let finish!: (value: unknown) => void;
  const config = defaultTools();
  config.translation.incoming = true;
  ipcRenderer.invoke.mockImplementation((name: string) =>
    name === 'account-tools-get'
      ? Promise.resolve(config)
      : new Promise(resolve => {
          finish = resolve;
        }),
  );
  const job = {
    id: 42,
    token: 'old-runtime-token',
    text: 'original',
    direction: 'incoming',
  };
  const view = {
    executeJavaScript: jest
      .fn()
      .mockResolvedValueOnce([job])
      .mockResolvedValue(false),
  };
  const service = {
    id: 'account-runtime',
    recipe: { id: 'whatsapp' },
    webview: view,
    isHibernating: false,
    isLoading: false,
  };
  const stores: any = {
    services: { all: [service], active: service },
    settings: { app: {} },
  };
  const stop = startTranslations(stores);
  await jest.advanceTimersByTimeAsync(400);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(
    'account-tools-translate',
    'account-runtime',
    'original',
    'incoming',
    false,
    undefined,
    false,
  );
  stop();
  await jest.advanceTimersByTimeAsync(0);
  expect(view.executeJavaScript).toHaveBeenCalledTimes(2);
  const cancellation = view.executeJavaScript.mock.calls[1][0];
  expect(cancellation).toContain('old-runtime-token');
  expect(cancellation).toContain('翻译任务已取消');
  finish({ text: 'late result', error: false });
  await jest.advanceTimersByTimeAsync(0);
  expect(view.executeJavaScript).toHaveBeenCalledTimes(2);
});
it('cancels requests drained after unmount instead of submitting invisible new translations', async () => {
  ipcRenderer.invoke.mockResolvedValue(defaultTools());
  let release!: (value: unknown) => void;
  const view = {
    executeJavaScript: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          }),
      )
      .mockResolvedValue(false),
  };
  const service = {
    id: 'late-drain',
    recipe: { id: 'whatsapp' },
    webview: view,
    isHibernating: false,
    isLoading: false,
  };
  const stop = startTranslations({
    services: { all: [service], active: service },
    settings: { app: {} },
  } as any);
  await jest.advanceTimersByTimeAsync(400);
  stop();
  release([
    { id: 99, token: 'late-drain-token', text: 'late', direction: 'incoming' },
  ]);
  await jest.advanceTimersByTimeAsync(0);
  expect(
    ipcRenderer.invoke.mock.calls.filter(
      ([name]: [string]) => name === 'account-tools-translate',
    ),
  ).toHaveLength(0);
  expect(view.executeJavaScript).toHaveBeenCalledTimes(2);
  expect(view.executeJavaScript.mock.calls[1][0]).toContain('翻译任务已取消');
});
it('stops before native draft insertion if the runtime unmounts during outgoing preparation', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => null, activeElement: null },
  });
  let stop: (() => void) | undefined;
  try {
    ipcRenderer.invoke.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'account-tools-get'
          ? defaultTools()
          : { text: 'translated', error: false },
      ),
    );
    let finishPreparation!: (value: boolean) => void;
    const view = {
      focus: jest.fn(),
      sendInputEvent: jest.fn(),
      insertText: jest.fn(),
      executeJavaScript: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 7,
            token: 'outgoing-token',
            text: 'original',
            direction: 'outgoing',
          },
        ])
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              finishPreparation = resolve;
            }),
        )
        .mockResolvedValue(false),
    };
    const service = {
      id: 'outgoing-prepare',
      recipe: { id: 'whatsapp' },
      webview: view,
      isHibernating: false,
      isLoading: false,
    };
    stop = startTranslations({
      services: { all: [service], active: service },
      settings: { app: {} },
    } as any);
    await jest.advanceTimersByTimeAsync(400);
    stop();
    finishPreparation(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(view.sendInputEvent).not.toHaveBeenCalled();
    expect(view.insertText).not.toHaveBeenCalled();
    expect(view.executeJavaScript.mock.calls.at(-1)?.[0]).toContain(
      '翻译任务已取消',
    );
  } finally {
    stop?.();
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

it.each([false, true])(
  'restores a cache batch without submitting a translation even when lookup fails=%s',
  async failure => {
    const config = defaultTools();
    config.translation.incoming = true;
    const batch = {
      token: 'cache-document',
      signature: 'language',
      chat: 'chat',
      items: [{ key: 'key', text: 'original' }],
    };
    ipcRenderer.invoke.mockImplementation((name: string) => {
      if (name === 'account-tools-get') return Promise.resolve(config);
      if (name === 'account-tools-translation-cache')
        return failure
          ? Promise.reject(new Error('cache unavailable'))
          : Promise.resolve([{ key: 'key', text: 'cached translation' }]);
      throw new Error('Unexpected provider call');
    });
    const view = {
      executeJavaScript: jest
        .fn()
        .mockResolvedValueOnce({ jobs: [], cache: batch })
        .mockResolvedValue(true),
    };
    const service = {
      id: 'cache-account',
      recipe: { id: 'whatsapp' },
      webview: view,
      isHibernating: false,
      isLoading: false,
    };
    const stop = startTranslations({
      services: { all: [service], active: service },
      settings: { app: {} },
    } as any);
    await jest.advanceTimersByTimeAsync(400);
    stop();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'account-tools-translation-cache',
      'cache-account',
      batch,
    );
    expect(
      ipcRenderer.invoke.mock.calls.some(
        ([name]: [string]) => name === 'account-tools-translate',
      ),
    ).toBe(false);
    expect(view.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(
      view.executeJavaScript.mock.calls[1]?.[0].includes(
        'cached translation',
      ) ?? false,
    ).toBe(!failure);
  },
);
