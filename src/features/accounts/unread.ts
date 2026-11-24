/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest function owns all event callbacks. */
// Independent from avatar, translation and account-profile requests.
export function watchWhatsAppUnread(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (page.__zlWaUnread) {
    page.__zlWaUnread.tick(true);
    return true;
  }
  const events = [
    'change:unreadCount',
    'change:lastMessage',
    'change:archive',
    'change:isArchived',
    'change:muteExpiration',
    'change:isMuted',
    'change:isAutoMuted',
    'add',
    'remove',
    'reset',
  ];
  const module = (name: string): any => {
    try {
      return page.require?.(name);
    } catch {
      return undefined;
    }
  };
  const idOf = (value: any) =>
    value?._serialized ||
    (value?.user && value?.server
      ? `${value.user}@${value.server}`
      : typeof value === 'string'
        ? value
        : '');
  const state: any = {
    collection: undefined,
    last: '',
    messages: new Map(),
    soundOwner: '',
    soundAt: 0,
    scheduled: false,
    disposed: false,
  };
  const read = (force = false) => {
    if (state.disposed) return;
    if (
      !document.querySelector('#pane-side, #side, #main') ||
      document.querySelector(
        '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
      )
    )
      return;
    const collection =
      module('WAWebCollections')?.Chat || page.WPP?.whatsapp?.ChatStore;
    if (collection !== state.collection) {
      for (const event of events)
        state.collection?.off?.(event, state.schedule);
      state.collection = collection;
      for (const event of events) collection?.on?.(event, state.schedule);
    }
    const chats = collection?.getModelsArray?.() ?? collection?.models;
    if (!Array.isArray(chats)) return;
    const prefs = module('WAWebUserPrefsMeUser');
    const ownerId = idOf(
      prefs?.getMaybeMePnUser?.() ??
        prefs?.getMaybeMeLidUser?.() ??
        module('WAWebConnModel')?.Conn?.wid,
    );
    if (!/^\d{5,30}@(c\.us|lid)$/.test(ownerId)) return;
    const socket = module('WAWebSocketModel')?.Socket?.state;
    const now = Date.now() / 1000;
    const live =
      !force && state.soundOwner === ownerId && now - state.soundAt < 15;
    if (state.soundOwner !== ownerId) state.messages.clear();
    let notify = false;
    let count = 0;
    if (!['UNPAIRED', 'UNPAIRED_IDLE'].includes(socket)) {
      for (const chat of chats) {
        const server = chat.id?.server || idOf(chat.id).split('@')[1];
        const expiration = Number(chat.muteExpiration ?? 0);
        const last = chat.lastMessage || chat.msgs?.last?.();
        const messageId = idOf(last?.id);
        const previous = state.messages.get(idOf(chat.id));
        const fresh =
          live &&
          messageId &&
          previous !== messageId &&
          (last?.id?.fromMe ?? last?.isSentByMe) === false &&
          Number(last?.t) <= now + 5 &&
          Number(last?.t) >= now - 30;
        // WhatsApp can publish the message before updating its unread count.
        // Retain that candidate until the unread event arrives.
        if (!fresh || chat.unreadCount !== 0)
          state.messages.set(idOf(chat.id), messageId);
        if (
          !chat.archive &&
          !chat.isArchived &&
          !chat.isPSA &&
          chat.isAutoMuted !== true &&
          chat.isMuted !== true &&
          !(expiration === -1 || expiration > now) &&
          ['c.us', 'lid', 'g.us'].includes(server) &&
          Number.isFinite(chat.unreadCount) &&
          (chat.unreadCount > 0 || chat.unreadCount === -1)
        ) {
          count += chat.unreadCount === -1 ? 1 : Math.floor(chat.unreadCount);
          if (chat.unreadCount > 0 && fresh) notify = true;
        }
      }
    }
    state.soundOwner = ownerId;
    state.soundAt = now;
    const signature = `${ownerId}:${count}`;
    if (
      (notify ||
        force ||
        signature !== state.last ||
        Date.now() - (state.lastPublishedAt ?? 0) >= 10_000) &&
      typeof page.ferdium?.pushWhatsAppUnread === 'function'
    ) {
      page.ferdium.pushWhatsAppUnread({
        ownerId,
        count,
        ...(notify ? { notify: true } : {}),
      });
      state.last = signature;
      state.lastPublishedAt = Date.now();
    }
  };
  function schedule() {
    if (state.scheduled || state.disposed) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      read();
    });
  }
  state.schedule = schedule;
  state.tick = read;
  state.dispose = () => {
    state.disposed = true;
    clearInterval(state.timer);
    state.observer?.disconnect();
    for (const event of events) state.collection?.off?.(event, state.schedule);
    if (page.__zlWaUnread === state) delete page.__zlWaUnread;
  };
  // Native model events work for background accounts and off-screen chats.
  // The observer/timer also covers late module initialization and DOM-only builds.
  const pane = document.querySelector('#pane-side');
  if (pane) {
    state.observer = new MutationObserver(schedule);
    state.observer.observe(pane, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-icon'],
    });
  }
  state.timer = setInterval(schedule, 2000);
  page.addEventListener('pagehide', state.dispose, { once: true });
  page.__zlWaUnread = state;
  read(true);
  return true;
}
