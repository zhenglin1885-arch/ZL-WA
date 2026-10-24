import {
  sendBulkMessage,
  revokeBulkMessage,
  listBulkContacts,
  reconcileBulkMessage,
  editBulkMessage,
} from '../src/features/accountTools/bulkGuest';
import type { BulkSpec } from '../src/features/accountTools/config';

const spec = (type: BulkSpec['type'] = 'text'): BulkSpec => ({
  type,
  text: 'hello',
  targets: [],
  intervalMin: 1,
  intervalMax: 1,
  typingSeconds: 2,
  mentionAll: false,
  failure: 'stop',
  media: {
    id: 'media',
    name: 'sample',
    mime: 'application/octet-stream',
    size: 1,
  },
  contactName: 'Test card',
  contactPhone: '8613800000000',
});
const ownMessage = (extra: any = {}) => ({
  id: {
    _serialized: 'own-id',
    fromMe: true,
    remote: { _serialized: 'chat@g.us' },
  },
  type: 'chat',
  body: 'hello',
  ack: 2,
  t: Math.floor(Date.now() / 1000),
  ...extra,
});

describe('advanced WhatsApp adapter with synthetic WPP, no real messages', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let wpp: any;
  beforeEach(() => {
    const accepted = { id: 'own-message', ack: 1 };
    wpp = {
      isReady: true,
      chat: {
        get: jest.fn().mockReturnValue({}),
        sendTextMessage: jest.fn().mockResolvedValue(accepted),
        sendFileMessage: jest.fn().mockResolvedValue(accepted),
        sendVCardContactMessage: jest.fn().mockResolvedValue(accepted),
        getMessageById: jest.fn().mockResolvedValue({
          id: { fromMe: true, remote: { _serialized: 'chat@g.us' } },
        }),
        deleteMessage: jest
          .fn()
          .mockResolvedValue({ isRevoked: true, sendMsgResult: 'OK' }),
      },
      group: {
        getParticipants: jest
          .fn()
          .mockResolvedValue([{ id: { _serialized: 'member@lid' } }]),
      },
      contact: {
        list: jest.fn().mockResolvedValue([
          {
            id: { _serialized: 'saved@c.us', server: 'c.us' },
            name: 'Saved contact',
          },
          { id: { server: 'newsletter' } },
        ]),
      },
    };
    for (const [key, value] of Object.entries({
      window: { WPP: wpp },
      location: { hostname: 'web.whatsapp.com' },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it.each(['image', 'caption', 'video', 'audio', 'document'] as const)(
    'sends %s through the correct typed adapter with server acknowledgment',
    async type => {
      expect(
        await sendBulkMessage('chat@g.us', spec(type), 'data:test;base64,AA=='),
      ).toEqual({ messageId: 'own-message', confirmed: true });
      expect(wpp.chat.sendFileMessage).toHaveBeenCalledWith(
        'chat@g.us',
        'data:test;base64,AA==',
        expect.objectContaining({
          type: type === 'caption' ? 'image' : type,
          waitForAck: true,
          delay: 2000,
          isPtt: type === 'audio',
          caption: type === 'image' || type === 'audio' ? undefined : 'hello',
        }),
      );
    },
  );
  it.each(['serialized', 'toString'] as const)(
    'preserves object message keys for later edit and revoke: %p',
    async format => {
      const id: unknown =
        format === 'serialized'
          ? { _serialized: 'own-message' }
          : { toString: () => 'own-message' };
      wpp.chat.sendTextMessage.mockResolvedValue({ id, ack: 1 });
      expect(await sendBulkMessage('chat@g.us', spec())).toEqual({
        messageId: 'own-message',
        confirmed: true,
      });
    },
  );
  it('keeps an unidentifiable accepted send uncertain and never submits it again', async () => {
    wpp.chat.sendTextMessage.mockResolvedValue({ id: {}, ack: 1 });
    expect(await sendBulkMessage('chat@g.us', spec())).toMatchObject({
      messageId: '',
      confirmed: false,
    });
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(1);
  });
  it('constructs a contact card from the user supplied name and international number', async () => {
    await sendBulkMessage('chat@g.us', spec('contact'));
    expect(wpp.chat.sendVCardContactMessage).toHaveBeenCalledWith(
      'chat@g.us',
      { id: '8613800000000@c.us', name: 'Test card' },
      expect.objectContaining({ waitForAck: true }),
    );
  });
  it('mentions the actual group participant IDs, including LID addressing, only when enabled', async () => {
    await sendBulkMessage('chat@g.us', { ...spec(), mentionAll: true });
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledWith(
      'chat@g.us',
      'hello',
      expect.objectContaining({
        mentionedList: ['member@lid'],
        detectMentioned: false,
      }),
    );
    await sendBulkMessage('private@c.us', { ...spec(), mentionAll: true });
    expect(wpp.group.getParticipants).toHaveBeenCalledTimes(1);
  });
  it('does not pretend an unacknowledged send or a local deletion is a successful revoke', async () => {
    wpp.chat.sendTextMessage.mockResolvedValue({ id: 'pending', ack: 0 });
    expect(await sendBulkMessage('chat@g.us', spec())).toEqual({
      messageId: 'pending',
      confirmed: false,
    });
    wpp.chat.deleteMessage.mockResolvedValue({
      isRevoked: false,
      isDeleted: true,
      sendMsgResult: 'OK',
    });
    await expect(revokeBulkMessage('chat@g.us', 'own-message')).rejects.toThrow(
      '未确认',
    );
  });
  it('revokes only the current account own message in the recorded chat with revoke=true', async () => {
    await revokeBulkMessage('chat@g.us', 'own-message');
    expect(wpp.chat.deleteMessage).toHaveBeenCalledWith(
      'chat@g.us',
      'own-message',
      false,
      true,
    );
    wpp.chat.getMessageById.mockResolvedValue({ id: { fromMe: false } });
    await expect(
      revokeBulkMessage('chat@g.us', 'foreign-message'),
    ).rejects.toThrow('不属于');
    expect(wpp.chat.deleteMessage).toHaveBeenCalledTimes(1);
  });
  it.each(['OK', { messageSendResult: 'OK' }])(
    'recognizes OK result %p even when the returned ACK snapshot is still zero',
    async sendMsgResult => {
      wpp.chat.sendTextMessage.mockResolvedValue({
        id: 'accepted',
        ack: 0,
        sendMsgResult,
      });
      expect(await sendBulkMessage('chat@g.us', spec())).toEqual({
        messageId: 'accepted',
        confirmed: true,
      });
    },
  );
  it('recovers the unique own message by exact text, recipient and task time without sending', async () => {
    wpp.chat.getMessages = jest.fn().mockResolvedValue([
      ownMessage(),
      ownMessage({
        id: { fromMe: false, remote: { _serialized: 'chat@g.us' } },
      }),
      ownMessage({ t: 1 }),
    ]);
    const result = await reconcileBulkMessage(
      'chat@g.us',
      undefined,
      spec(),
      new Date(Date.now() - 1000).toISOString(),
      new Date().toISOString(),
    );
    expect(result).toEqual({ messageId: 'own-id', confirmed: true });
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('refuses ambiguous matches and messages outside the selected account/chat', async () => {
    wpp.chat.getMessages = jest
      .fn()
      .mockResolvedValue([ownMessage(), ownMessage()]);
    await expect(
      reconcileBulkMessage(
        'chat@g.us',
        undefined,
        spec(),
        new Date(Date.now() - 1000).toISOString(),
        new Date().toISOString(),
      ),
    ).rejects.toThrow('多条相同');
    wpp.chat.getMessageById.mockResolvedValue(
      ownMessage({ id: { fromMe: false } }),
    );
    await expect(
      reconcileBulkMessage('chat@g.us', 'foreign', spec(), '', ''),
    ).rejects.toThrow('不属于');
  });
  it('preserves an unacknowledged recovered ID without claiming server acceptance', async () => {
    wpp.chat.getMessageById.mockResolvedValue(ownMessage({ ack: 0 }));
    expect(
      await reconcileBulkMessage('chat@g.us', 'own-id', spec(), '', ''),
    ).toMatchObject({ messageId: 'own-id', confirmed: false });
  });
  it('does not identify an attachment by timestamp alone', async () => {
    wpp.chat.getMessages = jest.fn().mockResolvedValue([
      ownMessage({
        type: 'image',
        body: '',
        filename: 'wrong.png',
        size: 10,
      }),
    ]);
    await expect(
      reconcileBulkMessage(
        'chat@g.us',
        undefined,
        spec('image'),
        new Date(Date.now() - 1000).toISOString(),
        new Date().toISOString(),
      ),
    ).rejects.toThrow('未找到唯一');
  });
  it.each(['chat', 'image', 'video', 'document'])(
    'edits a current own %s message in place with confirmed server results',
    async type => {
      wpp.chat.getMessageById.mockResolvedValue(ownMessage({ type }));
      wpp.chat.editMessage = jest.fn().mockResolvedValue({
        ack: 0,
        sendMsgResult: { messageSendResult: 'OK' },
      });
      await editBulkMessage('chat@g.us', 'own-id', 'corrected');
      expect(wpp.chat.editMessage).toHaveBeenCalledWith('own-id', 'corrected', {
        waitForAck: true,
      });
      expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
    },
  );
  it('rejects expired, foreign, revoked and unsupported edits before changing WhatsApp', async () => {
    wpp.chat.editMessage = jest.fn();
    for (const message of [
      ownMessage({ t: Math.floor(Date.now() / 1000) - 901 }),
      ownMessage({ id: { fromMe: false } }),
      ownMessage({ isRevokedByMe: true }),
      ownMessage({ type: 'ptt' }),
    ]) {
      wpp.chat.getMessageById.mockResolvedValue(message);
      // eslint-disable-next-line no-await-in-loop
      await expect(
        editBulkMessage('chat@g.us', 'own-id', 'corrected'),
      ).rejects.toThrow();
    }
    expect(wpp.chat.editMessage).not.toHaveBeenCalled();
  });
  it('does not claim an edit with an unknown acknowledgment succeeded', async () => {
    wpp.chat.getMessageById.mockResolvedValue(ownMessage());
    wpp.chat.editMessage = jest.fn().mockResolvedValue({ ack: 0 });
    await expect(
      editBulkMessage('chat@g.us', 'own-id', 'corrected'),
    ).rejects.toThrow('待确认');
    expect(wpp.chat.editMessage).toHaveBeenCalledTimes(1);
  });
  it('keeps media captions unchanged while mentioning all members, including admins', async () => {
    wpp.group.getParticipants.mockResolvedValue([
      { id: { _serialized: 'member@lid' } },
      { id: { _serialized: 'admin@c.us' }, isAdmin: true },
    ]);
    await sendBulkMessage(
      'chat@g.us',
      { ...spec('caption'), mentionAll: true },
      'data:test;base64,AA==',
    );
    expect(wpp.chat.sendFileMessage).toHaveBeenCalledWith(
      'chat@g.us',
      'data:test;base64,AA==',
      expect.objectContaining({
        caption: 'hello',
        mentionedList: ['member@lid', 'admin@c.us'],
        detectMentioned: false,
      }),
    );
  });
  it('preserves existing mention metadata when editing an already sent message', async () => {
    wpp.chat.getMessageById.mockResolvedValue(
      ownMessage({ mentionedJidList: [{ _serialized: 'member@lid' }] }),
    );
    wpp.chat.editMessage = jest.fn().mockResolvedValue({ ack: 1 });
    await editBulkMessage('chat@g.us', 'own-id', 'corrected');
    expect(wpp.chat.editMessage).toHaveBeenCalledWith(
      'own-id',
      'corrected',
      expect.objectContaining({
        mentionedList: ['member@lid'],
        detectMentioned: false,
      }),
    );
  });
  it('reads only this account saved contacts, excluding channels', async () => {
    expect(await listBulkContacts()).toEqual([
      {
        id: 'saved@c.us',
        name: 'Saved contact',
        group: false,
        contact: true,
        contactOnly: true,
      },
    ]);
    expect(wpp.contact.list).toHaveBeenCalledWith({ onlyMyContacts: true });
  });
});
