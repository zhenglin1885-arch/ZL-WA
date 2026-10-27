import { waitForBulkReceipt } from '../src/features/accountTools/bulkGuest';

describe('read-only settling of a newly sent message receipt', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let page: any;
  let message: any;
  beforeEach(() => {
    jest.useFakeTimers();
    message = {
      id: { _serialized: 'outgoing-id', fromMe: true, remote: 'chat@g.us' },
      ack: 0,
    };
    page = {
      require: jest.fn(() => ({ Msg: { get: jest.fn(() => message) } })),
    };
    for (const [key, value] of Object.entries({
      window: page,
      location: { hostname: 'web.whatsapp.com' },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('accepts a delayed ACK on the exact outgoing message without submitting any mutation', async () => {
    setTimeout(() => {
      message.ack = 1;
    }, 700);
    const check = waitForBulkReceipt('chat@g.us', 'outgoing-id');
    await jest.runAllTimersAsync();
    await expect(check).resolves.toEqual({
      messageId: 'outgoing-id',
      confirmed: true,
    });
    expect(page.require).toHaveBeenCalledWith('WAWebCollections');
  });
  it.each(['id', 'chat', 'owner'])(
    'does not confirm a message with a different %s',
    async mismatch => {
      message.ack = 2;
      if (mismatch === 'id') message.id._serialized = 'another-id';
      if (mismatch === 'chat') message.id.remote = 'another@g.us';
      if (mismatch === 'owner') message.id.fromMe = false;
      const result = await waitForBulkReceipt('chat@g.us', 'outgoing-id');
      expect(result.confirmed).toBe(false);
    },
  );
  it('bounds pending ACK reads and keeps the original ID', async () => {
    const check = waitForBulkReceipt('chat@g.us', 'outgoing-id');
    await jest.runAllTimersAsync();
    await expect(check).resolves.toMatchObject({
      messageId: 'outgoing-id',
      confirmed: false,
    });
    expect(jest.getTimerCount()).toBe(0);
  });
  it('uses the ready helper when the native collection is unavailable', async () => {
    page.require = () => null;
    page.WPP = {
      isReady: true,
      chat: { getMessageById: jest.fn(async () => message) },
    };
    message.ack = 1;
    await expect(
      waitForBulkReceipt('chat@g.us', 'outgoing-id'),
    ).resolves.toMatchObject({ confirmed: true });
    expect(page.WPP.chat.getMessageById).toHaveBeenCalledWith('outgoing-id');
  });
  it('stops polling a hung helper read instead of accumulating concurrent calls', async () => {
    page.require = () => null;
    page.WPP = {
      isReady: true,
      chat: { getMessageById: jest.fn(() => new Promise(() => {})) },
    };
    const check = waitForBulkReceipt('chat@g.us', 'outgoing-id');
    await jest.runAllTimersAsync();
    await expect(check).resolves.toMatchObject({ confirmed: false });
    expect(page.WPP.chat.getMessageById).toHaveBeenCalledTimes(1);
  });
});
