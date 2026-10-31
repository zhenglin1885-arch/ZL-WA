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
    executeJavaScript: jest.fn(async (code: string) =>
      code.startsWith('new Promise'),
    ),
  };
  await expect(ensureBulkLibrary(view)).rejects.toThrow(
    'temporary read failure',
  );
  await ensureBulkLibrary(view);
  expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
  expect(view.executeJavaScript).toHaveBeenCalledWith('fixture-library');
});
