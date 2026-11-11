jest.mock('electron', () => ({ dialog: { showMessageBox: jest.fn() } }));
const { dialog } = jest.requireMock('electron');
const { showMainStartupFailure } = jest.requireActual<
  typeof import('../src/electron/startupFailure')
>('../src/electron/startupFailure');
beforeEach(() => jest.clearAllMocks());

it('offers native diagnostics before exiting an invalid account configuration without exposing private error text', async () => {
  const window: any = { show: jest.fn() };
  let finishExport!: () => void;
  const hooks = {
    record: jest.fn(),
    exportDiagnostics: jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishExport = resolve;
        }),
    ),
    quit: jest.fn(),
  };
  dialog.showMessageBox.mockResolvedValue({ response: 0 });
  const result = showMainStartupFailure(
    window,
    new Error('账号工具配置损坏，请备份并检查 account-tools.json'),
    hooks,
  );
  await Promise.resolve();
  expect(window.show).toHaveBeenCalledTimes(1);
  expect(hooks.record).toHaveBeenCalledWith({
    event: 'main-initialization-failed',
    reason: 'ACCOUNT_TOOLS_CONFIG_INVALID',
  });
  expect(hooks.exportDiagnostics).toHaveBeenCalledTimes(1);
  expect(hooks.quit).not.toHaveBeenCalled();
  finishExport();
  await result;
  expect(hooks.quit).toHaveBeenCalledTimes(1);
});
it('does not export without a user request and never embeds arbitrary exception details', async () => {
  const hooks = {
    record: jest.fn(),
    exportDiagnostics: jest.fn(),
    quit: jest.fn(),
  };
  dialog.showMessageBox.mockResolvedValue({ response: 1 });
  await showMainStartupFailure(
    { show: jest.fn() } as any,
    new Error('private proxy password and profile'),
    hooks,
  );
  expect(hooks.exportDiagnostics).not.toHaveBeenCalled();
  expect(
    JSON.stringify([hooks.record.mock.calls, dialog.showMessageBox.mock.calls]),
  ).not.toContain('private proxy');
  expect(hooks.quit).toHaveBeenCalledTimes(1);
});
it('still exits safely if a native dialog or diagnostic export fails', async () => {
  const hooks = {
    record: jest.fn(),
    exportDiagnostics: jest.fn(),
    quit: jest.fn(),
  };
  dialog.showMessageBox.mockRejectedValue(new Error('dialog unavailable'));
  await expect(
    showMainStartupFailure({ show: jest.fn() } as any, null, hooks),
  ).rejects.toThrow('dialog unavailable');
  expect(hooks.quit).toHaveBeenCalledTimes(1);
});
