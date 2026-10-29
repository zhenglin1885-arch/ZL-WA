/* eslint-disable unicorn/consistent-function-scoping, no-await-in-loop -- Scoped mutable WhatsApp fixtures and sequential attachment reply coverage. */
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
  let decode: jest.Mock;
  let voiceSend: jest.Mock;
  beforeEach(() => {
    const accepted = { id: 'own-message', ack: 1 };
    decode = jest.fn(async () => ({
      duration: 32,
      length: 128,
      numberOfChannels: 2,
      getChannelData: (channel: number) =>
        Float32Array.from({ length: 128 }, (_v, i) => (channel ? i / 128 : 0)),
    }));
    voiceSend = jest.fn(async (params: any) => {
      wpp.whatsapp.MsgStore.get.mockReturnValue({
        ...params.options.productMsgOptions,
      });
      return { messageSendResult: 'OK' };
    });
    wpp = {
      isReady: true,
      whatsapp: {
        MsgStore: { get: jest.fn() },
        OpaqueData: {
          createFromData: jest.fn(async blob => ({ forceToBlob: () => blob })),
        },
        functions: {
          prepRawMedia: jest.fn(() => ({
            waitForPrep: async () => ({ type: 'ptt' }),
            sendToChat: async (params: any) => voiceSend(params),
          })),
        },
      },
      chat: {
        prepareRawMessage: jest.fn(async (_chat, props, options) => ({
          ...props,
          id: 'own-message',
          quotedMsg: options.quotedMsg,
        })),
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
      OfflineAudioContext: jest.fn(() => ({ decodeAudioData: decode })),
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
  const replySpec = (
    match: 'exact' | 'contains' | 'normalized' = 'exact',
  ): BulkSpec => ({
    ...spec(),
    targets: [
      {
        id: '10001@g.us',
        accountId: 'account-a',
        ownerId: '8613800000001@c.us',
        name: 'G',
        group: true,
      },
    ],
    reply: { text: '目标内容', match },
  });
  const setupReplies = () => {
    const rows = [
      { id: 'false_10001@g.us_OLD', type: 'chat', body: '目标内容', t: 1 },
      { id: 'false_10001@g.us_NEW', type: 'chat', body: '目标内容', t: 2 },
      { id: 'false_10001@g.us_OTHER', type: 'chat', body: '其他消息', t: 3 },
    ];
    wpp.conn = { getMyUserWid: () => '8613800000001@c.us' };
    wpp.chat.getMessages = jest.fn(async () => rows);
    wpp.chat.getMessageById.mockImplementation(async id =>
      rows.find(m => m.id === id),
    );
    return rows;
  };
  it('quotes the newest matching message without automatically mentioning its sender', async () => {
    setupReplies();
    const outcome = await sendBulkMessage('10001@g.us', replySpec());
    expect(outcome).toMatchObject({
      confirmed: true,
      quotedMessageId: 'false_10001@g.us_NEW',
    });
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledWith(
      '10001@g.us',
      'hello',
      expect.objectContaining({
        quotedMsg: 'false_10001@g.us_NEW',
        detectMentioned: false,
      }),
    );
    expect(
      wpp.chat.sendTextMessage.mock.calls[0][2].mentionedList,
    ).toBeUndefined();
  });
  it('supports contains and punctuation/space-insensitive exact quote matching', async () => {
    const rows = setupReplies();
    rows[1].body = '这里包含目标内容';
    await sendBulkMessage('10001@g.us', replySpec('contains'));
    rows[1].body = '目 标，内 容！';
    await sendBulkMessage('10001@g.us', replySpec('normalized'));
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(
      wpp.chat.sendTextMessage.mock.calls.every(
        c => c[2].quotedMsg === 'false_10001@g.us_NEW',
      ),
    ).toBe(true);
  });
  it.each(['exact', 'contains', 'normalized'] as const)(
    'finds the reported Portuguese message with accents and emoji using %s',
    async mode => {
      const original =
        'Mas e pra quem tá começando do zero, igual eu, que nem sabe mexer no aplicativo ainda? 😅 Como faço pra abrir uma conta numa corretora e começar a acompanhar as operações aqui do grupo? 🙏';
      const rows = setupReplies();
      const variant =
        mode === 'contains'
          ? `Olá!\n${original}\nFim.`
          : mode === 'normalized'
            ? original.replaceAll(/\p{P}/gu, '').replaceAll(' ', '\n ')
            : original;
      rows[1].body = `${variant.normalize('NFD').replaceAll(' ', '\u00A0').replaceAll('🙏', '🙏\uFE0F')}\u200B`;
      const input = replySpec(mode);
      input.reply!.text = original;
      await sendBulkMessage('10001@g.us', input);
      expect(wpp.chat.sendTextMessage).toHaveBeenCalledWith(
        '10001@g.us',
        'hello',
        expect.objectContaining({ quotedMsg: rows[1].id }),
      );
      expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(1);
    },
  );
  it('does not treat additional words or different emoji as a normalized exact match', async () => {
    const rows = setupReplies();
    rows[0].body = '目标内容，附加句子';
    rows[1].body = '目标内容 🙏';
    wpp.chat.get.mockReturnValue({ id: { _serialized: '10001@g.us' } });
    wpp.chat.getMessages.mockResolvedValue([]);
    wpp.whatsapp.functions.msgFindSearch = jest.fn(async () => ({
      messages: rows,
      eof: true,
    }));
    await expect(
      sendBulkMessage('10001@g.us', replySpec('normalized')),
    ).rejects.toThrow('未发送');
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it.each(['contains', 'normalized'] as const)(
    'retrieves %s candidates by a keyword when whole-paragraph search misses formatting variants',
    async mode => {
      const original = 'Como faço pra abrir uma conta numa corretora? 🙏';
      setupReplies();
      const older = {
        id: 'false_10001@g.us_OLDER',
        body: original,
        type: 'chat',
        t: 1,
      };
      const variant =
        mode === 'contains'
          ? `Olá! ${original}`
          : original.replaceAll(/\p{P}/gu, '').replaceAll(' ', '\n ');
      const newer = {
        id: 'false_10001@g.us_VARIANT',
        body: variant.replaceAll(' ', '\u00A0'),
        type: 'chat',
        t: 2,
      };
      wpp.chat.get.mockReturnValue({ id: { _serialized: '10001@g.us' } });
      wpp.chat.getMessages.mockResolvedValue([]);
      wpp.whatsapp.functions.msgFindSearch = jest.fn(async query => ({
        messages: query.searchTerm === original ? [older] : [newer],
        eof: true,
      }));
      wpp.chat.getMessageById.mockImplementation(async id =>
        id === newer.id ? newer : older,
      );
      const input = replySpec(mode);
      input.reply!.text = original;
      await sendBulkMessage('10001@g.us', input);
      expect(
        wpp.whatsapp.functions.msgFindSearch.mock.calls.some(
          ([query]) => query.searchTerm !== original,
        ),
      ).toBe(true);
      expect(wpp.chat.sendTextMessage.mock.calls[0][2].quotedMsg).toBe(
        newer.id,
      );
      expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(1);
    },
  );
  it('uses scoped indexed search for a reference outside the loaded scrollback', async () => {
    const rows = setupReplies();
    const remote = { _serialized: '10001@g.us' };
    wpp.chat.get.mockReturnValue({ id: remote });
    wpp.chat.getMessages.mockResolvedValue([]);
    wpp.whatsapp.functions.msgFindSearch = jest.fn(async () => ({
      messages: [
        ...rows,
        { id: 'false_99999@g.us_FOREIGN', body: '目标内容', t: 9 },
      ],
      eof: true,
    }));
    await sendBulkMessage('10001@g.us', replySpec());
    expect(wpp.whatsapp.functions.msgFindSearch).toHaveBeenCalledWith({
      searchTerm: '目标内容',
      remote,
      count: 200,
      page: 0,
    });
    expect(wpp.chat.sendTextMessage.mock.calls[0][2].quotedMsg).toBe(
      rows[1].id,
    );
    expect(wpp.chat.getMessages).not.toHaveBeenCalled();
  });
  it('starts before the newest cached outgoing message instead of the older lastReceivedKey', async () => {
    const rows = setupReplies();
    const outgoing = {
      id: 'true_10001@g.us_OWN_NEW',
      body: '目标内容',
      type: 'chat',
      t: 10,
    };
    wpp.chat.get.mockReturnValue({
      lastReceivedKey: rows[0].id,
      msgs: { getModelsArray: () => [outgoing] },
    });
    wpp.chat.getMessageById.mockImplementation(async id =>
      id === outgoing.id ? outgoing : rows.find(m => m.id === id),
    );
    wpp.chat.getMessages.mockResolvedValue([rows[0]]);
    await sendBulkMessage('10001@g.us', replySpec());
    expect(wpp.chat.getMessages.mock.calls[0][1].id).toBe(outgoing.id);
    expect(wpp.chat.sendTextMessage.mock.calls[0][2].quotedMsg).toBe(
      outgoing.id,
    );
  });
  it('compares indexed pages with mixed seconds/milliseconds and supports opaque native keys', async () => {
    const rows: any[] = setupReplies();
    const key = {
      toString: () => 'false_10001@g.us_OPAQUE',
      remote: { toString: () => '10001@g.us' },
    };
    const newest = {
      id: key,
      body: '目标内容',
      type: 'chat',
      timestamp: 1_700_000_002_000,
    };
    rows[0].t = 1_700_000_001;
    wpp.chat.get.mockReturnValue({ id: { _serialized: '10001@g.us' } });
    wpp.chat.getMessages.mockResolvedValue([]);
    wpp.whatsapp.functions.msgFindSearch = jest.fn(async ({ page }) => ({
      messages: page ? [newest] : [rows[0]],
      eof: page === 1,
    }));
    wpp.chat.getMessageById.mockImplementation(async id =>
      id === key.toString() ? newest : rows.find(m => m.id === id),
    );
    await sendBulkMessage('10001@g.us', replySpec());
    expect(wpp.whatsapp.functions.msgFindSearch).toHaveBeenCalledTimes(2);
    expect(wpp.chat.sendTextMessage.mock.calls[0][2].quotedMsg).toBe(
      key.toString(),
    );
  });
  it('falls back to chronological history when indexed search is unavailable', async () => {
    setupReplies();
    wpp.chat.get.mockReturnValue({ id: '10001@g.us' });
    wpp.whatsapp.functions.msgFindSearch = jest
      .fn()
      .mockRejectedValue(new Error('index not ready'));
    await sendBulkMessage('10001@g.us', replySpec());
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(1);
  });
  it('reports a stalled history read distinctly and does not send ordinary text', async () => {
    setupReplies();
    wpp.chat.getMessages.mockResolvedValue([
      { id: 'false_10001@g.us_OTHER', body: '不匹配', t: 5 },
    ]);
    await expect(sendBulkMessage('10001@g.us', replySpec())).rejects.toThrow(
      '历史读取未完成',
    );
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('never falls back to ordinary sending when no reference matches', async () => {
    setupReplies();
    wpp.chat.getMessages.mockResolvedValue([]);
    await expect(sendBulkMessage('10001@g.us', replySpec())).rejects.toThrow(
      '未找到',
    );
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
    expect(wpp.chat.sendFileMessage).not.toHaveBeenCalled();
  });
  it('rejects changed identity, edited/deleted references and cross-chat candidates', async () => {
    setupReplies();
    wpp.conn.getMyUserWid = () => '8613900000000@c.us';
    await expect(sendBulkMessage('10001@g.us', replySpec())).rejects.toThrow(
      '身份',
    );
    setupReplies();
    wpp.chat.getMessageById.mockResolvedValue({
      id: 'false_10001@g.us_NEW',
      body: 'edited',
      type: 'chat',
    });
    await expect(sendBulkMessage('10001@g.us', replySpec())).rejects.toThrow(
      '不再匹配',
    );
    setupReplies();
    wpp.chat.getMessages.mockResolvedValue([
      { id: 'false_99999@g.us_FOREIGN', body: '目标内容', type: 'chat', t: 4 },
    ]);
    await expect(sendBulkMessage('10001@g.us', replySpec())).rejects.toThrow(
      '未发送',
    );
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('carries the quote into image, video, document, voice and contact sends', async () => {
    setupReplies();
    for (const type of [
      'image',
      'caption',
      'video',
      'document',
      'audio',
      'contact',
    ] as const) {
      await sendBulkMessage(
        '10001@g.us',
        { ...replySpec(), type },
        type === 'audio'
          ? 'data:audio/wav;base64,YQ=='
          : 'data:image/png;base64,YQ==',
      );
    }
    expect(
      wpp.chat.sendFileMessage.mock.calls.every(
        c => c[2].quotedMsg === 'false_10001@g.us_NEW',
      ),
    ).toBe(true);
    expect(wpp.chat.sendVCardContactMessage.mock.calls[0][2].quotedMsg).toBe(
      'false_10001@g.us_NEW',
    );
    expect(wpp.chat.prepareRawMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'ptt' }),
      expect.objectContaining({
        quotedMsg: 'false_10001@g.us_NEW',
        isPtt: true,
      }),
    );
    expect(
      voiceSend.mock.calls[0][0].options.productMsgOptions.waveform,
    ).toHaveLength(64);
  });
  it('does not identify an ordinary message as a sent reply when its response ID is missing', async () => {
    setupReplies();
    await expect(
      reconcileBulkMessage(
        '10001@g.us',
        undefined,
        replySpec(),
        new Date().toISOString(),
        new Date().toISOString(),
      ),
    ).rejects.toThrow('无法安全核验');
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('never reconciles a different own message in the same chat as the recorded message', async () => {
    wpp.chat.getMessageById.mockResolvedValue(
      ownMessage({
        id: { _serialized: 'other-id', fromMe: true, remote: 'chat@g.us' },
      }),
    );
    await expect(
      reconcileBulkMessage('chat@g.us', 'expected-id', undefined, '', ''),
    ).rejects.toThrow('编号不符');
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it.each(['image', 'caption', 'video', 'document'] as const)(
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
          isPtt: false,
          caption: type === 'image' ? undefined : 'hello',
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
  it('keeps a text submission exception uncertain, pauses and reports only the error code without replaying', async () => {
    wpp.chat.sendTextMessage.mockRejectedValue(
      Object.assign(new Error('private message and proxy password'), {
        code: 'send_message_failed',
      }),
    );
    const result = await sendBulkMessage('chat@g.us', spec());
    expect(result).toMatchObject({
      messageId: '',
      confirmed: false,
      halt: true,
    });
    expect(result.error).toContain('send_message_failed');
    expect(result.error).not.toContain('private message');
    expect(wpp.chat.sendTextMessage).toHaveBeenCalledTimes(1);
  });
  it('checks the actual socket before submission even when the account sidebar still appears online', async () => {
    (window as any).require = () => ({ Socket: { state: 'UNPAIRED' } });
    await expect(sendBulkMessage('chat@g.us', spec())).rejects.toThrow(
      '账号未连接',
    );
    expect(wpp.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('does not count a negative ACK as accepted even if the helper also reports OK', async () => {
    wpp.chat.sendTextMessage.mockResolvedValue({
      id: 'own-message',
      ack: -1,
      sendMsgResult: 'OK',
    });
    expect(await sendBulkMessage('chat@g.us', spec())).toMatchObject({
      messageId: 'own-message',
      confirmed: false,
      halt: true,
      error: expect.stringContaining('ACK=-1'),
    });
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
  it('puts a real multi-channel waveform on the final outgoing PTT message, with only one native dispatch', async () => {
    const result = await sendBulkMessage(
      'chat@g.us',
      spec('audio'),
      'data:audio/wav;base64,YQ==',
    );
    expect(result).toEqual({ messageId: 'own-message', confirmed: true });
    const raw = voiceSend.mock.calls[0][0].options.productMsgOptions;
    expect(raw.type).toBe('ptt');
    expect(raw.duration).toBe(32);
    expect(raw.waveform).toBeInstanceOf(Uint8Array);
    expect(raw.waveform).toHaveLength(64);
    expect(Math.max(...raw.waveform)).toBe(100);
    expect(new Set(raw.waveform).size).toBeGreaterThan(4);
    expect(voiceSend).toHaveBeenCalledTimes(1);
    expect(wpp.chat.sendFileMessage).not.toHaveBeenCalled();
    expect((window as any).__zlBulkVoice).toMatchObject({
      phase: 'submitted',
      channels: 2,
      waveformSamples: 64,
      storedWaveformSamples: 64,
      storedWaveformMatches: true,
    });
  });
  it('does not send if waveform decoding fails', async () => {
    decode.mockRejectedValue(new Error('Unsupported codec'));
    await expect(
      sendBulkMessage('chat@g.us', spec('audio'), 'data:audio/wav;base64,YQ=='),
    ).rejects.toThrow('无法解码');
    expect(wpp.whatsapp.OpaqueData.createFromData).not.toHaveBeenCalled();
    expect(voiceSend).not.toHaveBeenCalled();
    expect(wpp.chat.sendFileMessage).not.toHaveBeenCalled();
  });
  it('preserves the current Audio composer quote through the shared voice route', async () => {
    const active = { id: 'chat@g.us', composeQuotedMsg: { id: 'quoted-id' } };
    wpp.chat.getActiveChat = () => active;
    wpp.conn = { getMyUserWid: () => 'owner@c.us' };
    wpp.chat.getMessageById.mockResolvedValue(
      ownMessage({ id: { _serialized: 'quoted-id', remote: 'chat@g.us' } }),
    );
    await sendBulkMessage(
      'chat@g.us',
      spec('audio'),
      'data:audio/ogg;base64,YQ==',
      {
        ownerId: 'owner@c.us',
        quotedMessageId: 'quoted-id',
      },
    );
    expect(wpp.chat.prepareRawMessage.mock.calls[0][2].quotedMsg).toBe(
      'quoted-id',
    );
    expect(voiceSend).toHaveBeenCalledTimes(1);
  });
  it('refuses a composer quote from another conversation', async () => {
    wpp.chat.getActiveChat = () => ({
      id: 'chat@g.us',
      composeQuotedMsg: { id: 'quoted-id' },
    });
    wpp.conn = { getMyUserWid: () => 'owner@c.us' };
    wpp.chat.getMessageById.mockResolvedValue(
      ownMessage({ id: { remote: 'other@g.us' } }),
    );
    await expect(
      sendBulkMessage(
        'chat@g.us',
        spec('audio'),
        'data:audio/ogg;base64,YQ==',
        {
          ownerId: 'owner@c.us',
          quotedMessageId: 'quoted-id',
        },
      ),
    ).rejects.toThrow('不属于当前聊天');
    expect(voiceSend).not.toHaveBeenCalled();
  });
  it.each(['account', 'chat', 'quote'])(
    'does not dispatch if the Audio %s changes while decoding',
    async change => {
      let owner = 'owner@c.us';
      const active: any = { id: 'chat@g.us' };
      wpp.chat.getActiveChat = () => active;
      wpp.conn = { getMyUserWid: () => owner };
      const decoded = await decode();
      decode.mockImplementation(async () => {
        if (change === 'account') owner = 'other@c.us';
        if (change === 'chat') active.id = 'other@g.us';
        if (change === 'quote') active.composeQuotedMsg = { id: 'new-quote' };
        return decoded;
      });
      await expect(
        sendBulkMessage(
          'chat@g.us',
          spec('audio'),
          'data:audio/ogg;base64,YQ==',
          {
            ownerId: 'owner@c.us',
          },
        ),
      ).rejects.toThrow('已变化');
      expect(voiceSend).not.toHaveBeenCalled();
      expect(wpp.chat.sendFileMessage).not.toHaveBeenCalled();
    },
  );
  it('preserves genuine silence as 64 zero samples', async () => {
    decode.mockResolvedValue({
      duration: 1,
      length: 128,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(128),
    });
    await sendBulkMessage(
      'chat@g.us',
      spec('audio'),
      'data:audio/wav;base64,YQ==',
    );
    expect([
      ...voiceSend.mock.calls[0][0].options.productMsgOptions.waveform,
    ]).toEqual(Array.from({ length: 64 }).fill(0));
  });
  it('rejects a native preparation that remains ordinary audio', async () => {
    wpp.whatsapp.functions.prepRawMedia.mockReturnValue({
      waitForPrep: async () => ({ type: 'audio' }),
    });
    await expect(
      sendBulkMessage('chat@g.us', spec('audio'), 'data:audio/wav;base64,YQ=='),
    ).rejects.toThrow('原生语音');
    expect(voiceSend).not.toHaveBeenCalled();
  });
  it('keeps the legacy native call signature and final waveform fields', async () => {
    wpp.whatsapp.functions.prepRawMedia.mockReturnValue({
      waitForPrep: async () => ({ type: 'ptt' }),
      sendToChat: async (chat: any, options: any) =>
        voiceSend({ chat, options }),
    });
    await sendBulkMessage(
      'chat@g.us',
      spec('audio'),
      'data:audio/wav;base64,YQ==',
    );
    expect(
      voiceSend.mock.calls[0][0].options.productMsgOptions.waveform,
    ).toHaveLength(64);
    expect(voiceSend).toHaveBeenCalledTimes(1);
  });
  it('does not claim waveform confirmation when the outgoing model cannot be read', async () => {
    wpp.whatsapp.MsgStore = null;
    voiceSend.mockResolvedValue({ messageSendResult: 'OK' });
    await expect(
      sendBulkMessage('chat@g.us', spec('audio'), 'data:audio/wav;base64,YQ=='),
    ).resolves.toMatchObject({ confirmed: true });
    expect((window as any).__zlBulkVoice.storedWaveformMatches).toBeNull();
    expect(voiceSend).toHaveBeenCalledTimes(1);
  });
  it('reports missing waveform metadata on the actual outgoing model without repeating the send', async () => {
    voiceSend.mockResolvedValue({ messageSendResult: 'OK' });
    wpp.whatsapp.MsgStore.get.mockReturnValue({ type: 'ptt' });
    await sendBulkMessage(
      'chat@g.us',
      spec('audio'),
      'data:audio/wav;base64,YQ==',
    );
    expect((window as any).__zlBulkVoice).toMatchObject({
      storedWaveformSamples: 0,
      storedWaveformMatches: false,
    });
    expect(voiceSend).toHaveBeenCalledTimes(1);
  });
});
