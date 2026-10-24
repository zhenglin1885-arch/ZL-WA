/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest functions keep their helpers local. */
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
