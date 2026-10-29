import vm from 'node:vm';
import { readSendDiagnostics } from '../src/features/accounts/sendDiagnostics';

const run = (page: any, document?: any) =>
  JSON.parse(
    JSON.stringify(
      vm.runInNewContext(`(${readSendDiagnostics.toString()})()`, {
        window: page,
        location: { hostname: 'web.whatsapp.com' },
        navigator: { onLine: true },
        document,
      }),
    ),
  );

it('reports original customer row recognition without copying saved customer text or IDs', () => {
  const id = '10002@c.us';
  const row: any = {
    closest: () => row,
    querySelector: () => ({}),
    querySelectorAll: () => [{}],
  };
  const result = run(
    {
      __zlCustomerAdapter: {
        models: () => [{ id }],
        owners: () => ['private-owner'],
        wid: (value: string) => value,
      },
      __zlCustomers: {
        activeChatId: id,
        data: {
          owner: 'private-owner',
          aliases: {},
          summaries: { [id]: { remarkName: 'private-note' } },
        },
        resolveRow: () => id,
      },
    },
    { querySelectorAll: () => [row] },
  );
  expect(result.customers).toMatchObject({
    installed: true,
    ownerMatches: true,
    loadedRows: 1,
    resolvedRows: 1,
    activeModelPresent: true,
    activeSummaryPresent: true,
    activeRowLocated: true,
    activeNotePresent: true,
    activeFlagCount: 1,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-owner|private-note|10002@c.us/,
  );
});

it('reads live session readiness and bounded outgoing ACK counts without reading message content or mutating the session', () => {
  const mutate = jest.fn(() => {
    throw new Error('Read only');
  });
  const models = [
    {
      id: { fromMe: true },
      ack: -1,
      body: 'private text',
      to: 'secret-number',
    },
    { id: 'true_secret-chat_PENDING', ack: 0, t: Date.now() / 1000 - 180 },
    { id: { fromMe: true }, ack: 2 },
    { id: { fromMe: false }, ack: -1 },
  ];
  Object.defineProperty(models[2], 'body', {
    get: () => {
      throw new Error('Never read body');
    },
  });
  const page = {
    Debug: { VERSION: '2.3000.1' },
    WPP: {
      isReady: true,
      version: '4.7.1',
      conn: {
        getStreamData: () => ({ mode: 'MAIN', info: 'SYNCING' }),
        isAuthenticated: () => true,
        isRegistered: () => true,
        isMainReady: () => false,
        isMainLoaded: () => true,
      },
      chat: { sendTextMessage: mutate, logout: mutate },
    },
    require: (name: string) =>
      name === 'WAWebSocketModel'
        ? { Socket: { state: 'CONNECTED' } }
        : { Msg: { getModelsArray: () => models } },
  };
  const result = run(page);
  expect(result).toMatchObject({
    socket: 'CONNECTED',
    mainReady: false,
    stream: { mode: 'MAIN', info: 'SYNCING' },
    outgoing: {
      inspected: 3,
      failed: 1,
      pending: 1,
      pendingOverTwoMinutes: 1,
      accepted: 1,
      ackCodes: { '-1': 1, '0': 1, '2': 1 },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private text|secret-number|secret-chat/,
  );
  expect(mutate).not.toHaveBeenCalled();
});

it('reports unavailable modules as unknown without injecting or loading a library', () => {
  const result = run({
    require: () => {
      throw new Error('not ready');
    },
  });
  expect(result).toMatchObject({
    socket: null,
    sdkReady: null,
    mainReady: null,
    messageStoreReadable: false,
    outgoing: { inspected: 0 },
  });
});

it('caps message inspection and does not copy unexpected version strings or stream details', () => {
  const result = run({
    Debug: { VERSION: 'private text' },
    WPP: {
      version: 'private URL',
      conn: {
        getStreamData: () => ({
          mode: 'https://private.example',
          info: 'private-number',
        }),
      },
    },
    require: () => ({
      Msg: {
        getModelsArray: () =>
          Array.from({ length: 500 }, () => ({ id: { fromMe: true }, ack: 1 })),
      },
    }),
  });
  expect(result.outgoing.inspected).toBe(200);
  expect(result).toMatchObject({
    sdkVersion: null,
    whatsappVersion: null,
    stream: { mode: null, info: null },
  });
});
