import vm from 'node:vm';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
const { ipcRenderer } = require('electron');
const { getBulkQueue } = require('../src/features/accountTools/bulkRuntime');

it('sends ordinary zero-delay text through current WhatsApp preparation, without using the raw message shortcut', async () => {
  const send = jest.fn(async () => ({ id: 'true_10001@g.us_CURRENT', ack: 1 }));
  const raw = jest.fn(() => {
    throw new Error('Legacy raw message construction must not execute');
  });
  const page = {
    WPP: {
      isReady: true,
      chat: {
        get: async () => ({
          id: { server: 'g.us', _serialized: '10001@g.us' },
          groupMetadata: undefined,
        }),
        sendTextMessage: send,
      },
    },
    require: (name: string) =>
      name === 'WAWebSocketModel' ? { Socket: { state: 'CONNECTED' } } : raw(),
  };
  const context = vm.createContext({
    window: page,
    location: { hostname: 'web.whatsapp.com' },
    setTimeout,
    clearTimeout,
  });
  const view = {
    executeJavaScript: jest.fn(async (code: string) =>
      vm.runInContext(code, context),
    ),
  };
  const stores: any = {
    services: {
      all: [
        {
          id: 'account-1',
          isEnabled: true,
          isHibernating: false,
          accountSnapshot: { status: 'online' },
          webview: view,
        },
      ],
    },
  };
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async name =>
    name === 'account-tools-history' ? [] : undefined,
  );
  const queue = getBulkQueue(stores);
  try {
    await queue.submit({
      type: 'text',
      text: 'hello https://example.test/',
      targets: [
        {
          id: '10001@g.us',
          accountId: 'account-1',
          name: 'group',
          group: true,
        },
      ],
      typingSeconds: 0,
      mentionAll: false,
      failure: 'continue',
      intervalMin: 0.5,
      intervalMax: 0.5,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      '10001@g.us',
      'hello https://example.test/',
      expect.objectContaining({ waitForAck: true, delay: 0 }),
    );
    expect(raw).not.toHaveBeenCalled();
    expect(queue.records[0]).toMatchObject({
      status: '已完成',
      success: 1,
      deliveries: [{ messageId: 'true_10001@g.us_CURRENT' }],
    });
  } finally {
    queue.dispose();
  }
});
