/* eslint-disable unicorn/consistent-function-scoping, no-await-in-loop -- Serialized guest helpers and sequential, newest-first quote lookup. */
import type { BulkSpec, BulkSendOutcome } from './config';

export async function listBulkContacts() {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 接口未就绪');
  const contacts = await wpp.contact.list({ onlyMyContacts: true });
  return contacts
    .filter(c => c.id && ['c.us', 'lid'].includes(c.id.server))
    .map(c => ({
      id: c.id._serialized,
      name: String(c.name || c.pushname || c.id.user),
      group: false,
      contact: true,
      contactOnly: true,
    }));
}

// Serialized into the isolated account. Keep all helpers inside each function.
export async function sendBulkMessage(
  chatId: string,
  spec: BulkSpec,
  dataUrl?: string,
): Promise<BulkSendOutcome> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady)
    throw new Error('WhatsApp 消息接口尚未就绪，请刷新账号后重试');
  const chat = await wpp.chat.get(chatId);
  if (
    chat?.isReadOnly ||
    (!chat && !spec.targets.some(r => r.id === chatId && r.contactOnly))
  )
    throw new Error('所选聊天没有发送权限');
  const options: any = {
    waitForAck: true,
    markIsRead: false,
    detectMentioned: false,
    delay: spec.typingSeconds * 1000,
  };
  const content = spec.text;
  if (spec.reply) {
    const idOf = (id: any): string =>
      typeof id === 'string'
        ? id
        : id?._serialized ||
          (id?.user && id?.server ? `${id.user}@${id.server}` : '');
    const owner = spec.targets.find(r => r.id === chatId)?.ownerId;
    const own = () => {
      let prefs: any;
      try {
        prefs = (window as any).require?.('WAWebUserPrefsMeUser');
      } catch {
        /* WPP fallback. */
      }
      return [
        () => prefs?.getMaybeMePnUser?.(),
        () => prefs?.getMaybeMeLidUser?.(),
        () => wpp.conn?.getMyUserWid?.(),
        () => wpp.conn?.getMyUserLid?.(),
      ].some(read => {
        try {
          return idOf(read()).replace(/:\d+@/, '@') === owner;
        } catch {
          return false;
        }
      });
    };
    if (!owner || !own())
      throw new Error('账号登录身份已变化，请重新选择回复账号');
    if (!wpp.chat.getMessages || !wpp.chat.getMessageById)
      throw new Error('引用消息读取接口未就绪，未发送');
    const wanted = spec.reply.text.trim();
    if (
      !wanted ||
      !['exact', 'contains', 'normalized'].includes(spec.reply.match)
    )
      throw new Error('匹配内容或规则无效，未发送');
    const normalize = (value: string) =>
      value.normalize('NFKC').replaceAll(/[\p{P}\p{Z}\s]/gu, '');
    const matches = (m: any) => {
      if (
        !m ||
        m.isRevoked ||
        m.isNotification ||
        [
          'revoked',
          'protocol',
          'notification',
          'gp2',
          'ciphertext',
          'reaction',
        ].includes(m.type)
      )
        return false;
      const remote =
        idOf(m.id?.remote) || /^(?:true|false)_([^_]+)_/.exec(idOf(m.id))?.[1];
      if (remote !== chatId) return false;
      const text = String(m.caption || m.body || '');
      if (spec.reply!.match === 'contains') return text.includes(wanted);
      if (spec.reply!.match === 'normalized')
        return (
          Boolean(normalize(wanted)) && normalize(text) === normalize(wanted)
        );
      return (
        text.trim().replaceAll('\r\n', '\n') === wanted.replaceAll('\r\n', '\n')
      );
    };
    const seen = new Set<string>();
    let before: string | undefined;
    let found: any;
    const deadline = Date.now() + 20_000;
    for (let round = 0; round < 50 && Date.now() < deadline; round += 1) {
      if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
      const source = await wpp.chat.getMessages(chatId, {
        count: 200,
        direction: 'before',
        ...(before ? { id: before } : {}),
      });
      if (!Array.isArray(source))
        throw new Error('目标消息读取结果异常，未发送');
      const rows = source
        .filter(m => idOf(m.id) && !seen.has(idOf(m.id)))
        .sort(
          (a, b) =>
            Number(b.t || b.timestamp || 0) - Number(a.t || a.timestamp || 0),
        );
      if (rows.length === 0) break;
      found = rows.find(m => matches(m));
      if (found) break;
      for (const m of rows) seen.add(idOf(m.id));
      before = idOf(rows.at(-1).id);
    }
    if (!found) throw new Error('可用历史消息中未找到匹配内容，未发送引用回复');
    const quoteId = idOf(found.id);
    const latest = await wpp.chat.getMessageById(quoteId);
    if (idOf(latest?.id) !== quoteId || !matches(latest))
      throw new Error('目标消息已删除、编辑或不再匹配，未发送');
    if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
    options.quotedMsg = quoteId;
  }
  if (spec.mentionAll && chatId.endsWith('@g.us')) {
    const participants = await wpp.group.getParticipants(chatId);
    options.mentionedList = participants
      .map(p => p.id?._serialized || String(p.id))
      .filter(Boolean);
    if (options.mentionedList.length === 0)
      throw new Error('未能读取群成员，无法 @所有人');
  }
  let result: any;
  if (spec.type === 'text')
    result = await wpp.chat.sendTextMessage(chatId, content, options);
  else if (spec.type === 'contact')
    result = await wpp.chat.sendVCardContactMessage(
      chatId,
      { id: `${spec.contactPhone}@c.us`, name: spec.contactName },
      options,
    );
  else {
    if (!dataUrl?.startsWith('data:')) throw new Error('附件不可用');
    result = await wpp.chat.sendFileMessage(chatId, dataUrl, {
      ...options,
      type: spec.type === 'caption' ? 'image' : spec.type,
      filename: spec.media?.name,
      mimetype: spec.media?.mime,
      caption:
        spec.type === 'image' || spec.type === 'audio' ? undefined : content,
      isPtt: spec.type === 'audio',
    });
  }
  const key = result?.id;
  const messageId =
    typeof key === 'string' ? key : key?._serialized || key?.toString?.();
  if (
    typeof messageId !== 'string' ||
    !messageId.trim() ||
    messageId === '[object Object]'
  )
    return {
      messageId: '',
      confirmed: false,
      error: '消息已提交但未取得消息编号，请核对发送结果；请勿直接重发',
    };
  return {
    messageId,
    ...(options.quotedMsg ? { quotedMessageId: options.quotedMsg } : {}),
    confirmed:
      result.ack >= 1 ||
      ['OK', 'success'].includes(result.sendMsgResult) ||
      ['OK', 'success'].includes(result.sendMsgResult?.messageSendResult),
  };
}

