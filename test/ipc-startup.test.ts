const modules = [
  'settings',
  'appIndicator',
  'accountTools',
  'customers',
  'sessionStorage',
  'autoUpdate',
  'clipboard',
  'download',
  'processManager',
  'localServer',
  'localDiagnostics',
  'chatBackup',
  'cacheLocation',
  'languageDetect',
  'dnd',
  'focusState',
];
for (const name of modules)
  jest.doMock(`../src/electron/ipc-api/${name}`, () => jest.fn());

const initialize = jest.requireActual<typeof import('../src/electron/ipc-api')>(
  '../src/electron/ipc-api',
).default;
const indicator = jest.requireMock('../src/electron/ipc-api/appIndicator');
const accountTools = jest.requireMock('../src/electron/ipc-api/accountTools');
beforeEach(() => jest.resetAllMocks());

it('creates native tray controls before a failing account configuration can prevent renderer startup', () => {
  accountTools.mockImplementation(() => {
    expect(indicator).toHaveBeenCalledTimes(1);
    throw new Error('account configuration could not be read');
  });
  expect(() => initialize({} as any)).toThrow(
    'account configuration could not be read',
  );
  expect(indicator).toHaveBeenCalledTimes(1);
  expect(
    jest.requireMock('../src/electron/ipc-api/customers'),
  ).not.toHaveBeenCalled();
});
it('initializes all existing IPC functions once on a normal startup', () => {
  initialize({} as any);
  for (const name of modules)
    expect(
      jest.requireMock(`../src/electron/ipc-api/${name}`),
    ).toHaveBeenCalledTimes(1);
});
