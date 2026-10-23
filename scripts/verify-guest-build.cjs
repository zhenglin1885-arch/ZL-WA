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

const { captureChat } = require('../build/features/chatBackup/guest');
const advanced = require('../build/features/accountTools/bulkGuest');
const customers = require('../build/features/customers/guest');
const { groupGuest } = require('../build/features/groups/guest');
const { watchWhatsAppUnread } = require('../build/features/accounts/unread');

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
  assert.deepEqual(
    JSON.parse(JSON.stringify(call(customers.readCustomerContext))),
    { token: 'synthetic-document', owners: ['8613800000001@c.us'] },
  );
  context.window.__zlCustomers = { queue: [], data: undefined };
  assert.equal(call(customers.customerTick).length, 0);
  assert.equal(call(applyWhatsAppTheme, [true]), false);
  await assert.rejects(
    call(groupGuest, [{ ownerId: '8613800000001@c.us' }]),
    /群组接口尚未就绪/,
  );
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
  console.log(
    'PASS compiled guest functions execute independently of their host module',
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
