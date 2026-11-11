import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AccountToolsFile, {
  AccountToolsFileError,
} from '../src/electron/AccountToolsFile';

jest.mock('electron', () => ({
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
}));
const { dialog } = jest.requireMock('electron');
const { showMainStartupFailure } = jest.requireActual<
  typeof import('../src/electron/startupFailure')
>('../src/electron/startupFailure');
beforeEach(() => jest.resetAllMocks());

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

it('restores only an explicitly selected complete backup and restarts instead of exiting as a failed startup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zl-config-dialog-'));
  try {
    const path = join(directory, 'account-tools.json');
    writeFileSync(path, 'broken');
    const snapshot = {
      accounts: { one: { encryptedPassword: 'encrypted' } },
      history: [],
    };
    writeFileSync(`${path}.bak`, JSON.stringify(snapshot));
    const hooks = {
      record: jest.fn(),
      exportDiagnostics: jest.fn(),
      quit: jest.fn(),
      restart: jest.fn(),
    };
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [`${path}.bak`],
    });
    await showMainStartupFailure(
      { show: jest.fn() } as any,
      new AccountToolsFileError(new AccountToolsFile(path), {
        code: 'JSON',
        bytes: 6,
      }),
      hooks,
    );
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: `${path}.bak` }),
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(snapshot);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
    expect(hooks.quit).not.toHaveBeenCalled();
    expect(hooks.exportDiagnostics).not.toHaveBeenCalled();
    expect(hooks.record).toHaveBeenCalledWith({
      event: 'main-initialization-failed',
      reason: 'ACCOUNT_TOOLS_CONFIG_INVALID',
      configuration: { code: 'JSON', bytes: 6 },
    });
    expect(JSON.stringify(hooks.record.mock.calls)).not.toContain(directory);
    expect(JSON.stringify(hooks.record.mock.calls)).not.toContain('encrypted');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('keeps the original file and does not restart if backup selection is canceled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'zl-config-cancel-'));
  try {
    const path = join(directory, 'account-tools.json');
    writeFileSync(path, 'broken');
    const hooks = {
      record: jest.fn(),
      exportDiagnostics: jest.fn(),
      quit: jest.fn(),
      restart: jest.fn(),
    };
    dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 });
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await showMainStartupFailure(
      { show: jest.fn() } as any,
      new AccountToolsFileError(new AccountToolsFile(path), {
        code: 'JSON',
        bytes: 6,
      }),
      hooks,
    );
    expect(readFileSync(path, 'utf8')).toBe('broken');
    expect(hooks.restart).not.toHaveBeenCalled();
    expect(hooks.quit).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
