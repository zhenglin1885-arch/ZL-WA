import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  ProtocolAccount,
  normalizeJid,
  wireJid,
  matchesText,
} from '../model.mjs';
const PN = '5511999999999@c.us',
  LID = '123456789012345@lid',
  GROUP = '123456789012345@g.us',
  JID = '5511888888888@c.us';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  const sockets = [],
    updates = [],
    writes = [],
    timers = [];
  let authSaves = 0;
  const build = () => ({
    user: {
      id: PN.replace('@c.us', ':2@s.whatsapp.net'),
      lid: LID,
      name: 'Tester',
    },
    ev: new EventEmitter(),
    end() {},
    async sendMessage(jid, content) {
      return {
        key: { remoteJid: jid, fromMe: true, id: 'sent-1' },
        message: content.text
          ? { conversation: content.text }
          : { audioMessage: {} },
        messageTimestamp: 1795520000,
        status: 2,
      };
    },
    async groupFetchAllParticipating() {
      return {
        [GROUP]: {
          id: GROUP,
          subject: 'Group',
          participants: [{ id: PN, admin: 'admin' }],
          announce: false,
        },
      };
    },
    async groupMetadata() {
      return {
        id: GROUP,
        announce: false,
        participants: [{ id: PN, admin: 'admin' }],
      };
    },
    async readMessages() {},
    async groupSettingUpdate() {},
    async groupAcceptInvite() {},
    async groupLeave() {},
    async chatModify() {},
    async groupGetInviteInfo() {
      return { id: GROUP };
    },
    async sendPresenceUpdate() {},
  });
  const account = new ProtocolAccount({
    createSocket: () => {
      const sock = build();
      sockets.push(sock);
      return sock;
    },
    credentials: async () => ({
      state: { creds: { me: { id: PN } } },
      saveCreds: async () => {
        authSaves++;
      },
    }),
    qrImage: async () => 'data:image/png;base64,secret',
    persist: async data => {
      writes.push(structuredClone(data));
    },
    load: async () => null,
    emit: state => updates.push(structuredClone(state)),
    logger: {},
    sleep: async () => {},
    reconnect: fn => {
      timers.push(fn);
      return fn;
    },
    cancel: fn => {
      const index = timers.indexOf(fn);
      if (index >= 0) timers.splice(index, 1);
    },
    ...extra,
  });
  const open = async () => {
    await account.initialize();
    await account.start();
    sockets.at(-1).ev.emit('connection.update', { connection: 'open' });
    await tick();
  };
  return {
    account,
    sockets,
    updates,
    writes,
    timers,
    open,
    authSaves: () => authSaves,
  };
}
const msg = (id = 'm1', text = 'hello', fromMe = false) => ({
  key: { id, remoteJid: JID.replace('@c.us', '@s.whatsapp.net'), fromMe },
  message: { conversation: text },
  messageTimestamp: 1795520000,
  status: 2,
});
test('normalize PN device identity and preserve opaque LID', () => {
  assert.equal(normalizeJid('5511999999999:2@s.whatsapp.net'), PN);
  assert.equal(normalizeJid(LID), LID);
  assert.equal(wireJid(PN), '5511999999999@s.whatsapp.net');
});
test('matching retains original exact, contains, punctuation and emoji rules', () => {
  assert(
    matchesText('你好， 世界！', { text: '你好世界', match: 'normalized' }),
  );
  assert(matchesText('a\r\nb', { text: 'a\nb', match: 'exact' }));
  assert(matchesText('❤️', { text: '❤', match: 'exact' }));
  assert(!matchesText('anything', { text: '!!!', match: 'normalized' }));
  assert(!matchesText('hello', { text: 'hell', match: 'exact' }));
  assert(matchesText('hello', { text: 'hell', match: 'contains' }));
});
test('duplicate start yields one socket and requires connection before sending', async () => {
  const f = fixture();
  await Promise.all([f.account.start(), f.account.start()]);
  assert.equal(f.sockets.length, 1);
  await assert.rejects(
    f.account.send(JID, { text: 'test', type: 'text' }),
    /尚未连接/,
  );
});
test('QR, live owner aliases and sync event counters remain distinct', async () => {
  const f = fixture();
  await f.account.start();
  const ev = f.sockets[0].ev;
  ev.emit('connection.update', { qr: 'secret' });
  await tick();
  assert.equal(f.account.state.status, 'qr');
  ev.emit('connection.update', { connection: 'open' });
  assert.equal(f.account.state.ownerId, PN);
  assert.deepEqual(f.account.state.ownerIds, [PN, LID]);
  assert.equal(f.account.state.qr, null);
  ev.emit('messaging-history.set', {
    messages: [msg()],
    chats: [],
    contacts: [],
  });
  assert.equal(f.account.state.syncEvents, 1);
  assert.equal(f.account.listMessages(JID).length, 1);
  await f.account.saving;
});
test('late QR cannot overwrite connected state or resurrect stopped session', async () => {
  let done;
  const f = fixture({
    qrImage: () =>
      new Promise(resolve => {
        done = resolve;
      }),
  });
  await f.account.start();
  f.sockets[0].ev.emit('connection.update', { qr: 'secret' });
  f.sockets[0].ev.emit('connection.update', { connection: 'open' });
  done('secret');
  await tick();
  assert.equal(f.account.state.qr, null);
  f.account.stop();
  f.sockets[0].ev.emit('connection.update', { connection: 'open' });
  assert.equal(f.account.state.status, 'stopped');
});
test('pairing restart persists credentials and does not retry logged out sessions', async () => {
  const f = fixture();
  await f.account.start();
  f.sockets[0].ev.emit('creds.update', {});
  f.sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 515 } } },
  });
  f.timers.shift()();
  await tick();
  assert.equal(f.authSaves(), 1);
  assert.equal(f.sockets.length, 2);
  f.sockets[1].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } },
  });
  assert.equal(f.timers.length, 0);
  assert.equal(f.account.state.status, 'logged-out');
});
test('three retries maximum and stop cancels a scheduled connection', async () => {
  const f = fixture();
  await f.account.start();
  for (let i = 0; i < 4; i++) {
    f.sockets.at(-1).ev.emit('connection.update', { connection: 'close' });
    if (i < 3) {
      f.timers.shift()();
      await tick();
    }
  }
  assert.equal(f.sockets.length, 4);
  assert.equal(f.account.running, false);
  const g = fixture();
  await g.account.start();
  g.sockets[0].ev.emit('connection.update', { connection: 'close' });
  const callback = g.timers[0];
  g.account.stop();
  callback();
  await tick();
  assert.equal(g.sockets.length, 1);
});
test('contacts, group chats, archived chats and message order are preserved', async () => {
  const f = fixture();
  await f.open();
  const ev = f.sockets[0].ev;
  ev.emit('contacts.upsert', [{ id: JID, name: 'Contact' }]);
  ev.emit('chats.upsert', [
    { id: JID, archived: true },
    { id: GROUP, name: 'Group' },
  ]);
  ev.emit('messages.upsert', {
    type: 'notify',
    messages: [msg('new'), msg('old')],
  });
  assert.equal(f.account.recipients('contact')[0].name, 'Contact');
  assert.equal(
    f.account.recipients('all').find(row => row.id === JID).archived,
    true,
  );
  assert.equal(f.account.state.status, 'connected');
  await f.account.saving;
});
test('message notifications deduplicate unread counts and exclude fromMe', async () => {
  const f = fixture();
  await f.open();
  const ev = f.sockets[0].ev;
  ev.emit('messages.upsert', {
    type: 'notify',
    messages: [msg(), msg(), msg('own', 'mine', true)],
  });
  assert.equal(f.account.chats.get(JID).unread, 1);
  await f.account.read(JID);
  assert.equal(f.account.chats.get(JID).unread, 0);
  await f.account.saving;
});
test('owner mismatch rejects actions before network mutations', async () => {
  const f = fixture();
  await f.open();
  await assert.rejects(
    f.account.send(
      JID,
      { type: 'text', text: 'x' },
      undefined,
      '5511111111111@c.us',
    ),
    /身份已变化/,
  );
  await assert.rejects(f.account.groups('5511111111111@c.us'), /身份已变化/);
});
test('new owner clears old cached messages, contacts and pending operations', async () => {
  const f = fixture({
    load: async () => ({
      identity: {
        ownerId: '5511111111111@c.us',
        ownerIds: ['5511111111111@c.us'],
      },
      chats: [{ id: JID, name: 'OLD' }],
      contacts: [{ id: JID, name: 'OLD' }],
      messages: [[JID, [msg()]]],
      pendingGroups: [['old', { submitted: true }]],
    }),
  });
  await f.open();
  assert.equal(f.account.messages.size, 0);
  assert.equal(f.account.chats.size, 0);
  assert.equal(f.account.contacts.size, 0);
  assert.equal(f.account.pendingGroups.size, 0);
});
test('same owner restores messages after independent account initialization', async () => {
  const first = fixture();
  await first.open();
  first.account.upsertMessage(msg());
  await first.account.flush();
  const saved = first.writes.at(-1);
  const second = fixture({ load: async () => saved });
  await second.open();
  assert.equal(second.account.listMessages(JID)[0].text, 'hello');
});
test('text sends are single submission with server ACK and stored message identity', async () => {
  const f = fixture();
  await f.open();
  let calls = 0;
  const send = f.sockets[0].sendMessage;
  f.sockets[0].sendMessage = async (...args) => {
    calls++;
    return send(...args);
  };
  const result = await f.account.send(
    JID,
    { type: 'text', text: 'one' },
    undefined,
    PN,
  );
  assert.equal(calls, 1);
  assert.equal(result.confirmed, true);
  assert.equal(f.account.listMessages(JID)[0].id, 'sent-1');
});
test('server timeout remains uncertain; no retry or invented message ID', async () => {
  const f = fixture();
  await f.open();
  let calls = 0;
  f.sockets[0].sendMessage = async () => {
    calls++;
    throw Error('private failure');
  };
  const result = await f.account.send(
    JID,
    { type: 'text', text: 'x' },
    undefined,
    PN,
  );
  assert.equal(result.confirmed, false);
  assert.equal(result.messageId, '');
  assert.equal(result.halt, true);
  assert.equal(calls, 1);
});
test('a returned ID without an ACK remains uncertain until read-only reconciliation', async () => {
  const f = fixture();
  await f.open();
  f.account.receipt = async () => false;
  const send = f.sockets[0].sendMessage;
  f.sockets[0].sendMessage = async (...args) => ({
    ...(await send(...args)),
    status: 1,
  });
  const result = await f.account.send(
    JID,
    { type: 'text', text: 'x' },
    undefined,
    PN,
  );
  assert.equal(result.messageId, 'sent-1');
  assert.equal(result.confirmed, false);
  assert.equal((await f.account.reconcile(JID, 'sent-1', PN)).confirmed, false);
  f.sockets[0].ev.emit('messages.update', [
    { key: { remoteJid: JID, id: 'sent-1' }, update: { status: 2 } },
  ]);
  assert.equal((await f.account.reconcile(JID, 'sent-1', PN)).confirmed, true);
  await f.account.saving;
});
test('Chinese blocking and malformed media fail before submission', async () => {
  const f = fixture();
  await f.open();
  let calls = 0;
  f.sockets[0].sendMessage = async () => {
    calls++;
  };
  await assert.rejects(
    f.account.send(JID, { type: 'text', text: '中文' }, undefined, PN, true),
    /禁止发送中文/,
  );
  await assert.rejects(
    f.account.send(JID, { type: 'audio', text: '' }, undefined, PN),
    /附件不可用/,
  );
  assert.equal(calls, 0);
});
test('quoted message matches original exact ID rather than duplicate later text', async () => {
  const f = fixture();
  await f.open();
  f.account.upsertMessage(msg('first', 'same'));
  f.account.upsertMessage(msg('second', 'same'));
  let quoted;
  f.sockets[0].sendMessage = async (jid, content, options) => {
    quoted = options.quoted;
    return {
      ...msg('reply'),
      key: { remoteJid: jid, id: 'reply', fromMe: true },
      status: 2,
    };
  };
  await f.account.send(
    JID,
    {
      type: 'text',
      text: 'answer',
      reply: { text: 'same', match: 'exact' },
      quotedId: 'first',
    },
    undefined,
    PN,
  );
  assert.equal(quoted.key.id, 'first');
});
test('mention all uses server participants and typing status finishes before sending', async () => {
  const f = fixture();
  await f.open();
  const events = [];
  f.sockets[0].sendPresenceUpdate = async type => events.push(type);
  let content;
  const send = f.sockets[0].sendMessage;
  f.sockets[0].sendMessage = async (jid, value, ...args) => {
    events.push('send');
    content = value;
    return send(jid, value, ...args);
  };
  await f.account.send(
    GROUP,
    { type: 'text', text: 'hi', mentionAll: true, typingSeconds: 2 },
    undefined,
    PN,
  );
  assert.deepEqual(events, ['composing', 'paused', 'send']);
  assert.equal(content.mentions.length, 1);
});
test('attachment and contact content retain type, caption and voice flag', async () => {
  const f = fixture();
  await f.open();
  const sent = [];
  f.sockets[0].sendMessage = async (jid, content) => {
    sent.push(content);
    return {
      ...msg(),
      key: { remoteJid: jid, id: String(sent.length), fromMe: true },
      status: 2,
    };
  };
  const media = {
    buffer: Buffer.from('test'),
    name: 'a.ogg',
    mime: 'audio/ogg; codecs=opus',
  };
  for (const type of ['image', 'caption', 'video', 'audio', 'document'])
    await f.account.send(JID, { type, text: 'caption' }, media, PN);
  assert.equal(sent[0].caption, 'caption');
  assert.equal(sent[3].ptt, true);
  assert.equal(sent[4].fileName, 'a.ogg');
  await f.account.send(
    JID,
    {
      type: 'contact',
      text: '',
      contactPhone: '5511888888888',
      contactName: 'Test',
    },
    undefined,
    PN,
  );
  assert(sent[5].contacts.contacts[0].vcard.includes('FN:Test'));
});
test('edit and revoke require a confirmed own message key', async () => {
  const f = fixture();
  await f.open();
  f.account.upsertMessage(msg());
  await assert.rejects(f.account.revoke(JID, 'm1', PN), /本人消息/);
  await assert.rejects(f.account.edit(JID, 'm1', 'new', PN), /本人消息/);
  f.account.upsertMessage(msg('own', 'mine', true));
  let payload;
  f.sockets[0].sendMessage = async (_jid, content) => {
    payload = content;
  };
  await f.account.edit(JID, 'own', 'changed', PN);
  assert.equal(payload.edit.id, 'own');
  await f.account.revoke(JID, 'own', PN);
  assert.equal(payload.delete.id, 'own');
});
test('group speech verifies state and does not rewrite a matching setting', async () => {
  const f = fixture();
  await f.open();
  let writes = 0;
  f.sockets[0].groupSettingUpdate = async () => {
    writes++;
  };
  const task = { id: 'task', ownerId: PN, target: GROUP, operation: 'open' };
  assert.equal((await f.account.groupOperation(task, true)).status, 'success');
  assert.equal(writes, 0);
});
test('group pending join is not submitted twice after restart', async () => {
  const f = fixture();
  await f.open();
  f.sockets[0].groupFetchAllParticipating = async () => ({});
  let joined = 0;
  f.sockets[0].groupAcceptInvite = async () => {
    joined++;
    return GROUP;
  };
  const task = {
    id: 'join',
    ownerId: PN,
    target: 'ABCDEFGHIJKLMNOPQRSTUV',
    operation: 'join',
  };
  assert.equal((await f.account.groupOperation(task, true)).submitted, true);
  assert.equal((await f.account.groupOperation(task, true)).submitted, true);
  assert.equal(joined, 1);
  const saved = f.writes.at(-1);
  const g = fixture({ load: async () => saved });
  await g.open();
  g.sockets[0].groupFetchAllParticipating = async () => ({});
  g.sockets[0].groupAcceptInvite = async () => {
    joined++;
  };
  await g.account.groupOperation(task, true);
  assert.equal(joined, 1);
});
test('group rate limits preserve cooldown and never report success', async () => {
  const f = fixture();
  await f.open();
  f.sockets[0].groupFetchAllParticipating = async () => {
    throw { output: { statusCode: 429 } };
  };
  const result = await f.account.groupOperation(
    { id: 'limited', ownerId: PN, target: GROUP, operation: 'leave' },
    true,
  );
  assert.equal(result.rateLimited, true);
  assert.equal(result.submitted, false);
  assert.notEqual(result.status, 'success');
});
test('slow group request has one in-flight mutation and no duplicate submission', async () => {
  const f = fixture();
  await f.open();
  let release;
  f.sockets[0].groupFetchAllParticipating = () =>
    new Promise(resolve => {
      release = resolve;
    });
  const task = {
    id: 'pending',
    ownerId: PN,
    target: GROUP,
    operation: 'leave',
  };
  const first = f.account.groupOperation(task, true);
  await tick();
  const second = await f.account.groupOperation(task, true);
  assert.equal(second.inFlight, true);
  release({});
  await first;
});
test('readonly diagnostics exclude identities, QR and text', async () => {
  const f = fixture();
  await f.open();
  f.account.upsertMessage(msg('private-id', 'private text'));
  const data = JSON.stringify(f.account.diagnostics());
  for (const secret of [PN, LID, 'private text', 'private-id', 'secret'])
    assert(!data.includes(secret));
});
test('delete and reaction events update stored state instead of inventing confirmations', async () => {
  const f = fixture();
  await f.open();
  f.account.upsertMessage(msg());
  const ev = f.sockets[0].ev;
  ev.emit('messages.reaction', [
    {
      key: { remoteJid: JID, id: 'm1' },
      reaction: { key: { fromMe: true }, text: '👍' },
    },
  ]);
  assert.equal(f.account.messages.get(JID)[0].reactions[0].text, '👍');
  ev.emit('messages.delete', { keys: [{ remoteJid: JID, id: 'm1' }] });
  assert.equal(f.account.listMessages(JID).length, 0);
  ev.emit('chats.delete', [JID]);
  assert.equal(f.account.chats.has(JID), false);
  await f.account.saving;
});
test('a repeated send operation token never submits twice, including after process restoration', async () => {
  const f = fixture();
  await f.open();
  let calls = 0;
  f.sockets[0].sendMessage = async () => {
    calls++;
    throw Error('timeout');
  };
  const spec = { type: 'text', text: 'test', operationToken: 'fixed-op' };
  await f.account.send(JID, spec, undefined, PN);
  await f.account.send(JID, spec, undefined, PN);
  assert.equal(calls, 1);
  const saved = f.writes.at(-1);
  const g = fixture({ load: async () => saved });
  await g.open();
  g.sockets[0].sendMessage = async () => {
    calls++;
  };
  await g.account.send(JID, spec, undefined, PN);
  assert.equal(calls, 1);
});
test('late message result from a previous session never enters the newly logged account cache', async () => {
  const f = fixture();
  await f.open();
  let finish;
  f.sockets[0].sendMessage = () =>
    new Promise(resolve => {
      finish = resolve;
    });
  const pending = f.account.send(
    JID,
    { type: 'text', text: 'test' },
    undefined,
    PN,
  );
  await tick();
  f.account.stop();
  f.account.state.ownerId = '5511666666666@c.us';
  f.account.state.ownerIds = ['5511666666666@c.us'];
  finish({
    ...msg('late', 'old'),
    key: { remoteJid: JID, id: 'late', fromMe: true },
  });
  const result = await pending;
  assert.equal(result.confirmed, false);
  assert.equal(f.account.messages.size, 0);
});
test('approval-required joins stay in approval state and never resubmit while waiting', async () => {
  const f = fixture();
  await f.open();
  f.sockets[0].groupFetchAllParticipating = async () => ({});
  f.sockets[0].groupGetInviteInfo = async () => ({
    id: GROUP,
    joinApprovalMode: true,
  });
  let submitted = 0;
  f.sockets[0].groupAcceptInvite = async () => {
    submitted++;
    return GROUP;
  };
  const task = {
    id: 'approve',
    ownerId: PN,
    target: 'ABCDEFGHIJKLMNOPQRSTUV',
    operation: 'join',
  };
  assert.equal((await f.account.groupOperation(task, true)).status, 'approval');
  assert.equal((await f.account.groupOperation(task, true)).status, 'approval');
  assert.equal(submitted, 1);
});
test('cached session flags cannot manufacture a live connection or overwrite state fields', async () => {
  const f = fixture({
    load: async () => ({
      identity: {
        ownerId: PN,
        ownerIds: [PN],
        status: 'connected',
        qr: 'secret',
        nickname: 'Cached',
      },
      chats: [],
      messages: [],
    }),
  });
  await f.account.initialize();
  assert.equal(f.account.state.status, 'idle');
  assert.equal(f.account.state.qr, null);
  await assert.rejects(
    f.account.send(JID, { text: 'x', type: 'text' }),
    /尚未连接/,
  );
});
test('corrupt cache remains untouched and prevents silent replacement', async () => {
  const f = fixture({ load: async () => ({ bad: 'data' }) });
  await assert.rejects(f.account.initialize(), /缓存格式异常/);
  assert.equal(f.writes.length, 0);
});
