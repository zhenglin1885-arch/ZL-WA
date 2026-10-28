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
  it('accepts a serialized outgoing key without object fromMe/remote fields', async () => {
    message = { id: 'true_chat@g.us_SENT', ack: 1 };
    await expect(
      waitForBulkReceipt('chat@g.us', message.id),
    ).resolves.toMatchObject({ confirmed: true });
  });
  it('retains a live native ACK even when a supplemental helper read hangs', async () => {
    page.WPP = {
      isReady: true,
      chat: { getMessageById: jest.fn(() => new Promise(() => {})) },
    };
    setTimeout(() => {
      message.ack = 1;
    }, 700);
    const check = waitForBulkReceipt('chat@g.us', 'outgoing-id');
    await jest.runAllTimersAsync();
    await expect(check).resolves.toMatchObject({ confirmed: true });
    expect(page.WPP.chat.getMessageById).toHaveBeenCalledTimes(1);
  });
  it('accepts opaque native IDs and Wids that expose only toString', async () => {
    message = {
      id: {
        toString: () => 'outgoing-id',
        fromMe: true,
        remote: { toString: () => 'chat@g.us' },
      },
      attributes: { ack: 2 },
    };
    await expect(
      waitForBulkReceipt('chat@g.us', 'outgoing-id'),
    ).resolves.toMatchObject({ confirmed: true });
  });
  it('reads the fresh helper model when the native cache still has ACK=0', async () => {
    page.WPP = {
      isReady: true,
      chat: { getMessageById: jest.fn(async () => ({ ...message, ack: 1 })) },
    };
    await expect(
      waitForBulkReceipt('chat@g.us', 'outgoing-id'),
    ).resolves.toMatchObject({ confirmed: true });
    expect(page.WPP.chat.getMessageById).toHaveBeenCalledWith('outgoing-id');
  });
  it('uses an exact-ID read receipt without resending when the cached message ACK is stale', async () => {
    page.WPP = {
      isReady: true,
      chat: {
        getMessageById: jest.fn(async () => message),
        getMessageACK: jest.fn(async () => ({
          ack: 0,
          fromMe: true,
          participants: [{ readAt: 1234 }],
        })),
      },
    };
    await expect(
      waitForBulkReceipt('chat@g.us', 'outgoing-id'),
    ).resolves.toMatchObject({ confirmed: true });
    expect(page.WPP.chat.getMessageACK).toHaveBeenCalledWith('outgoing-id');
  });
  it.each([false, undefined])(
    'never treats another sender or missing sender proof as an accepted ACK: %s',
    async fromMe => {
      page.WPP = {
        isReady: true,
        chat: {
          getMessageACK: jest.fn(async () => ({
            ack: 2,
            fromMe,
            participants: [{ deliveredAt: 1234 }],
          })),
        },
      };
      const pending = waitForBulkReceipt('chat@g.us', 'outgoing-id');
      await jest.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({ confirmed: false });
    },
  );
});
