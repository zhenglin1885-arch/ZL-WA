/* eslint-disable global-require -- Isolated Electron lifecycle mocks. */
describe('verified update installation shutdown', () => {
  let launch: (path: string) => Promise<void>;
  let openPath: jest.Mock;
  let quit: jest.Mock;
  beforeEach(() => {
    jest.resetModules();
    openPath = jest.fn(async () => '');
    quit = jest.fn();
    jest.doMock('../src/electron/GitHubUpdates', () => ({
      __esModule: true,
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Capture the updater lifecycle hook without network/download work.
      default: class {
        constructor(options: { launch: typeof launch }) {
          launch = options.launch;
        }
      },
    }));
    jest.doMock('electron', () => ({
      app: { getVersion: () => '7.3.7', getPath: () => '/tmp', quit },
      net: {},
      shell: { openPath },
      ipcMain: { handle: jest.fn(), on: jest.fn() },
    }));
    require('../src/electron/ipc-api/autoUpdate').default({
      mainWindow: {},
      settings: {},
    });
  });
  afterEach(() => {
    jest.dontMock('electron');
    jest.dontMock('../src/electron/GitHubUpdates');
  });
  it('marks an accepted update exit before quitting, allowing the app to bypass tray/quit confirmation', async () => {
    const { isUpdateShutdown } = require('../src/electron/updateShutdown');
    expect(isUpdateShutdown()).toBe(false);
    quit.mockImplementation(() => expect(isUpdateShutdown()).toBe(true));
    await launch('verified-installer.exe');
    expect(openPath).toHaveBeenCalledWith('verified-installer.exe');
    expect(quit).toHaveBeenCalledTimes(1);
  });
  it('does not quit or suppress normal quit preferences if the installer cannot start', async () => {
    openPath.mockResolvedValue('Windows could not open file');
    await expect(launch('verified-installer.exe')).rejects.toThrow(
      '无法启动安装包',
    );
    expect(quit).not.toHaveBeenCalled();
    expect(require('../src/electron/updateShutdown').isUpdateShutdown()).toBe(
      false,
    );
  });
});