export async function revokeBulkMessage(
  chatId: string,
  messageId: string,
): Promise<void> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 消息接口尚未就绪');
  const message = await wpp.chat.getMessageById(messageId);
  if (
    !message?.id?.fromMe ||
    String(message.id.remote?._serialized || message.id.remote) !== chatId
  )
    throw new Error('消息不属于当前账号或聊天，无法撤回');
  const result = await wpp.chat.deleteMessage(chatId, messageId, false, true);
  const item = Array.isArray(result) ? result[0] : result;
  if (!item?.isRevoked || !['OK', 'success'].includes(item.sendMsgResult))
    throw new Error(
      '未确认撤回成功，可能已超出平台撤回时限，请在 WhatsApp 核查',
    );
}

// Read-only reconciliation: never resend or choose the nearest message when
// several identical messages could belong to this task.
export async function reconcileBulkMessage(
  chatId: string,
  messageId: string | undefined,
  spec: BulkSpec | undefined,
  started: string,
  ended: string,
): Promise<BulkSendOutcome> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 消息接口尚未就绪');
  const serialized = (id: any): string => {
    if (typeof id === 'string') return id;
    if (typeof id?._serialized === 'string') return id._serialized;
    const value = id?.toString?.();
    return typeof value === 'string' && value !== '[object Object]'
      ? value
      : '';
  };
  const owns = (message: any) =>
    Boolean(message?.id?.fromMe || message?.isSentByMe) &&
    serialized(message.id?.remote || message.to) === chatId;
  let message: any;
  if (messageId) {
    message = await wpp.chat.getMessageById(messageId);
    if (!owns(message)) throw new Error('消息不属于当前账号或聊天，未修改记录');
  } else {
    if (spec?.reply)
      throw new Error(
        '引用回复缺少发送消息编号，无法安全核验；未重发，请在 WhatsApp 核查',
      );
    const from = Date.parse(started) / 1000;
    const to = Date.parse(ended) / 1000;
    if (!spec || !Number.isFinite(from) || !Number.isFinite(to) || to < from)
      throw new Error('记录缺少可核对的消息编号或发送时间');
    const types: Record<string, string> = {
      text: 'chat',
      image: 'image',
      caption: 'image',
      video: 'video',
      audio: 'ptt',
      document: 'document',
      contact: 'vcard',
    };
    const messages = await wpp.chat.getMessages(chatId, { count: 200 });
    const matches = messages.filter((m: any) => {
      const t = Number(m.t);
      if (!owns(m) || m.type !== types[spec.type] || t < from - 2 || t > to + 2)
        return false;
      const content = String(m.caption || m.body || '');
      if (
        spec.type === 'text' ||
        (['caption', 'video', 'document'].includes(spec.type) && spec.text)
      ) {
        return (
          content === spec.text ||
          (spec.mentionAll && content.endsWith(`\n${spec.text}`))
        );
      }
      // An attachment with no text cannot be identified by timestamp alone.
      return Boolean(
        spec.media?.name &&
          m.filename === spec.media.name &&
          Number(m.size) === spec.media.size,
      );
    });
    if (matches.length !== 1)
      throw new Error(
        matches.length > 1
          ? '发现多条相同消息，无法安全确定是哪一条，请在 WhatsApp 中核查'
          : '最近 200 条消息中未找到唯一匹配，未重发消息；请在 WhatsApp 中核查',
      );
    [message] = matches;
  }
  const id = serialized(message.id);
  if (!id) throw new Error('未读取到消息编号');
  const ack = Number(message.ack);
  return {
    messageId: id,
    confirmed: ack >= 1,
    ...(ack >= 1 ? {} : { error: '已找回消息编号，服务器送达状态仍待确认' }),
  };
}

