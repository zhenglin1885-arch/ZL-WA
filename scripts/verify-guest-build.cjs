/* eslint-disable no-console -- Command-line verification output. */
// Execute the actual compiled/serialized guest functions in a fresh JS realm.
// This catches accidental references to esbuild module-scope helpers.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  applyWhatsAppTheme,
  readWhatsAppSnapshot,
  markAllWhatsAppRead,
} = require('../build/features/accounts/whatsapp');
const {
  translationTick,
  translationDiagnostics,
  listRecipients,
  sendTextToChat,
} = require('../build/features/accountTools/guest');
const { defaultTools } = require('../build/features/accountTools/config');
const {
  readSendDiagnostics,
} = require('../build/features/accounts/sendDiagnostics');

const { captureChat } = require('../build/features/chatBackup/guest');
const advanced = require('../build/features/accountTools/bulkGuest');
const customers = require('../build/features/customers/guest');
const { groupGuest } = require('../build/features/groups/guest');
const { reactionGuest } = require('../build/features/reactions/guest');
const { watchWhatsAppUnread } = require('../build/features/accounts/unread');
const {
  configureWhatsAppLayout,
} = require('../build/features/accounts/layout');

(async () => {
  const modules = {
    WAWebSocketModel: { Socket: { state: 'CONNECTED' } },
    WAWebConnModel: { Conn: { pushname: 'Synthetic identity' } },
    WAWebUserPrefsMeUser: {
      getMaybeMePnUser: () => ({ user: '8613800000001', server: 'c.us' }),
    },
    WAWebCollections: {
      Chat: { getModelsArray: () => [], get: () => {} },
    },
    WAWebUpdateUnreadChatAction: { sendSeen: async () => {} },
  };
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    queueMicrotask,
    location: { hostname: 'web.whatsapp.com' },
    navigator: { onLine: true },
    window: {
      location: { hostname: 'web.whatsapp.com' },
      require: name => modules[name],
      addEventListener() {},
    },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: {},
    },
    localStorage: { getItem: () => null },
    crypto: { randomUUID: () => 'synthetic-document' },
    MutationObserver: class {
      observe() {}
    },
  });
  const call = (fn, args = []) =>
    vm.runInContext(`(${fn.toString()})(...${JSON.stringify(args)})`, context);
  const connection = JSON.parse(JSON.stringify(call(readSendDiagnostics)));
  assert.equal(connection.socket, 'CONNECTED');
  assert.equal(connection.messageStoreReadable, false);
  assert.equal(connection.outgoing.inspected, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(call(customers.readCustomerContext))),
    {
      token: 'synthetic-document',
      owners: ['8613800000001@c.us'],
      needsLibrary: false,
      canInitialize: true,
    },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await call(advanced.waitForBulkReceipt, ['chat@g.us', 'missing-id']),
      ),
    ),
    {
      messageId: 'missing-id',
      confirmed: false,
      error: '已记录消息编号，服务器回执仍待确认；未重发原消息',
    },
  );
  context.window.__zlCustomers = { queue: [], data: undefined };
  assert.equal(call(customers.customerTick).length, 0);
  assert.equal(call(applyWhatsAppTheme, [true]), false);
  await assert.rejects(
    call(groupGuest, [{ ownerId: '8613800000001@c.us' }]),
    /群组接口尚未就绪/,
  );
  context.window.WPP = {
    isReady: true,
    conn: { getMyUserWid: () => '8613800000001@c.us' },
    group: { iAmMember: async () => true },
    chat: {
      getMessages: async () => [
        { id: 'false_10001@g.us_OLD', body: '你好', t: 1 },
        { id: 'false_10001@g.us_NEW', body: '你好', t: 2 },
      ],
      getMessageById: async id => ({ id, body: '你好', t: 2 }),
      sendReactionToMessage: async () => ({ sendMsgResult: 'OK' }),
    },
  };
  const reactionRequest = {
    ownerId: '8613800000001@c.us',
    groupId: '10001@g.us',
    rules: { text: '你好', match: 'exact' },
  };
  const foundReaction = await call(reactionGuest, [reactionRequest]);
  assert.equal(foundReaction.messageId, 'false_10001@g.us_NEW');
  const sentReaction = await call(reactionGuest, [
    {
      ...reactionRequest,
      messageId: foundReaction.messageId,
      expectedText: '你好',
      emoji: '👍',
      token: 'compiled-reaction',
    },
  ]);
  assert.equal(sentReaction.status, 'success');
  delete context.window.WPP;
  assert.equal(
    await call(captureChat, [
      { ownerId: '8613800000001@c.us', accountName: 'Fixture', mode: 'opened' },
    ]),
    null,
  );
  await assert.rejects(
    call(captureChat, [
      { ownerId: 'wrong@c.us', accountName: 'Fixture', mode: 'opened' },
    ]),
    /账号身份已变化/,
  );
  assert.equal(call(watchWhatsAppUnread), true);
  context.window.__zlWaUnread.dispose();
  const snapshot = await call(readWhatsAppSnapshot);
  assert.equal(snapshot.status, 'online');
  const receipts = await call(markAllWhatsAppRead);
  assert.equal(receipts.read, 0);
  assert.equal(call(translationTick, [defaultTools().translation]).length, 0);
  assert.equal(call(translationDiagnostics).enabled, false);
  assert.equal(call(listRecipients).length, 0);
  await assert.rejects(
    call(sendTextToChat, ['unknown@c.us', 'test']),
    /聊天不可用/,
  );

  context.window.WPP = {
    isReady: true,
    chat: {
      get: () => ({}),
      sendTextMessage: async () => ({ id: 'synthetic-message', ack: 1 }),
      getMessageById: async () => ({
        id: {
          _serialized: 'synthetic-message',
          fromMe: true,
          remote: { _serialized: 'synthetic@g.us' },
        },
        type: 'chat',
        t: Math.floor(Date.now() / 1000),
        ack: 1,
      }),
      deleteMessage: async () => ({ isRevoked: true, sendMsgResult: 'OK' }),
      editMessage: async () => ({ ack: 1 }),
    },
    contact: { list: async () => [] },
  };
  const sent = await call(advanced.sendBulkMessage, [
    'synthetic@g.us',
    { type: 'text', text: 'fixture', typingSeconds: 0, mentionAll: false },
  ]);
  assert.equal(sent.messageId, 'synthetic-message');
  assert.equal(sent.confirmed, true);
  await call(advanced.revokeBulkMessage, [
    'synthetic@g.us',
    'synthetic-message',
  ]);
  const recovered = await call(advanced.reconcileBulkMessage, [
    'synthetic@g.us',
    'synthetic-message',
    undefined,
    '',
    '',
  ]);
  assert.equal(recovered.messageId, 'synthetic-message');
  assert.equal(recovered.confirmed, true);
  await call(advanced.editBulkMessage, [
    'synthetic@g.us',
    'synthetic-message',
    'corrected',
  ]);
  const contacts = await call(advanced.listBulkContacts);
  assert.equal(contacts.length, 0);
  const handlers = {};
  const styles = {};
  const element = {
    dataset: {},
    style: {
      setProperty: (key, value) => {
        styles[key] = value;
      },
    },
    addEventListener() {},
    setAttribute() {},
    getBoundingClientRect: () => ({
      width: 320,
      height: 600,
      left: 0,
      right: 320,
      top: 0,
    }),
    isConnected: true,
  };
  const header = {
    ...element,
    dataset: {},
    querySelector: () => null,
    append() {},
  };
  const side = {
    ...element,
    querySelector: selector => (selector.includes('header') ? header : null),
    parentElement: null,
  };
  const stored = {};
  const layoutPage = vm.createContext({
    location: { hostname: 'web.whatsapp.com' },
    localStorage: {
      getItem: () => null,
      setItem: (key, value) => {
        stored[key] = value;
      },
    },
    window: {
      innerWidth: 1000,
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
    },
    document: {
      querySelector: () => side,
      querySelectorAll: () => [],
      body: { append() {} },
      createElement: () => ({ ...element }),
      head: { append() {} },
      documentElement: { style: { cursor: '', userSelect: '' } },
    },
  });
  assert.equal(
    vm.runInContext(`(${configureWhatsAppLayout.toString()})()`, layoutPage),
    true,
  );
  const gesture = {
    target: { closest: () => element },
    button: 0,
    pointerId: 1,
    clientX: 320,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  handlers.click(gesture);
  assert.equal(styles['--zl-chat-list-width'], undefined);
  assert.equal(stored['zl-chat-list-width'], undefined);
  const seamGesture = {
    ...gesture,
    target: {
      closest: selector =>
        selector === '[data-zl-chat-divider]' ? element : null,
    },
  };
  handlers.pointerdown(seamGesture);
  handlers.pointermove({ ...seamGesture, clientX: 390 });
  handlers.pointerup(seamGesture);
  assert.equal(stored['zl-chat-list-width'], undefined);
  handlers.pointerdown(gesture);
  handlers.pointermove({ ...gesture, clientX: 390 });
  handlers.pointerup(gesture);
  assert.equal(stored['zl-chat-list-width'], '390');
  console.log(
    'PASS compiled guest functions execute independently of their host module',
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
