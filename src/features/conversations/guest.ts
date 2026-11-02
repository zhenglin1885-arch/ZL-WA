/* eslint-disable unicorn/consistent-function-scoping, no-continue -- Serialized guest helpers must be self-contained and skip unsupported records. */
import type { ConversationItem } from './types';
// Called after readCustomerContext establishes the current native adapter.
export function readConversationIndex(): {
  rows: ConversationItem[];
  contactsReady: boolean;
} {
  const page = window as any;
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前页面不是 WhatsApp');
  const adapter = page.__zlCustomerAdapter;
  if (!adapter?.owners().length) return { rows: [], contactsReady: false };
  const get = (name: string) => {
    try {
      return page.require?.(name);
    } catch {
      return null;
    }
  };
  const idOf = (value: any): string =>
    String(
      value?._serialized ||
        (value?.user && value?.server
          ? `${value.user}@${value.server}`
          : typeof value === 'string'
            ? value
            : ''),
    ).replace(/^(\d+):\d+@/, '$1@');
  const valid = (id: string) =>
    /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(id);
  const safe = (read: () => any) => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  const collection = get('WAWebCollections');
  const messages = collection?.Msg || get('WAWebMsgCollection')?.Msg;
  const contacts =
    collection?.Contact ||
    get('WAWebContactCollection')?.Contact ||
    safe(() =>
      page.WPP?.isReady ? page.WPP.whatsapp?.ContactStore : undefined,
    );
  const isSaved = (contact: any) =>
    Boolean(
      safe(() =>
        typeof contact?.isMyContact === 'function'
          ? contact.isMyContact()
          : contact?.isMyContact,
      ),
    );
  const contactPhone = (contact: any, aliases: string[]) => {
    const pn = aliases.find(alias => alias.endsWith('@c.us'))?.split('@')[0];
    if (pn) return pn;
    const formatted = String(
      safe(() => contact?.formattedPhone) ||
        safe(() => contact?.phoneNumber) ||
        '',
    );
    return /^\+?[\d\s()-]+$/.test(formatted) ? formatted : '';
  };
  const rows: ConversationItem[] = [];
  const seen = new Set<string>();
  for (const model of adapter.models()) {
    const id = idOf(model.id);
    if (!valid(id) || seen.has(id) || model.isPSA) continue;
    seen.add(id);
    const contact =
      safe(() => model.contact) ||
      safe(() => contacts?.get?.(model.id)) ||
      safe(() => contacts?.get?.(id));
    const aliases = [
      ...new Set(
        [id, idOf(contact?.id), idOf(contact?.phoneNumber)].filter(value =>
          valid(value),
        ),
      ),
    ];
    const phone = contactPhone(contact, aliases);
    const candidates = [
      safe(() => model.lastMessage),
      safe(() => model.msgs?.last?.()),
      safe(() => messages?.get?.(model.lastReceivedKey)),
    ];
    const last = candidates.find(
      value =>
        value &&
        typeof value === 'object' &&
        (value.type || value.body || value.caption || value.id),
    );
    const from =
      last?.isNotification || last?.isMdHistoryMsg
        ? undefined
        : (last?.id?.fromMe ?? last?.isSentByMe);
    const preview = String(
      safe(() => last?.body) ||
        safe(() => last?.caption) ||
        (
          {
            image: '[图片]',
            video: '[视频]',
            ptt: '[语音]',
            audio: '[音频]',
            document: '[文件]',
            revoked: '[消息已撤回]',
          } as Record<string, string>
        )[last?.type] ||
        '',
    ).slice(0, 160);
    rows.push({
      id,
      aliases,
      name: String(
        id.endsWith('@g.us')
          ? safe(() => model.formattedTitle) ||
              safe(() => model.name) ||
              id.split('@')[0]
          : isSaved(contact)
            ? safe(() => contact.name) ||
              safe(() => model.formattedTitle) ||
              safe(() => contact.pushname) ||
              phone ||
              '号码待同步'
            : phone || '号码待同步',
      ).slice(0, 160),
      phone,
      group: id.endsWith('@g.us'),
      archived: Boolean(model.archive),
      unread: Math.max(0, Number(model.unreadCount) || 0),
      preview,
      timestamp: Number(last?.t || model.t) || 0,
      lastFromMe: typeof from === 'boolean' ? from : undefined,
    });
  }
  const seenAliases = new Set(rows.flatMap(row => row.aliases));
  const all = safe(
    () => contacts?.getModelsArray?.() ?? contacts?.models ?? contacts?._models,
  );
  for (const contact of (Array.isArray(all)
    ? all
    : all && typeof all === 'object'
      ? Object.values(all)
      : []) as any[]) {
    const id = idOf(contact?.id);
    if (
      !valid(id) ||
      (!id.endsWith('@c.us') && !id.endsWith('@lid')) ||
      seen.has(id) ||
      !isSaved(contact)
    )
      continue;
    const aliases = [
      ...new Set([id, idOf(contact.phoneNumber)].filter(value => valid(value))),
    ];
    if (aliases.some(alias => seenAliases.has(alias))) continue;
    aliases.forEach(alias => seenAliases.add(alias));
    seen.add(id);
    rows.push({
      id,
      aliases,
      name: String(contact.name || contact.pushname || id.split('@')[0]).slice(
        0,
        160,
      ),
      phone: contactPhone(contact, aliases),
      group: false,
      archived: false,
      unread: 0,
      preview: '',
      timestamp: 0,
      contactOnly: true,
    });
  }
  return { rows, contactsReady: Boolean(all) };
}
export function setAggregateChatMode(enabled: boolean): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  const state = page.__zlChatListLayout;
  const root = document.documentElement;
  if (!enabled) {
    delete root.dataset.zlAggregateView;
    document.querySelector('#zl-aggregate-chat-style')?.remove();
    document.querySelectorAll('[data-zl-aggregate-split]').forEach(node => {
      Reflect.deleteProperty((node as HTMLElement).dataset, 'zlAggregateSplit');
      (node as HTMLElement).style.removeProperty('--zl-aggregate-columns');
    });
    return true;
  }
  if (!state?.column?.isConnected || !state?.pane?.isConnected) return false;
  if (
    !Object.hasOwn(root.dataset, 'zlAggregateView') &&
    state.split &&
    getComputedStyle(state.split).display.includes('grid')
  ) {
    const tracks = getComputedStyle(state.split).gridTemplateColumns.split(' ');
    const children = [...state.split.children];
    const left = children.indexOf(state.column);
    const right = children.indexOf(state.pane);
    if (left >= 0 && right >= 0 && tracks.length === children.length) {
      tracks[left] = '0px';
      tracks[right] = 'minmax(0,1fr)';
      state.split.dataset.zlAggregateSplit = 'true';
      state.split.style.setProperty('--zl-aggregate-columns', tracks.join(' '));
    }
  }
  let style = document.querySelector('#zl-aggregate-chat-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'zl-aggregate-chat-style';
    style.textContent =
      'html[data-zl-aggregate-view] [data-zl-chat-edge="list"]{display:none!important;width:0!important;min-width:0!important;max-width:0!important;flex:0 0 0!important}html[data-zl-aggregate-view] [data-zl-chat-edge="pane"]{min-width:0!important;width:auto!important;max-width:none!important;flex:1 1 0%!important}html[data-zl-aggregate-view] [data-zl-aggregate-split]>[data-zl-chat-edge="list"]{display:block!important;visibility:hidden!important;overflow:hidden!important;pointer-events:none!important}html[data-zl-aggregate-view] [data-zl-aggregate-split]{grid-template-columns:var(--zl-aggregate-columns)!important}html[data-zl-aggregate-view] [data-zl-chat-resize],html[data-zl-aggregate-view] [data-zl-chat-divider]{display:none!important}';
    document.head.append(style);
  }
  root.dataset.zlAggregateView = 'true';
  return true;
}
export async function readConversationAvatars(
  ids: string[],
  owners: string[],
): Promise<Record<string, string>> {
  const page = window as any;
  const result: Record<string, string> = {};
  if (
    globalThis.location.hostname !== 'web.whatsapp.com' ||
    !page.__zlCustomerAdapter
      ?.owners()
      .some((id: string) => owners.includes(id))
  )
    return result;
  let collection: any;
  try {
    collection =
      page.require?.('WAWebCollections')?.ProfilePicThumb ||
      page.WPP?.whatsapp?.ProfilePicThumbStore;
  } catch {
    return result;
  }
  await Promise.all(
    ids.slice(0, 24).map(async id => {
      try {
        const pic = collection?.get?.(id);
        const url = pic?.img || pic?.imgFull || pic?.previewEurl || pic?.eurl;
        if (
          typeof url !== 'string' ||
          !(
            /^(?:blob:|data:image\/)/.test(url) ||
            /^https:\/\/(?:[\da-z-]+\.)*whatsapp\.(?:net|com)\//i.test(url)
          )
        )
          return;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
        });
        const blob = await response.blob();
        if (blob.size > 1_000_000) return;
        const image = await createImageBitmap(blob);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          canvas.getContext('2d')?.drawImage(image, 0, 0, 64, 64);
          result[id] = canvas.toDataURL('image/jpeg', 0.7);
        } finally {
          image.close();
        }
      } catch {
        /* An unavailable avatar uses initials; it must not block the list. */
      }
    }),
  );
  if (
    !page.__zlCustomerAdapter
      ?.owners()
      .some((id: string) => owners.includes(id))
  )
    return {};
  return result;
}

