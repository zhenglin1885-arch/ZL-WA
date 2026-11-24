import { randomUUID } from 'node:crypto';
export const normalizeJid = value =>
  String(value || '')
    .replace(/:\d+@/, '@')
    .replace(/@s\.whatsapp\.net$/, '@c.us');
export const wireJid = value =>
  normalizeJid(value).replace(/@c\.us$/, '@s.whatsapp.net');
export const validJid = value =>
  typeof value === 'string' &&
  /^(?:\d{5,30}@(c\.us|lid)|\d{1,40}(?:-\d{1,30})?@g\.us)$/.test(value);
export function messageText(message) {
  const content =
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message ||
    {};
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  );
}
export function messageKind(message) {
  const content =
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message ||
    {};
  for (const [name, kind] of [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
    ['contactMessage', 'contact'],
  ])
    if (content[name]) return kind;
  return 'text';
}
export const visibleText = text =>
  String(text)
    .normalize('NFC')
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/[\u2028\u2029]/g, '\n')
    .replaceAll(/[\u00A0\u202F]/g, ' ')
    .replaceAll(
      /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g,
      '',
    )
    .replaceAll('\uFE0E', '')
    .replaceAll('\uFE0F', '')
    .trim();
export function matchesText(input, rule) {
  const text = visibleText(input),
    wanted = visibleText(rule.text);
  if (!wanted) return false;
  if (rule.match === 'contains') return text.includes(wanted);
  if (rule.match === 'normalized') {
    const normalize = value =>
      value.normalize('NFKC').replaceAll(/[\p{P}\p{Z}\s]/gu, '');
    return Boolean(normalize(wanted)) && normalize(text) === normalize(wanted);
  }
  return text.replaceAll('\r\n', '\n') === wanted.replaceAll('\r\n', '\n');
}
export class ProtocolAccount {
  constructor({
    createSocket,
    credentials,
    qrImage,
    persist,
    load,
    emit,
    logger,
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    clock = Date.now,
    reconnect = setTimeout,
    cancel = clearTimeout,
  }) {
    Object.assign(this, {
      createSocket,
      credentials,
      qrImage,
      persist,
      load,
      emit,
      logger,
      sleep,
      clock,
      reconnect,
      cancel,
    });
    this.state = {
      status: 'idle',
      qr: null,
      syncEvents: 0,
      nickname: '',
      ownerId: '',
      ownerIds: [],
      phone: '',
      error: '',
    };
    this.chats = new Map();
    this.contacts = new Map();
    this.messages = new Map();
    this.mutations = new Map();
    this.pendingGroups = new Map();
    this.operations = new Map();
    this.ackWaiters = new Map();
    this.listeners = [];
    this.generation = 0;
    this.running = false;
    this.attempts = 0;
    this.dirty = false;
    this.saving = Promise.resolve();
    this.authSaves = Promise.resolve();
  }
  changed() {
    this.emit(this.snapshot());
  }
  snapshot() {
    return {
      ...this.state,
      chats: [...this.chats.values()]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 2000),
    };
  }
  async initialize() {
    const saved = await this.load();
    if (saved === null || saved === undefined) return;
    if (
      !saved ||
      typeof saved !== 'object' ||
      !Array.isArray(saved.chats) ||
      !Array.isArray(saved.messages)
    )
      throw Error('消息缓存格式异常，保留原文件并停止初始化');
    if (saved.identity?.ownerId) {
      const identity = saved.identity;
      if (
        !validJid(identity.ownerId) ||
        identity.ownerId.endsWith('@g.us') ||
        !Array.isArray(identity.ownerIds) ||
        identity.ownerIds.length > 2 ||
        !identity.ownerIds.every(validJid)
      )
        throw Error('缓存账号身份格式异常');
      this.state.ownerId = identity.ownerId;
      this.state.ownerIds = [...identity.ownerIds];
      this.state.nickname =
        typeof identity.nickname === 'string'
          ? identity.nickname.slice(0, 100)
          : '';
      this.state.phone =
        typeof identity.phone === 'string' ? identity.phone : '';
    }
    for (const row of saved.chats || [])
      if (validJid(row.id)) this.chats.set(row.id, row);
    for (const row of saved.contacts || [])
      if (validJid(row.id)) this.contacts.set(row.id, row);
    for (const [jid, messages] of saved.messages || [])
      if (validJid(jid) && Array.isArray(messages))
        this.messages.set(jid, messages.slice(-300));
    for (const [id, value] of saved.pendingGroups || [])
      this.pendingGroups.set(id, value);
  }
  flush() {
    this.saving = this.saving.then(() =>
      this.persist({
        identity: {
          ownerId: this.state.ownerId,
          ownerIds: this.state.ownerIds,
          nickname: this.state.nickname,
          phone: this.state.phone,
        },
        chats: [...this.chats.values()].slice(0, 4000),
        contacts: [...this.contacts.values()].slice(0, 10000),
        messages: [...this.messages],
        pendingGroups: [...this.pendingGroups],
      }),
    );
    return this.saving;
  }
  upsertChat(chat) {
    const id = normalizeJid(chat.id);
    if (!validJid(id)) return;
    const previous = this.chats.get(id) || {
      id,
      name: id.split('@')[0],
      group: id.endsWith('@g.us'),
      unread: 0,
      timestamp: 0,
    };
    const name =
      chat.name || chat.subject || this.contacts.get(id)?.name || previous.name;
    this.chats.set(id, {
      ...previous,
      name,
      ...(chat.archived !== undefined
        ? { archived: Boolean(chat.archived) }
        : {}),
      ...(chat.unreadCount !== undefined
        ? { unread: Math.max(0, Number(chat.unreadCount) || 0) }
        : {}),
      timestamp: Number(
        chat.conversationTimestamp || chat.timestamp || previous.timestamp || 0,
      ),
    });
  }
  upsertMessage(raw, notify = false) {
    const id = normalizeJid(raw.key?.remoteJid);
    if (!validJid(id) || !raw.key?.id || !raw.message) return;
    this.upsertChat({ id });
    const rows = this.messages.get(id) || [];
    const found = rows.findIndex(row => row.key.id === raw.key.id);
    if (found >= 0) rows[found] = { ...rows[found], ...raw };
    else rows.push(raw);
    rows.sort(
      (a, b) =>
        Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0),
    );
    this.messages.set(id, rows.slice(-300));
    const chat = this.chats.get(id);
    const timestamp = Number(raw.messageTimestamp || 0);
    if (timestamp >= chat.timestamp) {
      chat.timestamp = timestamp;
      chat.lastText =
        messageText(raw.message).slice(0, 160) ||
        `[${messageKind(raw.message)}]`;
    }
    if (notify && found < 0 && !raw.key.fromMe) chat.unread++;
    const count = [...this.messages.values()].reduce(
      (total, messages) => total + messages.length,
      0,
    );
    if (count > 20000) {
      const oldest = [...this.chats.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .find(row => row.id !== id && this.messages.has(row.id));
      if (oldest) this.messages.delete(oldest.id);
    }
  }
  assertOwner(owner) {
    if (this.state.status !== 'connected' || !this.socket)
      throw Error('账号尚未连接');
    if (owner && !this.state.ownerIds.includes(normalizeJid(owner)))
      throw Error('账号登录身份已变化，请重新选择');
  }
  async start(network) {
    if (this.running) return;
    await this.authSaves;
    this.running = true;
    this.attempts = 0;
    this.network = network;
    try {
      await this.connect();
    } catch {
      this.running = false;
      this.state.status = 'error';
      this.state.error = '连接启动失败，请复制诊断';
      this.changed();
    }
  }
  async connect() {
    const generation = ++this.generation;
    this.state.status = 'connecting';
    this.state.error = '';
    this.state.qr = null;
    this.changed();
    await this.authSaves;
    const { state: auth, saveCreds } = await this.credentials();
    if (!this.running || this.generation !== generation) return;
    const sock = this.createSocket(
      {
        auth,
        logger: this.logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        getMessage: async key =>
          this.messages
            .get(normalizeJid(key.remoteJid))
            ?.find(row => row.key.id === key.id)?.message,
      },
      this.network,
    );
    this.socket = sock;
    const current = () => this.running && this.generation === generation;
    const failStorage = () => {
      if (current()) {
        this.stop();
        this.state.status = 'error';
        this.state.error = '登录或消息资料保存失败，已停止连接';
        this.changed();
      }
    };
    const saveLater = () => {
      this.flush().catch(failStorage);
    };
    sock.ev.on('creds.update', () => {
      this.authSaves = this.authSaves.then(saveCreds).catch(failStorage);
    });
    sock.ev.on('connection.update', async update => {
      if (!current()) return;
      if (update.qr) {
        const token = update.qr;
        this.qrToken = token;
        try {
          const image = await this.qrImage(token);
          if (
            current() &&
            this.qrToken === token &&
            this.state.status !== 'connected'
          ) {
            this.state.status = 'qr';
            this.state.qr = image;
            this.changed();
          }
        } catch {
          if (current()) {
            this.state.error = '二维码生成失败';
            this.changed();
          }
        }
      }
      if (update.connection === 'open') {
        this.qrToken = null;
        const pn = normalizeJid(sock.user?.id || auth.creds.me?.id);
        const lid = normalizeJid(sock.user?.lid || auth.creds.me?.lid);
        const owners = [...new Set([pn, lid].filter(validJid))];
        if (this.state.ownerId && !owners.includes(this.state.ownerId)) {
          this.chats.clear();
          this.contacts.clear();
          this.messages.clear();
          this.pendingGroups.clear();
        }
        this.state = {
          ...this.state,
          status: 'connected',
          qr: null,
          ownerId: pn,
          ownerIds: owners,
          nickname: sock.user?.name || auth.creds.me?.name || '',
          phone: pn.endsWith('@c.us') ? pn.split('@')[0] : '',
          error: '',
        };
        this.changed();
        saveLater();
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        this.socket = null;
        this.qrToken = null;
        this.state.qr = null;
        this.state.status = code === 401 ? 'logged-out' : 'disconnected';
        this.state.lastCode = Number.isInteger(code) ? code : null;
        this.changed();
        if ([401, 403, 440, 411, 500].includes(code) || this.attempts >= 3) {
          this.running = false;
          return;
        }
        this.attempts++;
        this.state.status = 'reconnecting';
        this.changed();
        this.retry = this.reconnect(
          () => {
            if (current())
              this.connect().catch(() => {
                if (current()) {
                  this.running = false;
                  this.state.status = 'error';
                  this.changed();
                }
              });
          },
          code === 515 ? 1000 : 2000 * this.attempts,
        );
      }
    });
    sock.ev.on('messaging-history.set', data => {
      if (!current()) return;
      for (const contact of data.contacts || []) this.upsertContact(contact);
      for (const chat of data.chats || []) this.upsertChat(chat);
      for (const message of data.messages || []) this.upsertMessage(message);
      this.state.syncEvents++;
      this.changed();
      saveLater();
    });
    for (const event of ['contacts.upsert', 'contacts.update'])
      sock.ev.on(event, rows => {
        if (!current()) return;
        for (const row of rows) this.upsertContact(row);
        this.changed();
        saveLater();
      });
    for (const event of ['chats.upsert', 'chats.update'])
      sock.ev.on(event, rows => {
        if (!current()) return;
        for (const row of rows) this.upsertChat(row);
        this.changed();
        saveLater();
      });
    sock.ev.on('messages.upsert', data => {
      if (!current()) return;
      for (const message of data.messages || [])
        this.upsertMessage(message, data.type === 'notify');
      this.changed();
      saveLater();
    });
    sock.ev.on('chats.delete', ids => {
      if (!current()) return;
      for (const id of ids) {
        this.chats.delete(normalizeJid(id));
        this.messages.delete(normalizeJid(id));
      }
      this.changed();
      saveLater();
    });
    sock.ev.on('messages.delete', data => {
      if (!current()) return;
      if (data.all && data.jid) this.messages.delete(normalizeJid(data.jid));
      else
        for (const key of data.keys || []) {
          const jid = normalizeJid(key.remoteJid);
          this.messages.set(
            jid,
            (this.messages.get(jid) || []).filter(row => row.key.id !== key.id),
          );
        }
      this.changed();
      saveLater();
    });
    sock.ev.on('messages.reaction', rows => {
      if (!current()) return;
      for (const { key, reaction } of rows) {
        const row = this.messages
          .get(normalizeJid(key.remoteJid))
          ?.find(message => message.key.id === key.id);
        if (row) {
          row.reactions = (row.reactions || []).filter(
            r =>
              normalizeJid(r.key?.participant) !==
                normalizeJid(reaction.key?.participant) ||
              Boolean(r.key?.fromMe) !== Boolean(reaction.key?.fromMe),
          );
          row.reactions.push(reaction);
        }
      }
      this.changed();
      saveLater();
    });
    sock.ev.on('message-receipt.update', rows => {
      if (!current()) return;
      for (const { key, receipt } of rows) {
        const row = this.messages
          .get(normalizeJid(key.remoteJid))
          ?.find(message => message.key.id === key.id);
        if (row) {
          if (receipt.readTimestamp)
            row.status = Math.max(Number(row.status || 0), 4);
          else if (receipt.receiptTimestamp)
            row.status = Math.max(Number(row.status || 0), 3);
        }
      }
      this.changed();
      saveLater();
    });
    sock.ev.on('groups.update', rows => {
      if (!current()) return;
      for (const row of rows) this.upsertChat(row);
      this.changed();
      saveLater();
    });
    sock.ev.on('messages.update', rows => {
      if (!current()) return;
      for (const { key, update } of rows) {
        const message = this.messages
          .get(normalizeJid(key.remoteJid))
          ?.find(row => row.key.id === key.id);
        if (message) Object.assign(message, update);
        if (Number(update.status) >= 2) this.ackWaiters.get(key.id)?.();
      }
      this.changed();
      saveLater();
    });
  }
  upsertContact(row) {
    const id = normalizeJid(row.id);
    if (!validJid(id)) return;
    const contact = {
      ...this.contacts.get(id),
      id,
      name:
        row.name ||
        row.notify ||
        this.contacts.get(id)?.name ||
        id.split('@')[0],
    };
    this.contacts.set(id, contact);
    if (this.chats.has(id)) this.upsertChat({ id, name: contact.name });
  }
  stop() {
    this.running = false;
    this.generation++;
    this.qrToken = null;
    if (this.retry) this.cancel(this.retry);
    this.socket?.end(undefined);
    this.socket = null;
    this.state.status = 'stopped';
    this.state.qr = null;
    this.changed();
  }
  listMessages(jid) {
    if (!validJid(jid)) throw Error('无效聊天编号');
    return (this.messages.get(jid) || []).slice(-200).map(row => ({
      id: row.key.id,
      jid,
      fromMe: Boolean(row.key.fromMe),
      participant: normalizeJid(row.key.participant),
      text: messageText(row.message),
      kind: messageKind(row.message),
      timestamp: Number(row.messageTimestamp || 0),
      status: Number(row.status || 0),
    }));
  }
  recipients(kind) {
    this.assertOwner();
    if (kind === 'contact')
      return [...this.contacts.values()]
        .filter(row => !row.id.endsWith('@g.us'))
        .map(row => ({
          ...row,
          group: false,
          contact: true,
          contactOnly: !this.chats.has(row.id),
        }));
    return [...this.chats.values()].map(row => ({
      id: row.id,
      name: row.name,
      group: row.group,
      archived: Boolean(row.archived),
      contact: this.contacts.has(row.id),
    }));
  }
  async groups(owner) {
    this.assertOwner(owner);
    const values = await this.socket.groupFetchAllParticipating();
    const rows = Object.values(values);
    for (const row of rows) this.upsertChat(row);
    this.changed();
    await this.flush();
    return rows.map(row => ({
      id: normalizeJid(row.id),
      name: row.subject || row.id,
      announce: Boolean(row.announce),
      admin: (row.participants || []).some(
        p =>
          this.state.ownerIds.includes(normalizeJid(p.id)) &&
          ['admin', 'superadmin'].includes(p.admin),
      ),
    }));
  }
  async read(jid) {
    this.assertOwner();
    if (!validJid(jid)) throw Error('无效聊天编号');
    const keys = (this.messages.get(jid) || [])
      .filter(row => !row.key.fromMe)
      .slice(-100)
      .map(row => row.key);
    const knownBefore = new Set(
      (this.messages.get(jid) || []).map(row => row.key.id),
    );
    if (keys.length) await this.socket.readMessages(keys);
    else if (this.chats.get(jid)?.unread)
      throw Error('当前聊天尚未同步可核验的消息，请稍后刷新');
    if (this.chats.has(jid))
      this.chats.get(jid).unread = (this.messages.get(jid) || []).filter(
        row => !row.key.fromMe && !knownBefore.has(row.key.id),
      ).length;
    this.changed();
    await this.flush();
    return true;
  }
  async receipt(jid, id) {
    const row = this.messages.get(jid)?.find(row => row.key.id === id);
    if (Number(row?.status) >= 2) return true;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.ackWaiters.delete(id);
        resolve(false);
      }, 10000);
      this.ackWaiters.set(id, () => {
        clearTimeout(timer);
        this.ackWaiters.delete(id);
        resolve(true);
      });
    });
  }
  async send(jid, spec, media, owner, blockChinese = false) {
    this.assertOwner(owner);
    if (!validJid(jid)) throw Error('无效收件人');
    if (!spec || typeof spec.text !== 'string' || spec.text.length > 12000)
      throw Error('无效消息内容');
    if (blockChinese && /\p{Script=Han}/u.test(spec.text))
      throw Error('禁止发送中文');
    const sock = this.socket;
    let quoted;
    if (spec.reply) {
      quoted = [...(this.messages.get(jid) || [])]
        .reverse()
        .find(
          row =>
            (!spec.quotedId || row.key.id === spec.quotedId) &&
            matchesText(messageText(row.message), spec.reply),
        );
      if (!quoted) throw Error('已同步消息中未找到匹配正文，未提交发送');
    }
    let mentions;
    if (spec.mentionAll) {
      if (!jid.endsWith('@g.us')) throw Error('只有群组可以提及所有人');
      mentions = (await sock.groupMetadata(wireJid(jid))).participants.map(
        p => p.id,
      );
    }
    let content;
    if (spec.type === 'text') {
      if (!spec.text.trim()) throw Error('请输入文字');
      content = { text: spec.text, mentions };
    } else if (spec.type === 'contact') {
      if (
        !/^\d{7,15}$/.test(spec.contactPhone || '') ||
        typeof spec.contactName !== 'string' ||
        /[\r\n]/.test(spec.contactName)
      )
        throw Error('无效名片');
      content = {
        contacts: {
          displayName: spec.contactName,
          contacts: [
            {
              vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${spec.contactName}\nTEL;type=CELL;waid=${spec.contactPhone}:+${spec.contactPhone}\nEND:VCARD`,
            },
          ],
        },
      };
    } else {
      if (
        !media ||
        !Buffer.isBuffer(media.buffer) ||
        media.buffer.length > 50 * 1024 * 1024
      )
        throw Error('附件不可用');
      if (['image', 'caption'].includes(spec.type))
        content = {
          image: media.buffer,
          caption: spec.text,
          mimetype: media.mime,
          mentions,
        };
      else if (spec.type === 'video')
        content = {
          video: media.buffer,
          ...(media.thumbnail ? { jpegThumbnail: media.thumbnail } : {}),
          caption: spec.text,
          mimetype: media.mime,
          mentions,
        };
      else if (spec.type === 'audio')
        content = { audio: media.buffer, mimetype: media.mime, ptt: true };
      else if (spec.type === 'document')
        content = {
          document: media.buffer,
          fileName: media.name,
          mimetype: media.mime,
          caption: spec.text,
          mentions,
        };
      else throw Error('无效消息类型');
    }
    const seconds = Number(spec.typingSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30)
      throw Error('无效输入状态时间');
    if (seconds) {
      await sock.sendPresenceUpdate(
        spec.type === 'audio' ? 'recording' : 'composing',
        wireJid(jid),
      );
      await this.sleep(seconds * 1000);
      await sock.sendPresenceUpdate('paused', wireJid(jid));
    }
    if (this.socket !== sock || this.state.status !== 'connected')
      throw Error('账号连接已变化，未提交发送');
    const operation = `send:${spec.operationToken || randomUUID()}`;
    const previous = this.pendingGroups.get(operation);
    if (previous)
      return previous.messageId
        ? this.reconcile(jid, previous.messageId, owner)
        : {
            messageId: '',
            confirmed: false,
            halt: true,
            error: '上一条发送结果尚未确认，未重复提交',
          };
    this.pendingGroups.set(operation, {
      jid,
      owner: this.state.ownerId,
      messageId: '',
      submitted: true,
    });
    await this.flush();
    if (this.socket !== sock || this.state.status !== 'connected')
      throw Error('账号连接已变化，未提交发送');
    let result;
    try {
      result = await sock.sendMessage(
        wireJid(jid),
        content,
        quoted ? { quoted } : {},
      );
    } catch {
      return {
        messageId: '',
        confirmed: false,
        halt: true,
        error: '发送请求结果未知，请先核对聊天记录，未自动重发',
      };
    }
    if (!result?.key?.id)
      return {
        messageId: '',
        confirmed: false,
        halt: true,
        error: '未取得消息编号，请先核对聊天记录，未自动重发',
      };
    if (
      this.socket !== sock ||
      (owner && !this.state.ownerIds.includes(normalizeJid(owner)))
    )
      return {
        messageId: result.key.id,
        confirmed: false,
        halt: true,
        error: '账号连接或身份已变化，结果待核验，未重复发送',
      };
    this.pendingGroups.set(operation, {
      jid,
      owner: this.state.ownerId,
      messageId: result.key.id,
      submitted: true,
    });
    this.upsertMessage(result);
    this.changed();
    await this.flush();
    const confirmed =
      Number(result.status) >= 2 || (await this.receipt(jid, result.key.id));
    return {
      messageId: result.key.id,
      confirmed,
      quotedMessageId: quoted?.key.id,
      ...(!confirmed
        ? {
            halt: true,
            error: '已提交但服务器回执未确认，请稍后核验，未自动重发',
          }
        : {}),
    };
  }
  async reconcile(jid, id, owner) {
    this.assertOwner(owner);
    if (!id)
      return {
        messageId: '',
        confirmed: false,
        halt: true,
        error: '缺少消息编号，请人工核对，不自动重发',
      };
    const confirmed =
      Number(this.messages.get(jid)?.find(row => row.key.id === id)?.status) >=
      2;
    return {
      messageId: id,
      confirmed,
      ...(!confirmed
        ? { halt: true, error: '服务器回执尚未确认，未重发' }
        : {}),
    };
  }
  async edit(jid, id, text, owner, blockChinese) {
    this.assertOwner(owner);
    const row = this.messages.get(jid)?.find(row => row.key.id === id);
    if (
      !row?.key.fromMe ||
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 12000
    )
      throw Error('无法确认本人消息，未提交修改');
    if (blockChinese && /\p{Script=Han}/u.test(text))
      throw Error('禁止发送中文');
    await this.socket.sendMessage(wireJid(jid), { text, edit: row.key });
  }
  async revoke(jid, id, owner) {
    this.assertOwner(owner);
    const row = this.messages.get(jid)?.find(row => row.key.id === id);
    if (!row?.key.fromMe) throw Error('无法确认本人消息，未提交撤回');
    await this.socket.sendMessage(wireJid(jid), { delete: row.key });
  }
  async groupOperation(task, execute) {
    this.assertOwner(task.ownerId);
    const key = `${task.id}:${task.operation}`;
    if (this.operations.has(key))
      return {
        status: 'uncertain',
        message: '请求仍在执行，未重复提交',
        inFlight: true,
        submitted: true,
      };
    const read = async () => {
      let id = task.operation === 'join' ? task.groupId : task.target;
      if (task.operation === 'join' && !id) {
        if (!/^[\w-]{16,64}$/.test(task.target)) throw Error('群邀请链接无效');
        id = (await this.socket.groupGetInviteInfo(task.target)).id;
      }
      id = normalizeJid(id);
      if (!validJid(id) || !id.endsWith('@g.us')) throw Error('群组编号无效');
      if (['join', 'leave'].includes(task.operation)) {
        const groups = await this.socket.groupFetchAllParticipating();
        const member = Object.values(groups).some(
          g => normalizeJid(g.id) === id,
        );
        if (
          task.operation === 'leave' &&
          !member &&
          task.deleteGroup &&
          this.chats.has(id)
        )
          return {
            status: 'not-done',
            message: '已退出，待删除聊天记录',
            groupId: id,
            member: false,
          };
        if (
          (task.operation === 'join' && member) ||
          (task.operation === 'leave' && !member)
        )
          return {
            status: 'success',
            message:
              task.operation === 'join' ? '已确认加入群组' : '已确认退出群组',
            groupId: id,
          };
        if (task.operation === 'join' && this.pendingGroups.get(key)?.approval)
          return {
            status: 'approval',
            message: '等待管理员审批，不重复提交',
            groupId: id,
            submitted: true,
          };
        if (
          task.operation === 'join' &&
          (task.joinSubmitted || this.pendingGroups.has(key))
        )
          return {
            status: 'uncertain',
            message: '进群请求已提交，尚未确认成员状态，不重复申请',
            groupId: id,
            submitted: true,
          };
        return {
          status: 'not-done',
          message: '已确认尚未完成',
          groupId: id,
          member,
        };
      }
      const meta = await this.socket.groupMetadata(wireJid(id));
      if (Boolean(meta.announce) === (task.operation === 'mute'))
        return { status: 'success', message: '已核验群发言权限', groupId: id };
      if (
        !(meta.participants || []).some(
          p =>
            this.state.ownerIds.includes(normalizeJid(p.id)) &&
            ['admin', 'superadmin'].includes(p.admin),
        )
      )
        return {
          status: 'failed',
          message: '当前账号不是群管理员',
          retryable: false,
        };
      return {
        status: 'not-done',
        message: '已读取当前群发言权限',
        groupId: id,
      };
    };
    const work = (async () => {
      try {
        const before = await read();
        if (before.status !== 'not-done' || !execute) return before;
        const approval =
          task.operation === 'join'
            ? Boolean(
                (await this.socket.groupGetInviteInfo(task.target))
                  .joinApprovalMode,
              )
            : false;
        this.pendingGroups.set(key, {
          submitted: true,
          groupId: before.groupId,
          approval,
        });
        await this.flush();
        if (task.operation === 'join')
          await this.socket.groupAcceptInvite(task.target);
        else if (task.operation === 'leave') {
          if (before.member !== false)
            await this.socket.groupLeave(wireJid(before.groupId));
          if (task.deleteGroup) {
            const fresh = await this.socket.groupFetchAllParticipating();
            if (
              Object.values(fresh).some(
                g => normalizeJid(g.id) === before.groupId,
              )
            )
              return {
                status: 'uncertain',
                message: '退出尚未确认，未删除聊天记录',
                submitted: true,
              };
            const last = (this.messages.get(before.groupId) || []).slice(-1);
            if (!last.length)
              return {
                status: 'uncertain',
                message: '已退出，但缺少最后消息，无法核验删除聊天请求',
                submitted: true,
              };
            await this.socket.chatModify(
              {
                delete: true,
                lastMessages: last.map(row => ({
                  key: row.key,
                  messageTimestamp: row.messageTimestamp,
                })),
              },
              wireJid(before.groupId),
            );
            await this.sleep(500);
          }
        } else
          await this.socket.groupSettingUpdate(
            wireJid(before.groupId),
            task.operation === 'mute' ? 'announcement' : 'not_announcement',
          );
        if (approval)
          return {
            status: 'approval',
            message: '进群申请已提交，等待管理员审批，不重复提交',
            groupId: before.groupId,
            submitted: true,
          };
        const after = await read();
        if (after.status === 'success') {
          this.pendingGroups.delete(key);
          await this.flush();
        }
        return after.status === 'success'
          ? after
          : {
              status: 'uncertain',
              message: '请求已提交，等待服务器状态核验，未重复提交',
              groupId: before.groupId,
              submitted: true,
            };
      } catch (error) {
        const code = Number(error?.output?.statusCode);
        const rateLimited =
          code === 429 || /rate.overlimit/i.test(String(error));
        const submitted = this.pendingGroups.has(key);
        if (rateLimited)
          return {
            status: submitted ? 'uncertain' : 'not-done',
            message: 'WhatsApp 请求限流，已暂停此账号，请冷却后核验',
            rateLimited: true,
            submitted,
          };
        if ([400, 403, 404, 406, 410].includes(code) && !submitted)
          return {
            status: 'failed',
            message: '邀请失效或没有操作权限',
            retryable: false,
          };
        return {
          status: 'uncertain',
          message: submitted
            ? '操作可能已提交，请核验状态，未重复提交'
            : '读取群组状态失败，未提交操作',
          submitted,
        };
      }
    })();
    this.operations.set(key, work);
    try {
      return await work;
    } finally {
      this.operations.delete(key);
    }
  }
  diagnostics() {
    return {
      format: 1,
      backend: 'Baileys 7.0.0-rc14',
      status: this.state.status,
      lastCode: this.state.lastCode || null,
      syncEvents: this.state.syncEvents,
      chats: this.chats.size,
      messages: [...this.messages.values()].reduce((n, r) => n + r.length, 0),
      pendingOperations: this.pendingGroups.size,
    };
  }
}
