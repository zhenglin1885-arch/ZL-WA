/* eslint-disable no-await-in-loop, unicorn/consistent-function-scoping -- Self-contained serialized guest, paginated newest-first reads and a single reaction mutation. */
import type { ReactionPreferences, ReactionResult } from './types';
import type { prepareReactionImage } from './image';

export async function reactionGuest(
  request: {
    ownerId: string;
    groupId: string;
    rules: ReactionPreferences;
    messageId?: string;
    expectedText?: string;
    emoji?: string;
    token?: string;
    verifyOnly?: boolean;
    expectedImageHash?: string;
  },
  imageReader?: typeof prepareReactionImage,
): Promise<
  | {
      messageId?: string;
      text?: string;
      timestamp?: number;
      error?: string;
      imageHash?: string;
      imagePreview?: string;
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
  const ownIds = () => {
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
    ].map(read => {
      try {
        return idOf(read()).replace(/:\d+@/, '@');
      } catch {
        return '';
      }
    });
  };
  const own = () => ownIds().includes(request.ownerId);
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
  const imageMode = request.rules.content === 'image';
  const images = new Map<
    string,
    Awaited<ReturnType<typeof prepareReactionImage>>
  >();
  let imageError = '';
  const imageHash = (m: any): string => {
    const value = m.filehash || m.fileSha256 || m.mediaData?.filehash;
    if (typeof value === 'string') return value.slice(0, 500);
    if (ArrayBuffer.isView(value))
      return [
        ...new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 500);
    return '';
  };
  const eligibleBase = (m: any) =>
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
    remote(m) === request.groupId;
  const eligible = async (m: any) => {
    if (!eligibleBase(m)) return false;
    if (!imageMode) return matches(rawText(m));
    if (m.type !== 'image') return false;
    if (request.expectedImageHash)
      return imageHash(m) === request.expectedImageHash;
    if (!imageReader || !request.rules.picture || !wpp.chat.downloadMedia) {
      imageError = '图片读取接口未就绪或尚未上传参考图';
      return false;
    }
    try {
      const picture = await imageReader(
        await wpp.chat.downloadMedia(idOf(m.id)),
        request.rules.picture,
      );
      if (!own()) throw new Error('登录身份已变化');
      if (picture.matches) images.set(idOf(m.id), picture);
      return picture.matches;
    } catch (error) {
      imageError = String(error).slice(0, 500);
      return false;
    }
  };
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
        ...(imageMode ? { media: 'image' } : {}),
        ...(before ? { id: before } : {}),
      });
      if (!Array.isArray(source)) throw new Error('消息读取结果异常');
      const rows = source
        .filter(m => idOf(m.id) && !seen.has(idOf(m.id)))
        .sort((a, b) => timeOf(b) - timeOf(a));
      if (rows.length === 0)
        return {
          error: `未找到匹配${imageMode ? '图片' : '消息'}（已查找 ${seen.size} 条可用历史消息）${imageError ? `；图片读取信息：${imageError}` : ''}`,
        };
      for (const m of rows) {
        seen.add(idOf(m.id));
        if (await eligible(m))
          return {
            messageId: idOf(m.id),
            text: rawText(m).slice(0, 20_000),
            timestamp: timeOf(m),
            ...(imageMode
              ? {
                  imageHash: imageHash(m),
                  imagePreview: images.get(idOf(m.id))?.preview,
                }
              : {}),
          };
        if (imageMode && imageError)
          return {
            error: `较新的图片无法读取，无法确认最新匹配项，未选择更早图片；${imageError}`,
          };
      }
      before = idOf(rows.at(-1).id);
    }
    return {
      error: `已查找 ${seen.size} 条消息，尚未找到匹配项；读取达到本次上限，可稍后重试`,
    };
  }
  const verifyReaction = async (): Promise<ReactionResult | undefined> => {
    if (!own()) throw new Error('登录身份已变化，无法核验');
    if (
      !request.messageId?.startsWith(`true_${request.groupId}_`) &&
      !request.messageId?.startsWith(`false_${request.groupId}_`)
    )
      throw new Error('目标消息不属于指定群组');
    const native = wpp.whatsapp?.functions?.getReactions;
    const read = typeof native === 'function' ? native : wpp.chat.getReactions;
    if (typeof read !== 'function') return undefined;
    const result = await read(request.messageId);
    if (!own()) throw new Error('登录身份已变化，无法核验');
    const mine = result?.reactionByMe;
    if (!mine || mine.reactionText !== request.emoji) return undefined;
    const sender = idOf(mine.senderUserJid).replace(/:\d+@/, '@');
    if (sender && !ownIds().includes(sender)) return undefined;
    if (
      mine.isSendFailure ||
      mine.isFailed ||
      (typeof mine.ack === 'number' && mine.ack < 0)
    )
      return { status: 'failed', message: '已核验：该表情发送失败' };
    if (mine.ack === 0) return undefined;
    return {
      status: 'success',
      message: `已核验当前账号的 ${request.emoji} 表情`,
    };
  };
  const settleReaction = async () => {
    let detail = '';
    for (const delay of [0, 250, 750, 1500]) {
      if (delay)
        await new Promise<void>(resolve => {
          setTimeout(resolve, delay);
        });
      try {
        const result = await verifyReaction();
        if (result) return result;
      } catch (error) {
        detail = String(error).slice(0, 500);
      }
    }
    return {
      status: 'uncertain',
      message: `尚未读到当前账号的目标表情，未重发${detail ? `；核验信息：${detail}` : ''}`,
    } as ReactionResult;
  };
  if (request.verifyOnly) return settleReaction();
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
      !(await eligible(message)) ||
      (!imageMode && rawText(message).slice(0, 20_000) !== request.expectedText)
    )
      throw new Error(
        `目标消息已删除、编辑或不再匹配，请重新查找${imageError ? `；${imageError}` : ''}`,
      );
    if (!own()) throw new Error('登录身份已变化，未发送表情');
    dispatched = true;
    const result = await wpp.chat.sendReactionToMessage(
      request.messageId,
      request.emoji,
    );
    entry.result =
      result?.sendMsgResult === 'OK'
        ? { status: 'success', message: `已发送 ${request.emoji}` }
        : await settleReaction();
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