// Scope read receipts to explicitly selected chats in the verified account.
export async function markConversationsRead(
  ids: string[],
  owners: string[],
): Promise<{ read: number; failed: number; halted: boolean }> {
  const page = window as any;
  const ownerMatches = () =>
    page.__zlCustomerAdapter
      ?.owners()
      .some((id: string) => owners.includes(id));
  if (globalThis.location.hostname !== 'web.whatsapp.com' || !ownerMatches())
    throw new Error('账号身份已改变，请刷新聚合会话');
  const sendSeen = page.require?.('WAWebUpdateUnreadChatAction')?.sendSeen;
  const models = page.__zlCustomerAdapter.models();
  if (typeof sendSeen !== 'function' || !Array.isArray(models))
    throw new Error('当前账号尚不支持标记已读，请检查 WhatsApp 页面');
  const targets = [...new Set(ids)].filter(id =>
    /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(id),
  );
  const byId = new Map(
    models.map((model: any) => [
      model.id?._serialized || String(model.id),
      model,
    ]),
  );
  let read = 0;
  let failed = 0;
  const until = Date.now() + 8000;
  for (let index = 0; index < targets.length; index += 1) {
    if (!ownerMatches() || Date.now() >= until)
      return { read, failed: failed + targets.length - index, halted: true };
    const chat: any = byId.get(targets[index]);
    if (!chat || !(chat.unreadCount > 0 || chat.unreadCount === -1)) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // Sequential requests avoid a burst of read receipts for a large folder.
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([
        sendSeen({ chat, threadId: undefined }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('标记已读超时'));
          }, 2000);
        }),
      ]);
      read += 1;
    } catch {
      if (timedOut)
        return { read, failed: failed + targets.length - index, halted: true };
      failed += 1;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { read, failed, halted: false };
}
