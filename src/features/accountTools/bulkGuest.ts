/* eslint-disable unicorn/consistent-function-scoping, no-await-in-loop -- Serialized guest helpers and sequential, newest-first quote lookup. */
import type { BulkSpec, BulkSendOutcome } from './config';

// A native send may resolve before its message model receives ACK=1. Wait
// briefly for this exact outgoing message; never send, search by body or guess.
export async function waitForBulkReceipt(
  chatId: string,
  messageId: string,
): Promise<BulkSendOutcome> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  if (!messageId || !chatId) throw new Error('缺少原消息编号或聊天');
  const page = window as any;
  const idOf = (value: any): string => {
    if (typeof value === 'string') return value;
    if (value?._serialized) return value._serialized;
    const result = value?.toString?.();
    return result && result !== '[object Object]' ? result : '';
  };
  const ownKey = messageId.startsWith(`true_${chatId}_`);
  const belongs = (message: any) => {
    const id = idOf(message?.id);
    const remote =
      idOf(message?.id?.remote || message?.to) ||
      /^(?:true|false)_([^_]+)_/.exec(id)?.[1];
    return (
      id === messageId &&
      remote === chatId &&
      !id.startsWith('false_') &&
      message?.id?.fromMe !== false &&
      Boolean(
        message?.id?.fromMe ||
          message?.isSentByMe ||
          id.startsWith(`true_${chatId}_`),
      )
    );
  };
  const pending = {
    messageId,
    confirmed: false,
    error: '已记录消息编号，服务器回执仍待确认；未重发原消息',
  };
  const failedReceipt = (ack: number): BulkSendOutcome => {
    const reasons: Record<number, string> = {
      '-1': '发送失败',
      '-2': '消息已过期',
      '-3': '媒体已不可用',
      '-4': '内容过大',
      '-5': '内容无法上传',
      '-6': '消息未激活',
      '-7': '设备协议降级',
    };
    return {
      ...pending,
      halt: true,
      error: `WhatsApp 消息状态：${reasons[ack] || '发送错误'}（ACK=${ack}）；已暂停后续发送，请先检查账号连接及原消息，未自动重发`,
    };
  };
  const until = Date.now() + 6000;
  for (const delay of [0, 200, 400, 800, 1200, 2000]) {
    if (delay)
      await new Promise(resolve => {
        setTimeout(resolve, Math.min(delay, Math.max(0, until - Date.now())));
      });
    if (Date.now() >= until) break;
    let store: any;
    try {
      store = page.require?.('WAWebCollections')?.Msg;
    } catch {
      /* The ready helper can expose the same live message model. */
    }
    const read = async () => {
      const native = store?.get?.(messageId);
      if (native && !belongs(native)) return { invalidIdentity: true };
      if (
        native &&
        (Number(native.ack ?? native.attributes?.ack) >= 1 ||
          Number(native.ack ?? native.attributes?.ack) < 0)
      )
        return native;
      const api = page.WPP?.isReady ? page.WPP.chat : undefined;
      let message = native;
      if (api?.getMessageById) {
        try {
          message = (await api.getMessageById(messageId)) || native;
        } catch {
          /* A live native model can remain usable during a DB read failure. */
        }
      }
      if (message && !belongs(message)) return { invalidIdentity: true };
      if (
        message &&
        (Number(message.ack ?? message.attributes?.ack) >= 1 ||
          Number(message.ack ?? message.attributes?.ack) < 0)
      )
        return message;
      if (
        (message || native || ownKey) &&
        typeof api?.getMessageACK === 'function'
      ) {
        const info = await api.getMessageACK(messageId);
        const delivered = info?.participants?.some(
          p => Number(p.deliveredAt || p.readAt || p.playedAt) > 0,
        );
        if (info?.fromMe === true && (Number(info.ack) >= 1 || delivered))
          return { receiptConfirmed: true };
      }
      return message || native;
    };
    if (
      !store?.get &&
      !page.WPP?.chat?.getMessageById &&
      !page.WPP?.chat?.getMessageACK
    )
      return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const message: any = await Promise.race([
        read(),
        new Promise<void>(resolve => {
          timer = setTimeout(
            () => resolve(),
            Math.min(1000, until - Date.now()),
          );
        }),
      ]);
      // An unresolved read is not a reason to accumulate more pending reads.
      if (message === undefined) {
        const current = store?.get?.(messageId);
        if (
          current &&
          belongs(current) &&
          Number(current.ack ?? current.attributes?.ack) >= 1
        )
          return { messageId, confirmed: true };
        if (
          current &&
          belongs(current) &&
          Number(current.ack ?? current.attributes?.ack) < 0
        )
          return failedReceipt(Number(current.ack ?? current.attributes?.ack));
        return pending;
      }
      if (message?.invalidIdentity) return pending;
      if (message?.receiptConfirmed) return { messageId, confirmed: true };
      if (message) {
        if (!belongs(message)) return pending;
        const ack = Number(message.ack ?? message.attributes?.ack);
        if (ack < 0) {
          return failedReceipt(ack);
        }
        if (Number(message.ack ?? message.attributes?.ack) >= 1)
          return { messageId, confirmed: true };
      }
    } catch {
      // Missing or temporarily unavailable models remain unconfirmed.
    } finally {
      clearTimeout(timer);
    }
  }
  return pending;
}

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
  compose?: { ownerId: string; quotedMessageId?: string },
): Promise<BulkSendOutcome> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const wpp = (window as any).WPP;
  if (!wpp?.isReady)
    throw new Error('WhatsApp 消息接口尚未就绪，请刷新账号后重试');
  let socketState: unknown;
  try {
    socketState = (window as any).require?.('WAWebSocketModel')?.Socket?.state;
  } catch {
    /* Some versions only expose connection state through WPP. */
  }
  if (typeof socketState === 'string' && socketState !== 'CONNECTED')
    throw new Error('WhatsApp 账号未连接，未提交消息；请先恢复账号连接');
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
  // Audio selected in the chat UI must still belong to the same account,
  // conversation and composer reply when asynchronous decoding completes.
  const assertCompose = () => {
    if (!compose) return;
    const idOf = (value: any): string =>
      typeof value === 'string' ? value : value?._serialized || '';
    const active = wpp.chat.getActiveChat?.();
    if (
      spec.type !== 'audio' ||
      !compose.ownerId ||
      idOf(wpp.conn?.getMyUserWid?.()) !== compose.ownerId ||
      idOf(active?.id) !== chatId ||
      idOf(active?.composeQuotedMsg?.id) !== (compose.quotedMessageId || '')
    )
      throw new Error('账号、聊天或引用消息已变化，未发送语音');
  };
  assertCompose();
  if (compose?.quotedMessageId) {
    const quote = await wpp.chat.getMessageById(compose.quotedMessageId);
    const remote = quote?.id?.remote;
    const quoteId =
      typeof quote?.id === 'string' ? quote.id : quote?.id?._serialized;
    if (
      quoteId !== compose.quotedMessageId ||
      (remote?._serialized || remote) !== chatId
    )
      throw new Error('引用消息不属于当前聊天，未发送语音');
    options.quotedMsg = compose.quotedMessageId;
  }
  if (spec.reply) {
    const idOf = (id: any): string => {
      if (typeof id === 'string') return id;
      if (id?._serialized) return id._serialized;
      if (id?.user && id?.server) return `${id.user}@${id.server}`;
      const value = id?.toString?.();
      if (value && value !== '[object Object]') return value;
      try {
        const Key = wpp.whatsapp?.MsgKey;
        return id?.remote && id?.id && Key ? new Key(id).toString() : '';
      } catch {
        return '';
      }
    };
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
    const visibleText = (value: string) =>
      value
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
    const wanted = visibleText(spec.reply.text);
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
      const text = visibleText(String(m.caption || m.body || ''));
      if (spec.reply!.match === 'contains') return text.includes(wanted);
      if (spec.reply!.match === 'normalized')
        return (
          Boolean(normalize(wanted)) && normalize(text) === normalize(wanted)
        );
      return (
        text.trim().replaceAll('\r\n', '\n') === wanted.replaceAll('\r\n', '\n')
      );
    };
    const diagnostic = {
      revision: 1,
      phase: 'lookup',
      historyScanned: 0,
      indexScanned: 0,
      indexAvailable: false,
      historyLimited: false,
    };
    (window as any).__zlBulkReply = diagnostic;
    const deadline = Date.now() + 20_000;
    const bounded = async <T>(request: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          request,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('历史消息读取超时，未发送引用回复')),
              Math.max(1, Math.min(3000, deadline - Date.now())),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const timeOf = (message: any) => {
      const value = Number(message?.t || message?.timestamp || 0);
      return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
    };
    let found: any;
    let indexedMatch = false;
    let indexComplete = false;
    const consider = (rows: any[]) => {
      for (const message of rows)
        if (matches(message) && (!found || timeOf(message) > timeOf(found)))
          found = message;
    };
    let cached: any[] = [];
    try {
      cached = chat?.msgs?.getModelsArray?.() || [];
    } catch {
      /* Optional live cache. */
    }
    cached = cached
      .filter(
        message =>
          idOf(message?.id) &&
          (idOf(message.id?.remote) ||
            /^(?:true|false)_([^_]+)_/.exec(idOf(message.id))?.[1]) === chatId,
      )
      .sort((a, b) => timeOf(b) - timeOf(a));
    consider(cached);
    // The same scoped local DB index used for chat searches can find messages
    // outside the loaded scrollback, including newer outgoing messages.
    try {
      const search = wpp.whatsapp?.functions?.msgFindSearch;
      if (typeof search === 'function' && chat?.id) {
        diagnostic.indexAvailable = true;
        const indexed = new Set<string>();
        // Full-text lookup is only candidate retrieval. A literal whole-message
        // query can miss normalized punctuation/spacing variants. Search two
        // long words too, then apply the selected full rule to every result.
        const words = [...new Set(wanted.match(/[\p{L}\p{N}]{4,}/gu) || [])]
          .sort((a, b) => b.length - a.length)
          .slice(0, 2);
        const terms = [...new Set([wanted, ...words])];
        let complete = true;
        for (const term of terms) {
          const termSeen = new Set<string>();
          let exhausted = false;
          try {
            for (
              let page = 0;
              page < 10 && Date.now() < deadline - 8000;
              page += 1
            ) {
              if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
              const result: any = await bounded(
                Promise.resolve(
                  search({
                    searchTerm: term,
                    remote: chat.id,
                    count: 200,
                    page,
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
              if (rows.some(message => matches(message))) indexedMatch = true;
              consider(rows);
              if (result.eof) exhausted = true;
              if (result.eof || rows.length === 0) break;
            }
          } catch {
            /* Try the other scoped term; no send occurs during lookup. */
          }
          complete = complete && exhausted;
        }
        indexComplete = complete;
      }
    } catch {
      /* An unavailable index is not evidence that the message is absent. */
    }
    if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
    // Choose the newest known anchor instead of implicitly starting before
    // lastReceivedKey, which can exclude the account's own recent messages.
    const anchors = [...cached];
    if (chat?.lastReceivedKey) {
      try {
        const anchor = await bounded(
          Promise.resolve(wpp.chat.getMessageById(idOf(chat.lastReceivedKey))),
        );
        const remote =
          idOf(anchor?.id?.remote) ||
          /^(?:true|false)_([^_]+)_/.exec(idOf(anchor?.id))?.[1];
        if (anchor && remote === chatId) anchors.push(anchor);
      } catch {
        /* Continue with the live cache or the helper's default anchor. */
      }
    }
    anchors.sort((a, b) => timeOf(b) - timeOf(a));
    let before: string | undefined =
      anchors.length > 0 ? idOf(anchors[0].id) : undefined;
    consider(anchors);
    const seen = new Set<string>();
    diagnostic.phase = 'history';
    for (let round = 0; round < 50; round += 1) {
      // An exhausted scoped index gives the complete exact-match candidate
      // set. Do not page thousands of unrelated messages after finding it.
      if (indexComplete && indexedMatch && spec.reply.match === 'exact') break;
      // Reserve time for one last history read and verification of its ID.
      if (Date.now() >= deadline - 6000) {
        diagnostic.historyLimited = true;
        break;
      }
      if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
      const source = await bounded(
        Promise.resolve(
          wpp.chat.getMessages(chatId, {
            count: 200,
            direction: 'before',
            ...(before ? { id: before } : {}),
          }),
        ),
      );
      if (!Array.isArray(source))
        throw new Error('目标消息读取结果异常，未发送');
      const rows = source
        .filter(m => idOf(m.id) && !seen.has(idOf(m.id)))
        .sort((a, b) => timeOf(b) - timeOf(a));
      if (rows.length === 0) {
        diagnostic.historyLimited = source.length > 0;
        break;
      }
      consider(rows);
      for (const message of rows) seen.add(idOf(message.id));
      diagnostic.historyScanned = seen.size;
      // Once chronological scrollback reaches a found candidate, older pages
      // cannot replace it. Every candidate is reloaded and checked below.
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
      throw new Error(
        diagnostic.historyLimited
          ? `历史读取未完成（已查找 ${seen.size} 条），未发送引用回复；请稍后重试`
          : `可用历史消息中未找到匹配内容（已查找 ${seen.size} 条），未发送引用回复`,
      );
    }
    const quoteId = idOf(found.id);
    const latest = await bounded(
      Promise.resolve(wpp.chat.getMessageById(quoteId)),
    );
    if (idOf(latest?.id) !== quoteId || !matches(latest))
      throw new Error('目标消息已删除、编辑或不再匹配，未发送');
    if (!own()) throw new Error('账号登录身份已变化，未发送引用回复');
    options.quotedMsg = quoteId;
    diagnostic.phase = 'verified';
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
  if (spec.type === 'text') {
    try {
      result = await wpp.chat.sendTextMessage(chatId, content, options);
    } catch (error) {
      // Submission may have happened before the promise rejected. Do not
      // classify it as safely retryable or expose provider/user message text.
      const code = (error as any)?.code || (error as any)?.name;
      const label =
        typeof code === 'string' && /^[_a-z][\w-]{0,59}$/i.test(code)
          ? `（${code}）`
          : '';
      return {
        messageId: '',
        confirmed: false,
        halt: true,
        error: `WhatsApp 文字发送接口报错${label}；发送结果待核验，已暂停后续发送，未自动重发`,
      };
    }
  } else if (spec.type === 'contact')
    result = await wpp.chat.sendVCardContactMessage(
      chatId,
      { id: `${spec.contactPhone}@c.us`, name: spec.contactName },
      options,
    );
  else {
    if (!dataUrl?.startsWith('data:')) throw new Error('附件不可用');
    if (spec.type === 'audio') {
      // The helper silently drops waveform failures, and its precomputed
      // MediaData fields are not the final outgoing MsgModel attributes.
      // Prepare explicitly, then put validated bytes on productMsgOptions.
      const native = wpp.whatsapp;
      const prepare = native?.functions?.prepRawMedia;
      if (
        typeof prepare !== 'function' ||
        !native?.OpaqueData?.createFromData ||
        typeof wpp.chat.prepareRawMessage !== 'function'
      )
        throw new Error('原生语音准备接口未就绪，未发送');
      const voiceState = {
        phase: 'decoding',
        channels: 0,
        waveformSamples: 0,
        messageType: null as string | null,
        storedWaveformSamples: null as number | null,
        storedWaveformMatches: null as boolean | null,
      };
      (window as any).__zlBulkVoice = voiceState;
      const comma = dataUrl.indexOf(',');
      if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64'))
        throw new Error('语音文件格式无效，未发送');
      const bytes = Uint8Array.from(
        atob(dataUrl.slice(comma + 1)),
        c => c.codePointAt(0)!,
      );
      const blob = new Blob([bytes], {
        type: dataUrl.slice(5, comma).split(';')[0] || spec.media?.mime,
      });
      const decoder = new OfflineAudioContext(1, 1, 48_000);
      let decoded: AudioBuffer;
      try {
        decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
      } catch {
        voiceState.phase = 'failed';
        throw new Error(
          '无法解码所选音频，未发送；请使用 MP3、M4A、WAV 或 OGG 文件',
        );
      }
      if (
        !Number.isFinite(decoded.duration) ||
        decoded.duration <= 0 ||
        decoded.numberOfChannels < 1 ||
        decoded.length === 0
      )
        throw new Error('语音时长或声道无效，未发送');
      const channels = Array.from(
        { length: decoded.numberOfChannels },
        (_value, channel) => decoded.getChannelData(channel),
      );
      voiceState.channels = channels.length;
      const amplitudes = Array.from({ length: 64 }, (_value, i) => {
        const start = Math.floor((i * decoded.length) / 64);
        const end = Math.floor(((i + 1) * decoded.length) / 64);
        let total = 0;
        for (const samples of channels)
          for (let sample = start; sample < end; sample += 1)
            total += Math.abs(samples[sample]);
        return total / Math.max(1, (end - start) * channels.length);
      });
      const peak = Math.max(...amplitudes);
      if (!Number.isFinite(peak)) throw new Error('语音波形无效，未发送');
      const fields = {
        duration: Math.floor(decoded.duration),
        waveform: Uint8Array.from(amplitudes, amplitude =>
          peak ? Math.round((100 * amplitude) / peak) : 0,
        ),
      };
      voiceState.waveformSamples = fields.waveform.length;
      const opaque = await native.OpaqueData.createFromData(blob, blob.type);
      const prep = prepare(opaque, { isPtt: true, precomputedFields: fields });
      const media = await prep.waitForPrep();
      if (media?.type !== 'ptt') {
        voiceState.phase = 'failed';
        throw new Error('未能准备原生语音消息，未发送');
      }
      const raw = await wpp.chat.prepareRawMessage(
        chat,
        { type: 'ptt' },
        {
          ...options,
          isPtt: true,
        },
      );
      const key = raw?.id;
      const id =
        typeof key === 'string' ? key : key?._serialized || key?.toString?.();
      if (typeof id !== 'string' || !id.trim() || id === '[object Object]')
        throw new Error('未能创建语音消息编号，未发送');
      Object.assign(raw, { type: 'ptt', ...fields });
      voiceState.phase = 'prepared';
      voiceState.messageType = 'ptt';
      const sendOptions = {
        type: 'ptt',
        productMsgOptions: raw,
        addEvenWhilePreparing: false,
      };
      assertCompose();
      const sent = await (prep.sendToChat.length === 1
        ? prep.sendToChat({ chat, options: sendOptions })
        : prep.sendToChat(chat, sendOptions));
      voiceState.phase = 'submitted';
      // Read the actual outgoing model when available. Keep server acceptance
      // separate from waveform diagnostics; this check never edits or resends.
      try {
        const store = native.MsgStore;
        const stored = store?.get?.(raw.id) || store?.get?.(id);
        if (stored) {
          const value = stored.waveform ?? stored.attributes?.waveform;
          const waveform =
            typeof value === 'string'
              ? Uint8Array.from(atob(value), c => c.codePointAt(0)!)
              : [...(value || [])];
          voiceState.messageType = stored.type || 'ptt';
          voiceState.storedWaveformSamples = waveform.length;
          voiceState.storedWaveformMatches =
            waveform.length === 64 &&
            [...waveform].every((sample, i) => sample === fields.waveform[i]);
        }
      } catch {
        // Unknown readback stays null rather than claiming waveform success.
      }
      result = { id, sendMsgResult: sent };
    } else
      result = await wpp.chat.sendFileMessage(chatId, dataUrl, {
        ...options,
        type: spec.type === 'caption' ? 'image' : spec.type,
        filename: spec.media?.name,
        mimetype: spec.media?.mime,
        caption: spec.type === 'image' ? undefined : content,
        isPtt: false,
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
    ...(Number(result.ack) < 0
      ? {
          confirmed: false,
          halt: true,
          error: `WhatsApp 发送错误（ACK=${Number(result.ack)}）；已暂停后续发送，未自动重发`,
        }
      : {}),
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
  const owns = (message: any) => {
    const key = serialized(message?.id);
    const remote =
      serialized(message?.id?.remote || message?.to) ||
      /^(?:true|false)_([^_]+)_/.exec(key)?.[1];
    return (
      !key.startsWith('false_') &&
      message?.id?.fromMe !== false &&
      Boolean(
        message?.id?.fromMe ||
          message?.isSentByMe ||
          key.startsWith(`true_${chatId}_`),
      ) &&
      remote === chatId
    );
  };
  let message: any;
  if (messageId) {
    message = await wpp.chat.getMessageById(messageId);
    if (serialized(message?.id) !== messageId || !owns(message))
      throw new Error('消息不属于当前账号或聊天，或编号不符，未修改记录');
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
