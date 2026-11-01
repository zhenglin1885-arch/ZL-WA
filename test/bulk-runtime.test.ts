import vm from 'node:vm';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
const { ipcRenderer } = require('electron');
const { getBulkQueue } = require('../src/features/accountTools/bulkRuntime');

const makePolicyView = () => ({
  executeJavaScript: jest.fn(async (code: string) => {
    if (code.startsWith('location.hostname ')) return false;
    if (code === 'Boolean(window.WPP)') return true;
    if (code.startsWith('new Promise')) return true;
    return { messageId: 'true_10001@g.us_POLICY', confirmed: true };
  }),
});

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

it('enforces each target account policy in background queues without blocking other accounts', async () => {
  const enabledView = makePolicyView();
  const disabledView = makePolicyView();
  const stores: any = {
    services: {
      all: [
        {
          id: 'enabled',
          isEnabled: true,
          accountSnapshot: { status: 'online' },
          webview: enabledView,
        },
        {
          id: 'disabled',
          isEnabled: true,
          accountSnapshot: { status: 'online' },
          webview: disabledView,
        },
      ],
    },
  };
  (ipcRenderer.invoke as jest.Mock).mockImplementation(
    async (name: string, id: string) => {
      if (name === 'account-tools-history') return [];
      if (name === 'account-tools-get')
        return { translation: { blockChinese: id === 'enabled' } };
      return null;
    },
  );
  const queue = getBulkQueue(stores);
  try {
    await queue.submit({
      type: 'text',
      text: 'mixed 中文',
      targets: [
        { id: '10001@g.us', accountId: 'enabled', name: 'A', group: true },
        { id: '10001@g.us', accountId: 'disabled', name: 'B', group: true },
      ],
      typingSeconds: 0,
      mentionAll: false,
      failure: 'continue',
      intervalMin: 0.5,
      intervalMax: 0.5,
    });
    expect(enabledView.executeJavaScript).not.toHaveBeenCalled();
    expect(disabledView.executeJavaScript).toHaveBeenCalled();
    expect(queue.records[0]).toMatchObject({ success: 1, failed: 1 });
    expect(queue.records[0].deliveries[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('禁止发送中文'),
    });
  } finally {
    queue.dispose();
  }
});
