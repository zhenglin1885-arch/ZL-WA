// Exercise profile initialization before any settings or account sessions load.
import { join } from 'node:path';

jest.mock('../src/electron-util', () => ({
  api: {
    app: {
      isPackaged: true,
      getVersion: () => '7.2.3',
      getLocale: () => 'en-US',
      getPath: () => '/profiles',
      setName: jest.fn(),
      setPath: jest.fn(),
    },
  },
}));

describe('ZL-WA environment initialization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ELECTRON_IS_DEV;
    delete process.env.ZL_WA_APPDATA_DIR;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    delete process.env.APPDATA;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sets both settings and session storage to the independent installed profile', () => {
    const { app, protocolClient } = jest.requireActual(
      '../src/environment-remote',
    );
    expect(app.setName).toHaveBeenCalledWith('ZL-WA');
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      join('/profiles', 'ZL-WA'),
    );
    expect(app.setPath).toHaveBeenCalledWith(
      'sessionData',
      join('/profiles', 'ZL-WA'),
    );
    expect(protocolClient).toBe('zl-wa');
  });

  it('renderer imports never overwrite the main process custom session location', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'type');
    Object.defineProperty(process, 'type', {
      configurable: true,
      value: 'renderer',
    });
    try {
      const { app } = jest.requireActual('../src/environment-remote');
      expect(app.setPath).not.toHaveBeenCalledWith(
        'sessionData',
        expect.anything(),
      );
    } finally {
      if (descriptor) Object.defineProperty(process, 'type', descriptor);
      else Reflect.deleteProperty(process, 'type');
    }
  });

  it('isolates development storage and deep links', () => {
    process.env.ELECTRON_IS_DEV = '1';
    const { app, protocolClient } = jest.requireActual(
      '../src/environment-remote',
    );
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      join('/profiles', 'ZL-WADev'),
    );
    expect(protocolClient).toBe('zl-wa-dev');
  });
});
