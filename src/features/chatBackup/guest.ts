/* eslint-disable no-await-in-loop, no-continue, unicorn/consistent-function-scoping -- Self-contained serialized guest; bounded media reads are sequential. */
import type { BackupPacket, BackupMessage } from './types';

export async function captureChat(request: {
  ownerId: string;
  accountName: string;
  mode: 'opened' | 'list' | 'history' | 'ack';
  receipts?: { key: string; signature: string }[];
  chatId?: string;
  chatName?: string;
  before?: string;
  cutoff?: number;
}): Promise<any> {
  if (window.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前页面不是 WhatsApp');
  const page = window as any;
  const module = (name: string) => {
    try {
      return page.require?.(name);
    } catch {
      return null;
    }
  };
  const wid = (id: any): string =>
    id?._serialized ||
    (id?.user
      ? `${id.user}@${id.server || 'c.us'}`
      : typeof id === 'string'
        ? id
        : '');
  const owners = () =>
    [
      module('WAWebUserPrefsMeUser')?.getMaybeMePnUser?.(),
      module('WAWebUserPrefsMeUser')?.getMaybeMeLidUser?.(),
      page.WPP?.conn?.getMyUserWid?.(),
    ].map(id => wid(id));
  if (!owners().includes(request.ownerId))
    throw new Error('账号身份已变化，已停止聊天备份');
  page.__zlBackupSeen ??= new Map();
  const seen: Map<string, string> = page.__zlBackupSeen;
  if (request.mode === 'ack') {
    for (const receipt of request.receipts || [])
      if (receipt.key.startsWith(`${request.ownerId}:`))
        seen.set(receipt.key, receipt.signature);
    return null;
  }
  const wpp = page.WPP;
  if (request.mode === 'list') {
    if (!wpp?.isReady || !wpp.chat?.list) throw new Error('历史读取接口未就绪');
    const chats = await wpp.chat.list({ count: -1, ignoreGroupMetadata: true });
    if (!owners().includes(request.ownerId)) throw new Error('账号身份已变化');
    return chats
      .map((c: any) => ({
        id: wid(c.id),
        name: String(
          c.name || c.formattedTitle || c.contact?.pushname || wid(c.id),
        ).slice(0, 500),
      }))
      .filter((c: any) =>
        /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(c.id),
      );
  }
  let active: any;
  try {
    active =
      wpp?.chat?.getActiveChat?.() ||
      module('WAWebChatGetters')?.getActiveChat?.();
  } catch {
    /* Virtual navigation may temporarily make the active-chat getter unavailable. */
  }
  const marker =
    document.querySelector('#main [data-id]')?.getAttribute('data-id') || '';
  const chatId =
    request.mode === 'history'
      ? request.chatId
      : wid(active?.id) || /^(?:true|false)_([^_]+)_/.exec(marker)?.[1];
  if (!chatId || !/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(chatId))
    return null;
  const chat =
    wpp?.whatsapp?.ChatStore?.get(chatId) ||
    module('WAWebCollections')?.Chat?.get?.(chatId) ||
    (wid(active?.id) === chatId ? active : undefined);
  const title = String(
    chat?.name ||
      chat?.formattedTitle ||
      chat?.contact?.pushname ||
      request.chatName ||
      (request.mode === 'opened'
        ? document.querySelector('#main header [title]')?.getAttribute('title')
        : undefined) ||
      chatId,
  ).slice(0, 500);
  const nodes = [
    ...document.querySelectorAll<HTMLElement>('#main [data-id]'),
  ].filter(n => /^(?:true|false)_/.test(n.dataset.id || ''));
  const msgStore =
    wpp?.whatsapp?.MsgStore ||
    module('WAWebCollections')?.Msg ||
    module('WAWebMsgCollection')?.Msg;
  let source: any[] = [];
  if (request.mode === 'history') {
    if (!wpp?.isReady || !wpp.chat?.getMessages)
      throw new Error('历史读取接口未就绪');
    source = await wpp.chat.getMessages(chatId, {
      count: 25,
      direction: 'before',
      ...(request.before ? { id: request.before } : {}),
    });
    source = source
      .filter(m => wid(m.id) !== request.before)
      .sort(
        (a, b) =>
          Number(b.t || b.timestamp || 0) - Number(a.t || a.timestamp || 0),
      );
  } else
    source = nodes.map(
      node => msgStore?.get?.(node.dataset.id) || { id: node.dataset.id, node },
    );
  if (request.mode === 'opened') {
    const loaded = chat?.msgs?.getModelsArray?.() || chat?.msgs?.models || [];
    source = [
      ...new Map([...source, ...loaded].map(m => [wid(m.id), m])).values(),
    ];
  }
  const receipts: { key: string; signature: string }[] = [];
  page.__zlBackupPhotoAttempts ??= new Map();
  const photoAttempts: Map<string, number> = page.__zlBackupPhotoAttempts;
  const messages: BackupMessage[] = [];
  const deadline = Date.now() + 10_000;
  let total = 0;
  let oldest: string | undefined;
  let ended = source.length === 0;
  for (const model of source) {
    if (
      messages.length >= 100 ||
      (messages.length > 0 && Date.now() > deadline)
    )
      break;
    const id = wid(model.id);
    if (!id) continue;
    const remote =
      wid(model.id?.remote) || /^(?:true|false)_([^_]+)_/.exec(id)?.[1];
    if (remote && remote !== chatId) continue;
    const node = model.node || nodes.find(n => n.dataset.id === id);
    const timestamp = Number(model.t || model.timestamp || 0);
    const time = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    if (
      request.mode === 'history' &&
      time &&
      request.cutoff &&
      time < request.cutoff
    ) {
      ended = true;
      break;
    }
    oldest = id;
    if (!time || time < 1_262_304_000_000) continue; // Never assign unknown history to today's date.
    const clone = node?.cloneNode(true) as HTMLElement | undefined;
    clone
      ?.querySelectorAll(
        '[data-zl-translation],button,[data-testid*="quoted"],blockquote',
      )
      .forEach(n => n.remove());
    const text = String(
      (model.type === 'image' ? model.caption : model.body || model.caption) ||
        clone?.querySelector(
          '.selectable-text,[data-testid="msg-text"],[data-pre-plain-text]',
        )?.textContent ||
        '',
    ).slice(0, 50_000);
    const translation = String(
      node?.querySelector('[data-zl-translation-text]')?.textContent || '',
    ).slice(0, 50_000);
    const hasImage =
      model.type === 'image' ||
      !!node?.querySelector('img[src^="blob:"],img[src^="data:image/"]');
    if (!text && !hasImage) continue;
    const signature = JSON.stringify([text, translation, hasImage]);
    const key = `${request.ownerId}:${chatId}:${id}`;
    if (
      request.mode === 'opened' &&
      (seen.get(key) === signature ||
        (seen.get(key) === `${signature}:pending` &&
          Date.now() - (photoAttempts.get(key) || 0) < 30_000))
    )
      continue;
    let image: string | undefined;
    if (
      hasImage &&
      (request.mode === 'history' ||
        Date.now() - (photoAttempts.get(key) || 0) > 30_000)
    ) {
      photoAttempts.set(key, Date.now());
      try {
        let blob: Blob | undefined;
        const photo = node?.querySelector(
          'img[src^="blob:"],img[src^="data:image/"]',
        ) as HTMLImageElement | undefined;
        if (photo?.src) {
          const response = await fetch(photo.src, {
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) blob = await response.blob();
        } else if (wpp?.chat?.downloadMedia) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            blob = await Promise.race([
              wpp.chat.downloadMedia(id),
              new Promise<null>(resolve => {
                timer = setTimeout(() => resolve(null), 5000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        if (
          blob &&
          /^(image\/(jpeg|png|webp|gif))$/.test(blob.type) &&
          blob.size <= 16_000_000
        ) {
          if (total + blob.size * 1.4 > 24_000_000) {
            oldest = messages.at(-1)?.id;
            break;
          }
          image = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.addEventListener('load', () => resolve(String(r.result)));
            r.addEventListener('error', reject, { once: true });
            r.readAsDataURL(blob!);
          });
          total += image.length;
        }
      } catch {
        /* Unavailable photos are explicit placeholders; text still saves. */
      }
    }
    if (!owners().includes(request.ownerId)) throw new Error('账号身份已变化');
    messages.push({
      id,
      time,
      sender: String(
        model.author?.user || model.sender?.pushname || model.from?.user || '',
      ).slice(0, 500),
      outgoing: Boolean(model.id?.fromMe ?? id.startsWith('true_')),
      text,
      ...(translation ? { translation } : {}),
      ...(image ? { image } : {}),
      hasImage,
    });
    if (request.mode === 'opened')
      receipts.push({
        key,
        signature: hasImage && !image ? `${signature}:pending` : signature,
      });
  }
  if (photoAttempts.size > 30_000)
    for (const key of [...photoAttempts.keys()].slice(0, 10_000))
      photoAttempts.delete(key);
  if (seen.size > 30_000)
    for (const key of [...seen.keys()].slice(0, 10_000)) seen.delete(key);
  if (!owners().includes(request.ownerId)) throw new Error('账号身份已变化');
  return {
    receipts,
    packet: {
      ownerId: request.ownerId,
      accountName: request.accountName,
      chatId,
      chatName: title,
      messages,
    } satisfies BackupPacket,
    nextBefore: oldest,
    complete: ended || !oldest,
  };
}
