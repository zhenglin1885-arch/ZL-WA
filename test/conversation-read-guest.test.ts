import vm from 'node:vm';
import { markConversationsRead } from '../src/features/conversations/guest';

const makeChats = () => [
  { id: { _serialized: '10001@c.us' }, unreadCount: 5 },
  { id: { _serialized: '10002@c.us' }, unreadCount: 6 },
];
describe('scoped aggregate read receipts', () => {
  const owners = ['881@c.us'];
  const execute = (
    chats: ReturnType<typeof makeChats>,
    sendSeen: jest.Mock,
    currentOwner: () => string[],
  ) =>
    vm.runInNewContext(
      `(${markConversationsRead.toString()})(['10001@c.us','10002@c.us'],${JSON.stringify(owners)})`,
      {
        location: { hostname: 'web.whatsapp.com' },
        window: {
          __zlCustomerAdapter: { owners: currentOwner, models: () => chats },
          require: () => ({ sendSeen }),
        },
        setTimeout,
        clearTimeout,
      },
    );
  it('bounds a stalled read without clearing unread state or starting the next receipt', async () => {
    jest.useFakeTimers();
    try {
      const chats = makeChats();
      const sendSeen = jest.fn(() => new Promise(() => {}));
      const result = execute(chats, sendSeen, () => owners);
      await jest.advanceTimersByTimeAsync(2001);
      await expect(result).resolves.toEqual({
        read: 0,
        failed: 2,
        halted: true,
      });
      expect(sendSeen).toHaveBeenCalledTimes(1);
      expect(chats.map(chat => chat.unreadCount)).toEqual([5, 6]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
  it('stops after account identity changes while a read receipt is in progress', async () => {
    const chats = makeChats();
    let live = owners;
    const sendSeen = jest.fn(async () => {
      chats[0].unreadCount = 0;
      live = ['882@c.us'];
    });
    await expect(execute(chats, sendSeen, () => live)).resolves.toEqual({
      read: 1,
      failed: 1,
      halted: true,
    });
    expect(sendSeen).toHaveBeenCalledTimes(1);
    expect(chats[1].unreadCount).toBe(6);
  });
});
