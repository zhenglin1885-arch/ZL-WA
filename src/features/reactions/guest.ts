/* eslint-disable no-await-in-loop, unicorn/consistent-function-scoping -- Self-contained serialized guest, paginated newest-first reads and a single reaction mutation. */
import type { ReactionPreferences, ReactionResult } from './types';

export async function reactionGuest(request: {
  ownerId: string;
  groupId: string;
  rules: ReactionPreferences;
  messageId?: string;
  expectedText?: string;
  emoji?: string;
  token?: string;
}): Promise<
  | {
      messageId?: string;
      text?: string;
      timestamp?: number;
      error?: string;
    }
  | ReactionResult
> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前页面不是 WhatsApp');
  const page = window as any;
  const wpp = page.WPP;
  const idOf = (id: any): string =>
    typeof id === 'string'
      ? id
      : id?._serialized ||
        (id?.user && id?.server ? `${id.user}@${id.server}` : '');
  const own = () => {
    let prefs: any;
    try {
      prefs = page.require?.('WAWebUserPrefsMeUser');
    } catch {
      /* Use WPP identities. */
    }
    return [
      () => prefs?.getMaybeMePnUser?.(),
      () => prefs?.getMaybeMeLidUser?.(),
      () => wpp?.conn?.getMyUserWid?.(),
      () => wpp?.conn?.getMyUserLid?.(),
    ]
      .map(read => {
        try {
          return idOf(read()).replace(/:\d+@/, '@');
        } catch {
          return '';
        }
      })
      .includes(request.ownerId);
  };
  if (!wpp?.isReady || !wpp.chat?.getMessages)
    throw new Error('WhatsApp 消息接口未就绪');
  if (!own()) throw new Error('登录身份已变化，请重新选择账号');
  if (!/^\d{1,40}(-\d{1,30})?@g\.us$/.test(request.groupId))
    throw new Error('无效群组编号');
  if (!(await wpp.group.iAmMember(request.groupId)))
    throw new Error('当前账号已不在该群');
  const normalize = (text: string) =>
    text.normalize('NFKC').replaceAll(/[\p{P}\p{Z}\s]/gu, '');
  const matches = (text: string) => {
    const wanted = request.rules.text.trim();
    if (!wanted) return false;
    if (request.rules.match === 'contains') return text.includes(wanted);
    if (request.rules.match === 'normalized')
      return (
        Boolean(normalize(wanted)) && normalize(text) === normalize(wanted)
      );
    return (
      text.trim().replaceAll('\r\n', '\n') === wanted.replaceAll('\r\n', '\n')
    );
  };
  const rawText = (m: any): string => String(m?.caption || m?.body || '');
  const remote = (m: any) =>
    idOf(m?.id?.remote) || /^(?:true|false)_([^_]+)_/.exec(idOf(m?.id))?.[1];
  const eligible = (m: any) =>
    m &&
    !m.isRevoked &&
    !m.isNotification &&
    ![
      'revoked',
      'protocol',
      'notification',
      'gp2',
      'ciphertext',
      'reaction',
    ].includes(m.type) &&
    remote(m) === request.groupId &&
    matches(rawText(m));
  const timeOf = (m: any) => {
    const n = Number(m.t || m.timestamp || 0);
    return n < 1e12 ? n * 1000 : n;
  };
  if (!request.messageId) {
    const seen = new Set<string>();
    let before: string | undefined;
    const deadline = Date.now() + 20_000;
    for (let round = 0; round < 50 && Date.now() < deadline; round += 1) {
      const source = await wpp.chat.getMessages(request.groupId, {
        count: 200,
        direction: 'before',
        ...(before ? { id: before } : {}),
      });
      if (!Array.isArray(source)) throw new Error('消息读取结果异常');
      const rows = source
        .filter(m => idOf(m.id) && !seen.has(idOf(m.id)))
        .sort((a, b) => timeOf(b) - timeOf(a));
      if (rows.length === 0)
        return {
          error: `未找到匹配消息（已查找 ${seen.size} 条可用历史消息）`,
        };
      for (const m of rows) {
        seen.add(idOf(m.id));
        if (eligible(m))
          return {
            messageId: idOf(m.id),
            text: rawText(m).slice(0, 20_000),
            timestamp: timeOf(m),
          };
      }
      before = idOf(rows.at(-1).id);
    }
    return {
      error: `已查找 ${seen.size} 条消息，尚未找到匹配项；读取达到本次上限，可稍后重试`,
    };
  }
  if (
    !request.token ||
    !request.emoji ||
    ![
      '👍',
      '❤️',
      '😂',
      '😮',
      '🙏',
      '😊',
      '😎',
      '😍',
      '🥳',
      '👏',
      '🤝',
      '💐',
      '🌹',
      '🍀',
      '🚀',
      '🎉',
      '✅',
    ].includes(request.emoji)
  )
    throw new Error('点赞任务参数无效');
  if (!wpp.chat.getMessageById || !wpp.chat.sendReactionToMessage)
    throw new Error('点赞接口尚未就绪');
  page.__zlReactionOperations ??= new Map();
  const operations: Map<string, { pending: boolean; result?: ReactionResult }> =
    page.__zlReactionOperations;
  const previous = operations.get(request.token);
  if (previous)
    return (
      previous.result || {
        status: 'uncertain',
        message: '上次请求仍在执行，未重复发送',
        inFlight: true,
      }
    );
  const entry: { pending: boolean; result?: ReactionResult } = {
    pending: true,
  };
  operations.set(request.token, entry);
  let dispatched = false;
  try {
    const message = await wpp.chat.getMessageById(request.messageId);
    if (
      !eligible(message) ||
      rawText(message).slice(0, 20_000) !== request.expectedText
    )
      throw new Error('目标消息已删除、编辑或不再匹配，请重新查找');
    if (!own()) throw new Error('登录身份已变化，未发送表情');
    dispatched = true;
    const result = await wpp.chat.sendReactionToMessage(
      request.messageId,
      request.emoji,
    );
    entry.result =
      result?.sendMsgResult === 'OK'
        ? { status: 'success', message: `已发送 ${request.emoji}` }
        : {
            status: 'uncertain',
            message: `请求已提交，返回结果：${String(result?.sendMsgResult || '未确认')}；未自动重发`,
          };
  } catch (error) {
    const text = String(error).slice(0, 1000);
    const rejected =
      /rate[ _-]?overlimit|too many requests|\b429\b|forbidden|not_allowed|not_authorized|\b403\b|not_found|not found/i.test(
        text,
      );
    entry.result = {
      status: !dispatched || rejected ? 'failed' : 'uncertain',
      message: `${/rate[ _-]?overlimit|too many requests|\b429\b/i.test(text) ? 'WhatsApp 限流，请稍后重试：' : ''}${text}${dispatched && !rejected ? '；结果未确认，未自动重发' : ''}`,
    };
  } finally {
    entry.pending = false;
  }
  // Keep unfinished requests; completed tokens are bounded for long-running sessions.
  if (operations.size > 2000)
    for (const [key, value] of operations) {
      if (operations.size <= 1000) break;
      if (!value.pending && key !== request.token) operations.delete(key);
    }
  return entry.result!;
}
