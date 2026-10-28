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
  const idOf = (id: any): string => {
    if (typeof id === 'string') return id;
    if (typeof id?._serialized === 'string') return id._serialized;
    if (id?.user && id?.server) return `${id.user}@${id.server}`;
    const text = id?.toString?.();
    if (typeof text === 'string' && text !== '[object Object]') return text;
    try {
      const Key = wpp.whatsapp?.MsgKey;
      return id?.remote && id?.id && Key ? new Key(id).toString() : '';
    } catch {
      return '';
    }
  };
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
  const visibleText = (text: string) =>
    text
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
  const normalize = (text: string) =>
    text.normalize('NFKC').replaceAll(/[\p{P}\p{Z}\s]/gu, '');
  const matches = (input: string) => {
    const wanted = visibleText(request.rules.text);
    const text = visibleText(input);
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
    return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : 0;
  };
  if (!request.messageId && !imageMode) {
    const diagnostic = {
      revision: 1,
      phase: 'lookup',
      indexAvailable: false,
      indexScanned: 0,
      historyScanned: 0,
      historyLimited: false,
    };
    page.__zlReactionLookup = diagnostic;
    const deadline = Date.now() + 20_000;
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('点赞消息读取超时，请稍后重新查找')),
              Math.max(1, Math.min(3000, deadline - Date.now())),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const wanted = visibleText(request.rules.text);
    if (
      !wanted ||
      !['exact', 'contains', 'normalized'].includes(request.rules.match)
    )
      throw new Error('匹配文字或规则无效');
    let chat: any;
    try {
      chat =
        typeof wpp.chat.get === 'function'
          ? await bounded(Promise.resolve(wpp.chat.get(request.groupId)))
          : undefined;
    } catch {
      /* A DB search may still be possible without a loaded chat. */
    }
    if (chat?.id && idOf(chat.id) !== request.groupId) chat = undefined;
    let scopedWid = chat?.id;
    if (!scopedWid) {
      try {
        scopedWid = wpp.whatsapp?.WidFactory?.createWid?.(request.groupId);
      } catch {
        /* Optional native Wid factory. */
      }
    }
    let found: any;
    const consider = (rows: any[]) => {
      for (const message of rows)
        if (
          eligibleBase(message) &&
          matches(rawText(message)) &&
          (!found || timeOf(message) > timeOf(found))
        )
          found = message;
    };
    let cached: any[] = [];
    try {
      cached = chat?.msgs?.getModelsArray?.() || [];
    } catch {
      /* Optional live collection. */
    }
    cached = cached
      .filter(
        message => idOf(message?.id) && remote(message) === request.groupId,
      )
      .sort((a, b) => timeOf(b) - timeOf(a));
    consider(cached);
    let indexedMatch = false;
    let indexComplete = false;
    try {
      const search = wpp.whatsapp?.functions?.msgFindSearch;
      if (typeof search === 'function' && scopedWid) {
        diagnostic.indexAvailable = true;
        const indexed = new Set<string>();
        const words = [...new Set(wanted.match(/[\p{L}\p{N}]{4,}/gu) || [])]
          .sort((a, b) => b.length - a.length)
          .slice(0, 2);
        let complete = true;
        for (const term of new Set([wanted, ...words])) {
          const termSeen = new Set<string>();
          let exhausted = false;
          try {
            for (
              let index = 0;
              index < 10 && Date.now() < deadline - 8000;
              index += 1
            ) {
              if (!own()) throw new Error('登录身份已变化，请重新选择账号');
              const result: any = await bounded(
                Promise.resolve(
                  search({
                    searchTerm: term,
                    remote: scopedWid,
                    count: 200,
                    page: index,
                  }),
                ),
              );
              if (result?.canceled || !Array.isArray(result?.messages)) break;
              const rows = result.messages.filter(
                message => idOf(message?.id) && !termSeen.has(idOf(message.id)),
              );
              for (const message of rows) {
                termSeen.add(idOf(message.id));
                indexed.add(idOf(message.id));
              }
              diagnostic.indexScanned = indexed.size;
              if (
                rows.some(
                  message => eligibleBase(message) && matches(rawText(message)),
                )
              )
                indexedMatch = true;
              consider(rows);
              if (result.eof) exhausted = true;
              if (result.eof || rows.length === 0) break;
            }
          } catch {
            /* Try the other scoped term; lookup never sends a reaction. */
          }
          complete = complete && exhausted;
        }
        indexComplete = complete;
      }
    } catch {
      /* Unavailable index falls back to chronological history. */
    }
    if (!own()) throw new Error('登录身份已变化，请重新选择账号');
    const anchors = [...cached];
    if (chat?.lastReceivedKey && wpp.chat.getMessageById) {
      try {
        const anchor = await bounded(
          Promise.resolve(wpp.chat.getMessageById(idOf(chat.lastReceivedKey))),
        );
        if (anchor && remote(anchor) === request.groupId) anchors.push(anchor);
      } catch {
        /* The live cache or helper default remains available. */
      }
    }
    anchors.sort((a, b) => timeOf(b) - timeOf(a));
    consider(anchors);
    let before = anchors.length > 0 ? idOf(anchors[0].id) : undefined;
    const seen = new Set<string>();
    diagnostic.phase = 'history';
    for (let round = 0; round < 50; round += 1) {
      if (indexComplete && indexedMatch && request.rules.match === 'exact')
        break;
      if (Date.now() >= deadline - 6000) {
        diagnostic.historyLimited = true;
        break;
      }
      if (!own()) throw new Error('登录身份已变化，请重新选择账号');
      const source = await bounded(
        Promise.resolve(
          wpp.chat.getMessages(request.groupId, {
            count: 200,
            direction: 'before',
            ...(before ? { id: before } : {}),
          }),
        ),
      );
      if (!Array.isArray(source)) throw new Error('消息读取结果异常');
      const rows = source
        .filter(message => idOf(message?.id) && !seen.has(idOf(message.id)))
        .sort((a, b) => timeOf(b) - timeOf(a));
      if (rows.length === 0) {
        diagnostic.historyLimited = source.length > 0;
        break;
      }
      for (const message of rows) seen.add(idOf(message.id));
      diagnostic.historyScanned = seen.size;
      consider(rows);
      if (found && timeOf(rows.at(-1)) <= timeOf(found)) break;
      const next = idOf(rows.at(-1).id);
      if (next === before) {
        diagnostic.historyLimited = true;
        break;
      }
      before = next;
      if (round === 49) diagnostic.historyLimited = true;
    }
    if (!found) {
      diagnostic.phase = 'not-found';
      return {
        error: diagnostic.historyLimited
          ? `历史消息读取未完成（已查找 ${seen.size} 条），尚不能确认匹配结果，请稍后重试`
          : `当前账号的该群未找到匹配消息（历史 ${seen.size} 条，搜索候选 ${diagnostic.indexScanned} 条）`,
      };
    }
    const key = idOf(found.id);
    if (!wpp.chat.getMessageById)
      throw new Error('目标消息读取接口未就绪，请稍后重新查找');
    const latest = await bounded(Promise.resolve(wpp.chat.getMessageById(key)));
    if (
      idOf(latest?.id) !== key ||
      !eligibleBase(latest) ||
      !matches(rawText(latest))
    )
      throw new Error('目标消息已删除、编辑或不再匹配，请重新查找');
    if (!own()) throw new Error('登录身份已变化，请重新选择账号');
    diagnostic.phase = 'verified';
    return {
      messageId: key,
      text: rawText(latest).slice(0, 20_000),
      timestamp: timeOf(latest),
    };
  }
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
      idOf(message?.id) !== request.messageId ||
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