export async function editBulkMessage(
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  if (!text.trim() || text.length > 12_000)
    throw new Error('请输入 1–12000 字符的新文字');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady) throw new Error('WhatsApp 消息接口尚未就绪');
  const message = await wpp.chat.getMessageById(messageId);
  const remote =
    message?.id?.remote?._serialized || String(message?.id?.remote || '');
  if (!message?.id?.fromMe || remote !== chatId)
    throw new Error('消息不属于当前账号或聊天，无法编辑');
  if (
    !['chat', 'image', 'video', 'document'].includes(message.type) ||
    message.isRevoked ||
    message.isRevokedByMe
  )
    throw new Error('该类型消息不支持编辑或消息已撤回');
  const sentAt = Number(message.t) * 1000;
  if (
    !Number.isFinite(sentAt) ||
    sentAt <= 0 ||
    Date.now() - sentAt >= 15 * 60_000
  )
    throw new Error('消息已超出 WhatsApp 的 15 分钟编辑时限');
  // WPP also checks the live platform capabilities (including caption edits).
  const mentionedList = (message.mentionedJidList || [])
    .map((id: any) => (typeof id === 'string' ? id : id?._serialized))
    .filter(Boolean);
  const result = await wpp.chat.editMessage(messageId, text, {
    waitForAck: true,
    ...(mentionedList.length > 0
      ? { mentionedList, detectMentioned: false }
      : {}),
  });
  if (
    !(
      result?.ack >= 1 ||
      ['OK', 'success'].includes(result?.sendMsgResult) ||
      ['OK', 'success'].includes(result?.sendMsgResult?.messageSendResult)
    )
  )
    throw new Error('编辑结果待确认，请在 WhatsApp 核查；不会重发原消息');
}
