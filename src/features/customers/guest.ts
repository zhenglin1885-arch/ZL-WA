/* eslint-disable unicorn/consistent-function-scoping, no-continue, prefer-destructuring, unicorn/no-useless-undefined -- Serialized guest functions must be self-contained and skip unsupported native rows. */
import type { CustomerBundle, CustomerContext, CustomerAction } from './types';

export function readCustomerContext(): CustomerContext {
  const page = window as any;
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    return { token: '', owners: [] };
  page.__zlCustomerToken ??= crypto.randomUUID();
  const module = (name: string) => {
    try {
      return page.require?.(name);
    } catch {
      return undefined;
    }
  };
  const wid = (id: any): string => {
    const value =
      id?._serialized ||
      (id?.user && id?.server
        ? `${id.user}@${id.server}`
        : typeof id === 'string'
          ? id
          : '');
    return String(value).replace(/^(\d+):\d+@/, '$1@');
  };
  const call = (object: any, key: string) => {
    try {
      return object?.[key]?.();
    } catch {
      return undefined;
    }
  };
  const optional = (read: () => any) => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  // Resolve current native ownership on every use. Never borrow identity from
  // another account card, a chat title or previously saved login metadata.
  const readOwners = () => {
    if (
      ['UNPAIRED', 'UNPAIRED_IDLE'].includes(
        module('WAWebSocketModel')?.Socket?.state,
      ) ||
      document.querySelector('[data-ref] canvas, [data-testid="qrcode"]')
    )
      return [];
    const prefs = module('WAWebUserPrefsMeUser');
    const valid = (values: any[]) =>
      values
        .map(value => wid(value))
        .filter(id => /^\d{5,30}@(c\.us|lid)$/.test(id));
    const preferred = valid([
      call(prefs, 'getMaybeMePnUser'),
      call(prefs, 'getMaybeMeLidUser'),
      call(prefs, 'getMeUser'),
    ]);
    // During relogin Conn/helper metadata may lag behind the current prefs.
    // Never bind two different telephone owners together through that fallback.
    const ids =
      preferred.length > 0
        ? preferred
        : valid([
            module('WAWebConnModel')?.Conn?.wid,
            ...(page.WPP?.isReady
              ? [
                  call(page.WPP.conn, 'getMyUserId'),
                  optional(() => page.WPP.whatsapp?.Conn?.wid),
                ]
              : []),
          ]);
    return [
      ids.find(id => id.endsWith('@c.us')),
      ids.find(id => id.endsWith('@lid')),
    ].filter((id): id is string => id !== undefined);
  };
  const readModels = (): any[] => {
    const direct = module('WAWebChatCollection');
    const candidates = [
      module('WAWebCollections')?.Chat,
      direct?.Chat,
      direct?.ChatCollection,
      direct?.default,
      page.WPP?.isReady
        ? optional(() => page.WPP.whatsapp?.ChatStore)
        : undefined,
    ];
    for (const collection of candidates) {
      try {
        const value =
          collection?.getModelsArray?.() ??
          collection?.models ??
          collection?._models;
        const models = Array.isArray(value)
          ? value
          : value && typeof value === 'object'
            ? Object.values(value)
            : [];
        const valid = models.filter(model =>
          /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(wid(model?.id)),
        );
        if (valid.length > 0) return valid;
      } catch {
        /* A collection may still be synchronizing; try the next adapter. */
      }
    }
    return [];
  };
  page.__zlCustomerAdapter = { owners: readOwners, models: readModels, wid };
  const owners = readOwners();
  const models = readModels();
  const needsLibrary =
    owners.length === 0 ||
    (models.length === 0 &&
      Boolean(
        document.querySelector(
          '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
        ),
      ));
  const socketState = module('WAWebSocketModel')?.Socket?.state;
  const canInitialize =
    !['UNPAIRED', 'UNPAIRED_IDLE'].includes(socketState) &&
    !document.querySelector(
      '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
    ) &&
    Boolean(
      socketState === 'CONNECTED' ||
        document.querySelector('#pane-side, #side, #main header'),
    );
  const data = page.__zlCustomers?.data;
  const base = {
    token: page.__zlCustomerToken,
    owners,
    needsLibrary,
    canInitialize,
    installed: data
      ? { owner: data.owner, revision: data.revision }
      : undefined,
  };
  const header = document.querySelector('#main header');
  if (!header) return base;
  let chat: any;
  try {
    chat = page.WPP?.isReady ? page.WPP.chat?.getActiveChat?.() : undefined;
  } catch {
    /* The native collection remains available while the helper reloads. */
  }
  if (!chat?.id) {
    try {
      chat = module('WAWebChatGetters')?.getActiveChat?.();
    } catch {
      /* Try stable native identity sources below. */
    }
  }
  if (!chat?.id) {
    const active = models.filter(m => m.active === true);
    if (active.length === 1) [chat] = active;
  }
  if (!chat?.id) {
    // Message keys identify the actual conversation, even when the active-chat
    // getter has moved in a WhatsApp update. Never infer identity from a name
    // unless that name matches exactly one native model.
    const marker =
      document
        .querySelector('#main [data-id^="true_"], #main [data-id^="false_"]')
        ?.getAttribute('data-id') ||
      document.querySelector('#main [data-id]')?.getAttribute('data-id') ||
      '';
    const remote =
      /^(?:true|false)_([^_]+)_/.exec(marker)?.[1] ||
      header.querySelector('[data-jid]')?.getAttribute('data-jid') ||
      header.querySelector('[data-id]')?.getAttribute('data-id');
    if (remote)
      chat =
        models.find(m => wid(m.id) === remote) ||
        (/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(remote)
          ? { id: remote }
          : undefined);
  }
  if (!chat?.id) {
    const name = header.querySelector('[title]')?.getAttribute('title');
    const matches = name
      ? models.filter(m =>
          [
            m.formattedTitle,
            m.name,
            m.contact?.name,
            m.contact?.pushname,
          ].includes(name),
        )
      : [];
    if (matches.length === 1) [chat] = matches;
  }
  const id = wid(chat?.id);
  if (
    !document.querySelector('#main header') ||
    !/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(id)
  )
    return base;
  const { contact } = chat;
  const aliases = [
    ...new Set(
      [id, wid(contact?.id), wid(contact?.phoneNumber)].filter(value =>
        /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(value),
      ),
    ),
  ].slice(0, 2);
  return {
    ...base,
    chat: {
      id,
      aliases,
      name: String(
        chat.formattedTitle ||
          chat.name ||
          contact?.pushname ||
          document
            .querySelector('#main header [title]')
            ?.getAttribute('title') ||
          id.split('@')[0],
      ),
      phone:
        aliases.find(value => value.endsWith('@c.us'))?.split('@')[0] || '',
      group: id.endsWith('@g.us'),
    },
  };
}

// Only short remarks, labels and pin order enter the page. The full customer
// profile and long notes stay in the host application.
export function customerTick(
  input?: CustomerBundle,
  activeChatId?: string,
): CustomerAction[] {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return [];
  const page = window as any;
  if (!page.__zlCustomers) {
    const state: any = {
      queue: [],
      sequence: 0,
      revision: -1,
      dirty: true,
      layouts: new WeakMap(),
    };
    page.__zlCustomers = state;
    state.inlineDrafts = new Map();
    state.commits = new WeakMap();
    state.rowGeometry = new WeakMap();
    state.initialGeometry = new WeakMap();
    state.changedRows = new WeakSet();
    state.resizeTargets = new Set();
    if (typeof ResizeObserver !== 'undefined') {
      state.resizeObserver = new ResizeObserver(() => {
        state.dirty = true;
      });
    }
    state.watchSize = (element: Element | undefined | null) => {
      if (!element || !state.resizeObserver || state.resizeTargets.has(element))
        return;
      state.resizeTargets.add(element);
      state.resizeObserver.observe(element);
    };
    state.geometry = (
      row: HTMLElement,
      marker: HTMLElement,
      line?: HTMLElement | null,
      preview?: HTMLElement,
    ) => {
      const base = row.getBoundingClientRect();
      const relative = (element?: HTMLElement | null) => {
        if (!element?.isConnected) return [];
        const bounds = element.getBoundingClientRect();
        return [
          bounds.left - base.left,
          bounds.top - base.top,
          bounds.width,
          bounds.height,
        ].map(value => Math.round(value * 4) / 4);
      };
      const style = getComputedStyle(marker);
      return JSON.stringify([
        base.width,
        base.height,
        relative(marker),
        relative(line),
        relative(preview),
        style.fontSize,
        style.lineHeight,
      ]);
    };
    window.addEventListener('resize', () => {
      state.dirty = true;
    });
    document.fonts?.ready.then(() => {
      state.dirty = true;
    });
    document.fonts?.addEventListener('loadingdone', () => {
      state.dirty = true;
    });
    state.action = (
      chatId: string,
      action: string,
      value?: string,
      owner = state.data?.owner,
    ) => {
      state.sequence += 1;
      state.queue.push({ id: state.sequence, chatId, action, value, owner });
    };
    const style = document.createElement('style');
    style.dataset.zlCustomers = 'style';
    style.textContent = `
      .zl-chat-note{position:absolute;box-sizing:border-box;font:11px/13px sans-serif!important;text-indent:0!important;text-align:start!important;letter-spacing:normal!important;appearance:none!important;transform:none!important;color:#ff6060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:4;height:13px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;outline:none;cursor:text;pointer-events:auto!important;user-select:text!important;-webkit-user-select:text!important;-webkit-app-region:no-drag}
      .zl-chat-note::placeholder{color:#8a969c}
      .zl-chat-note:focus{box-shadow:0 1px #579dff}
      .zl-chat-note[data-save-state="error"]{box-shadow:0 1px #ff6060}
      .zl-customer-flags{display:inline-flex;gap:3px;vertical-align:middle;height:auto!important;margin-left:5px}
      .zl-customer-flag{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px!important;border-radius:50%;font:12px sans-serif;color:white}
    `;
    document.head.append(style);
    state.nativePins = new Map();
    state.setNativePin = (model: any, pin: number) => {
      if (Number(model.pin || 0) === pin) return;
      try {
        model.set?.({ pin });
      } catch {
        /* Older native model. */
      }
      if (Number(model.pin || 0) !== pin) {
        try {
          model.set?.('pin', pin);
        } catch {
          /* Property setter fallback. */
        }
      }
      if (Number(model.pin || 0) !== pin) Reflect.set(model, 'pin', pin);
    };
    // All entry points use one local transaction. Never invoke the native
    // server action for desktop pins, including UI commands bypassing the DOM.
    state.pinOwnerMatches = () =>
      Boolean(page.__zlCustomerAdapter?.owners().includes(state.data?.owner));
    state.changePin = (id: string, remove: boolean) => {
      if (
        !state.data ||
        !state.pinOwnerMatches() ||
        !state.models?.some((m: any) => state.idOf(m) === id)
      )
        return false;
      const key = state.data.aliases[id] || id;
      state.action(id, remove ? 'unpin' : 'pin');
      state.data = {
        ...state.data,
        pins: remove
          ? state.data.pins.filter((p: string) => p !== key)
          : [key, ...state.data.pins.filter((p: string) => p !== key)],
        unpinned: remove
          ? [...new Set([...(state.data.unpinned || []), key])]
          : (state.data.unpinned || []).filter((p: string) => p !== key),
      };
      // Update immediately, so the original UI closes and renders its own pin.
      for (const model of state.models) {
        const chat = state.data.aliases[state.idOf(model)] || state.idOf(model);
        if (!state.data.pins.includes(chat) && chat !== key) continue;
        if (!state.nativePins.has(model))
          state.nativePins.set(model, model.pin || 0);
        const index = state.data.pins.indexOf(chat);
        state.setNativePin(model, index < 0 ? 0 : 2_000_000_000 - index);
      }
      state.dirty = true;
      return true;
    };
    state.pinModules = new WeakSet();
    state.installPinCommands = () => {
      // Meta modules can be registered lazily after the first context menu.
      // Only inspect pin-specific modules, never execute the whole registry.
      let registry: any;
      try {
        registry = page.require?.('__debug')?.modulesMap;
      } catch {
        return;
      }
      for (const name of Object.keys(registry || {})) {
        if (!/^waweb.*pin/i.test(name) || /msg|message/i.test(name)) continue;
        try {
          const module = page.require(name);
          if (
            !module ||
            state.pinModules.has(module) ||
            typeof module.setPin !== 'function'
          )
            continue;
          const original = module.setPin;
          const command = function localPinCommand(this: any, ...args: any[]) {
            const [chat, enabled] = args;
            const id =
              state.idOf?.(chat) ||
              chat?._serialized ||
              (typeof chat === 'string' ? chat : '');
            if (typeof enabled === 'boolean' && state.changePin(id, !enabled))
              return Promise.resolve();
            return original.apply(this, args);
          };
          // Verify replacement before relaxing the UI's guard. Frozen exports
          // remain untouched and the capture handler continues to handle them.
          if (
            !Reflect.set(module, 'setPin', command) ||
            module.setPin !== command
          )
            continue;
          if (typeof module.getPinLimit === 'function') {
            const limit = module.getPinLimit;
            Reflect.set(
              module,
              'getPinLimit',
              function localPinLimit(this: any, ...args: any[]) {
                return state.pinOwnerMatches() && state.models?.length
                  ? Number.MAX_SAFE_INTEGER
                  : limit.apply(this, args);
              },
            );
          }
          state.pinModules.add(module);
        } catch {
          /* Unloaded or immutable native module; retry on the next tick. */
        }
      }
    };
    // Intercept before React's capture handlers on the chat list. Native rows
    // often consume mouse-down before the injected input's bubble listeners.
    for (const kind of [
      'pointerdown',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
    ]) {
      document.addEventListener(
        kind,
        event => {
          const target = event.target as Element;
          let line = target.closest?.<HTMLInputElement>('.zl-chat-note');
          if (!line && event instanceof MouseEvent) {
            const row = target.closest?.(
              '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
            );
            const candidate =
              row?.querySelector<HTMLInputElement>('.zl-chat-note');
            const bounds = candidate?.getBoundingClientRect();
            if (
              candidate &&
              bounds &&
              event.clientX >= bounds.left &&
              event.clientX < bounds.right &&
              event.clientY >= bounds.top &&
              event.clientY < bounds.bottom
            )
              line = candidate;
          }
          if (!line) return;
          event.stopImmediatePropagation();
          if (kind === 'pointerdown' || kind === 'mousedown') {
            line.focus({ preventScroll: true });
            if (target !== line) {
              event.preventDefault();
              line.setSelectionRange(line.value.length, line.value.length);
            }
          }
        },
        true,
      );
    }
    const rememberRow = (event: Event) => {
      const target = event.target as Element;
      const row = target.closest?.(
        '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
      );
      if (row) {
        state.menuChat = state.resolveRow?.(row) || '';
        state.installPinCommands();
      } else if (
        !target.closest?.(
          '[role="menu"], [role="menuitem"], [role="button"], [data-animate-dropdown], [data-animate-dropdown-item], [data-testid="mi-pin"], [data-testid="mi-unpin"], li, button',
        )
      )
        state.menuChat = '';
    };
    window.addEventListener('pointerdown', rememberRow, true);
    window.addEventListener('mousedown', rememberRow, true);
    document.addEventListener('contextmenu', rememberRow, true);
    document.addEventListener(
      'focusin',
      event => {
        if ((event.target as Element).closest?.('#pane-side [role="row"]'))
          rememberRow(event);
      },
      true,
    );
    const pinMenuEvent = (event: Event) => {
      const target = event.target as Element;
      const item = target.closest?.(
        '[role="menuitem"], [data-testid="mi-pin"], [data-testid="mi-unpin"], [data-animate-dropdown-item], [role="button"], li, button',
      );
      if (!item || !state.menuChat || !state.data) return;
      const text = (item.textContent || item.getAttribute('aria-label') || '')
        .replaceAll(/\s+/g, ' ')
        .trim();
      const icon =
        item.querySelector('[data-icon]')?.getAttribute('data-icon') || '';
      const unpin =
        /^(unpin chat|取消置顶(?:聊天)?)$/i.test(text) ||
        /^(unpin|pinned-off|pin-off)(?:-v\d+)?$/.test(icon);
      const pin =
        /^(pin chat|置顶(?:聊天)?)$/i.test(text) ||
        /^(pin|pinned)(?:-v\d+)?$/.test(icon);
      if (!pin && !unpin) return;
      const id = state.menuChat;
      if (!state.models?.some((m: any) => state.idOf(m) === id)) return;
      if (!state.pinOwnerMatches()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.handledPinItem === item) return;
      state.handledPinItem = item;
      const model = state.models.find((m: any) => state.idOf(m) === id);
      const explicitPin = /^(pin chat|置顶(?:聊天)?)$/i.test(text);
      state.changePin(id, unpin || (!explicitPin && Boolean(model?.pin)));
      item.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
        }),
      );
    };
    // Match and cancel both pointer/mouse-down and click: relying on click is
    // too late for native menus that open the three-pin limit dialog on down.
    for (const kind of ['pointerdown', 'mousedown', 'click'])
      window.addEventListener(kind, pinMenuEvent, true);
    state.observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (
          change.type !== 'childList' ||
          (change.target as Element).closest?.('[data-zl-customers]')
        )
          continue;
        const nativeChanged = [
          ...change.addedNodes,
          ...change.removedNodes,
        ].some(
          node =>
            !(
              node instanceof HTMLElement &&
              node.dataset.zlCustomers !== undefined
            ),
        );
        if (!nativeChanged) continue;
        const row = (change.target as Element).closest?.(
          '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
        );
        if (row) state.changedRows.add(row);
      }
      if (
        changes.some(c => {
          const target = c.target as Element;
          if (target.closest?.('[data-zl-customers]')) return false;
          if (
            c.type === 'attributes' &&
            (c.attributeName === 'class' || c.attributeName === 'style')
          )
            return Boolean(target.closest?.('#pane-side'));
          return true;
        })
      )
        state.dirty = true;
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'data-id', 'data-jid', 'class', 'style'],
    });
    document.addEventListener(
      'scroll',
      () => {
        state.dirty = true;
      },
      { capture: true, passive: true },
    );
  }
  const state = page.__zlCustomers;
  if (input) {
    if (state.data?.owner !== input.owner) {
      document
        .querySelectorAll('[data-zl-customers]:not(style)')
        .forEach(n => n.remove());
      state.editor = undefined;
      for (const [model, pin] of state.nativePins) {
        state.setNativePin(model, pin);
      }
      state.nativePins = new Map();
      state.inlineDrafts.clear();
    }
    state.data = input;
    for (const [key, draft] of state.inlineDrafts) {
      const prefix = `${input.owner}:`;
      if (key.startsWith(prefix)) {
        const id = key.slice(prefix.length);
        const canonicalKey = `${prefix}${input.aliases[id] || id}`;
        if (canonicalKey !== key) {
          if (!state.inlineDrafts.has(canonicalKey))
            state.inlineDrafts.set(canonicalKey, draft);
          state.inlineDrafts.delete(key);
        }
      }
      if (
        key.startsWith(prefix) &&
        !draft.error &&
        (input.summaries[key.slice(prefix.length)]?.remarkName || '') ===
          draft.value
      )
        state.inlineDrafts.delete(key);
    }
    state.dirty = true;
  }
  const { data } = state;
  if (!data) return state.queue.splice(0);
  const canonical = (id: string) => data.aliases[id] || id;
  const summary = (id: string) => data.summaries[canonical(id)];
  const flags = (id: string) => {
    const box = document.createElement('span');
    box.className = 'zl-customer-flags';
    box.dataset.zlCustomers = 'flags';
    const design = {
      priority: ['⚑', '#ee9200', '重点'],
      follow: ['↗', '#176aff', '跟票'],
      signup: ['✓', '#8551e9', '报名'],
      deposit: ['¥', '#df3b45', '入金'],
    };
    for (const flag of summary(id)?.flags ?? []) {
      const item = document.createElement('span');
      item.className = 'zl-customer-flag';
      item.textContent = design[flag][0];
      item.style.background = design[flag][1];
      item.title = design[flag][2];
      item.setAttribute('aria-label', design[flag][2]);
      box.append(item);
    }
    return box;
  };
  // Native row identifiers are preferred. Title matching is used only for a
  // unique exact name, never for two contacts sharing the same display name.
  const models: any[] = page.__zlCustomerAdapter?.models() || [];
  const idOf = (model: any) => page.__zlCustomerAdapter?.wid(model?.id) || '';
  const nameOf = (model: any) =>
    String(
      model.formattedTitle ||
        model.name ||
        model.contact?.name ||
        model.contact?.pushname ||
        model.id?.user ||
        '',
    );
  const names = new Map<string, string[]>();
  for (const model of models) {
    const name = nameOf(model);
    const matches = names.get(name);
    if (matches) matches.push(idOf(model));
    else names.set(name, [idOf(model)]);
  }
  const modelIds = new Set(models.map(model => idOf(model)));
  state.models = models;
  state.idOf = idOf;
  state.resolveRow = (row: HTMLElement) => {
    // Native virtual rows often have no data-jid. Read the exact model from
    // React props before any display-name fallback (duplicate names are valid).
    for (const element of [row, ...row.querySelectorAll('*')]) {
      const propsKey = Object.keys(element).find(k =>
        k.startsWith('__reactProps$'),
      );
      const props = propsKey ? (element as any)[propsKey] : undefined;
      for (const candidate of [
        props?.chat,
        props?.data?.chat,
        props?.chatModel,
        props?.data,
        props?.model,
      ]) {
        const id = idOf(candidate || {});
        if (id && modelIds.has(id)) return id;
      }
    }
    const possible = page.__zlCustomerAdapter?.wid(
      row.dataset.id ||
        row.dataset.jid ||
        row.querySelector('[data-id]')?.getAttribute('data-id') ||
        '',
    );
    if (modelIds.has(possible)) return possible;
    const markers = [
      ...row.querySelectorAll<HTMLElement>(
        '[data-testid="cell-frame-title"] [title], [title]:not([data-zl-customers])',
      ),
    ].filter(marker => !marker.closest('[data-zl-customers]'));
    const ids = [
      ...new Set(
        markers.flatMap(marker => {
          const name = marker.getAttribute('title') || marker.textContent || '';
          return names.get(name)?.length === 1 ? names.get(name)! : [];
        }),
      ),
    ];
    return ids.length === 1 ? ids[0] : '';
  };
  state.installPinCommands();
  // Project local pins onto the native model, so WhatsApp's own collection,
  // virtual list, pin glyph and menu all render the normal pinned-chat state.
  // Do not call setPin / server chat actions: their three-chat limit and phone
  // synchronization must not control this desktop-only order.
  if (!data.pinsInitialized && models.length > 0) {
    const native = models
      .filter(m => m.pin)
      .sort((a, b) => Number(b.pin) - Number(a.pin));
    const ids = native.map(m => idOf(m));
    data.pins = [...new Set([...data.pins, ...ids.map(id => canonical(id))])];
    data.pinsInitialized = true;
    state.action('', 'importPins', JSON.stringify(ids));
  }
  for (const model of models) {
    const index = data.pins.indexOf(canonical(idOf(model)));
    // Do not erase official pins merely because an old local bundle lacks them.
    // Only explicit local pins/cancellations may change a native pin value.
    if (index < 0 && !data.unpinned?.includes(canonical(idOf(model)))) continue;
    if (!state.nativePins.has(model))
      state.nativePins.set(model, model.pin || 0);
    // A fixed base keeps incoming-message timestamps from moving local pins.
    const projected = index < 0 ? 0 : 2_000_000_000 - index;
    if (Number(model.pin || 0) !== projected) {
      state.setNativePin(model, projected);
    }
  }
  if (state.dirty || Date.now() - (state.lastRender || 0) > 2000) {
    state.dirty = false;
    state.lastRender = Date.now();
    const pane = document.querySelector<HTMLElement>('#pane-side');
    if (pane) {
      for (const element of state.resizeTargets) {
        if (!element.isConnected) {
          state.resizeObserver.unobserve(element);
          state.resizeTargets.delete(element);
        }
      }
      state.watchSize(pane);
      const rows = [
        ...pane.querySelectorAll<HTMLElement>(
          '[role="row"], [data-testid="cell-frame-container"]',
        ),
      ];
      const seen = new Set<Element>();
      for (const candidate of rows) {
        const row = candidate.closest<HTMLElement>('[role="row"]') || candidate;
        if (seen.has(row)) continue;
        seen.add(row);
        const match = state.resolveRow(row);
        const marker = [
          ...row.querySelectorAll<HTMLElement>(
            '[data-testid="cell-frame-title"] span, [title]:not([data-zl-customers])',
          ),
        ].find(element =>
          names
            .get(element.getAttribute('title') || element.textContent || '')
            ?.includes(match),
        );
        if (!marker) continue;
        const key = `${match}:${data.revision}`;
        const existingNote =
          row.querySelector<HTMLInputElement>('.zl-chat-note');
        const previousGeometry = state.rowGeometry.get(row);
        if (
          existingNote &&
          document.activeElement === existingNote &&
          row.dataset.zlCustomerKey?.startsWith(`${match}:`)
        )
          continue;
        if (
          row.dataset.zlCustomerKey === key &&
          row.dataset.zlCustomerRendered === 'true' &&
          existingNote &&
          !state.changedRows.has(row) &&
          previousGeometry?.marker === marker &&
          previousGeometry.signature ===
            state.geometry(row, marker, existingNote, previousGeometry.preview)
        )
          continue;
        state.watchSize(row);
        state.watchSize(marker);
        // A newly logged-in list can still be hidden, animating or waiting for
        // its initial font/layout. Wait for two stable samples before adding
        // the third line; later resizes invalidate the geometry cache above.
        if (!existingNote) {
          const bounds = row.getBoundingClientRect();
          const nameBounds = marker.getBoundingClientRect();
          if (
            !bounds.width ||
            !bounds.height ||
            !nameBounds.width ||
            !nameBounds.height
          ) {
            state.dirty = true;
            continue;
          }
          const signature = state.geometry(row, marker);
          const initial = state.initialGeometry.get(row);
          if (!initial || initial.signature !== signature) {
            state.initialGeometry.set(row, { signature, at: Date.now() });
            state.dirty = true;
            continue;
          }
          if (Date.now() - initial.at < 150) {
            state.dirty = true;
            continue;
          }
        }
        for (const element of [row, ...row.querySelectorAll('*')]) {
          const old = state.layouts.get(element);
          if (old) {
            (element as HTMLElement).style.position = old.position;
            (element as HTMLElement).style.top = old.top;
            state.layouts.delete(element);
          }
        }
        row.querySelectorAll('[data-zl-customers]').forEach(n => {
          state.commits.get(n)?.();
          n.remove();
        });
        row.dataset.zlCustomerKey = key;
        if (!match) continue;
        let titleLine =
          marker.closest<HTMLElement>('[data-testid="cell-frame-title"]') ||
          marker.parentElement;
        if (!titleLine) continue;
        let preview: HTMLElement | undefined;
        // Native title wrappers can contain badges and timestamps. Find the
        // next line below the name rather than treating a badge as the preview.
        for (
          let current: HTMLElement | null = titleLine;
          current && current !== row;
          current = current.parentElement
        ) {
          const next = current.nextElementSibling as HTMLElement | null;
          if (!next || next.dataset.zlCustomers) continue;
          const bounds = next.getBoundingClientRect();
          const nameBounds = marker.getBoundingClientRect();
          if (
            bounds.width > 50 &&
            bounds.top >= nameBounds.bottom - 3 &&
            Math.abs(bounds.left - nameBounds.left) < 35
          ) {
            titleLine = current;
            preview = next;
            break;
          }
        }
        state.layouts.set(titleLine, {
          position: titleLine.style.position,
          top: titleLine.style.top,
        });
        if (getComputedStyle(titleLine).position === 'static')
          titleLine.style.position = 'relative';
        titleLine.append(flags(match));
        row.dataset.zlCustomerRendered = 'true';
        const note = summary(match)?.remarkName;
        {
          const line = document.createElement('input');
          line.className = 'zl-chat-note';
          line.dataset.zlCustomers = 'note';
          const owner = data.owner;
          const draftKey = () =>
            `${owner}:${state.data.aliases[match] || match}`;
          const savedNote = note || '';
          const draft = state.inlineDrafts.get(draftKey());
          line.type = 'text';
          line.maxLength = 100;
          line.placeholder = '添加备注';
          line.setAttribute('aria-label', '聊天备注名');
          line.dataset.chatId = match;
          line.value = draft?.value ?? savedNote;
          line.title =
            draft?.error ||
            line.value ||
            '点击填写备注，Enter 保存，Esc 取消未保存的修改';
          line.dataset.saveState = draft?.error
            ? 'error'
            : draft
              ? 'pending'
              : 'saved';
          let committed = savedNote;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let composing = false;
          const commit = () => {
            clearTimeout(timer);
            if (composing || state.data?.owner !== owner) return;
            const value = line.value;
            const current = state.inlineDrafts.get(draftKey());
            if (value === committed && !current?.error) return;
            committed = value;
            state.inlineDrafts.set(draftKey(), { value });
            line.dataset.saveState = 'pending';
            state.action(match, 'saveRemark', value, owner);
          };
          state.commits.set(line, commit);
          line.addEventListener('input', () => {
            state.inlineDrafts.set(draftKey(), { value: line.value });
            clearTimeout(timer);
            if (!composing) timer = setTimeout(commit, 350);
          });
          line.addEventListener('compositionstart', () => {
            composing = true;
            clearTimeout(timer);
          });
          line.addEventListener('compositionend', () => {
            composing = false;
            clearTimeout(timer);
            timer = setTimeout(commit, 350);
          });
          line.addEventListener('pointerdown', event =>
            event.stopPropagation(),
          );
          line.addEventListener('click', event => event.stopPropagation());
          line.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              line.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              clearTimeout(timer);
              line.value = committed;
              const currentSaved =
                state.data.summaries[state.data.aliases[match] || match]
                  ?.remarkName || '';
              if (
                committed === currentSaved ||
                line.dataset.saveState === 'saved'
              )
                state.inlineDrafts.delete(draftKey());
              else state.inlineDrafts.set(draftKey(), { value: committed });
              line.blur();
            }
          });
          line.addEventListener('blur', () => {
            commit();
            state.dirty = true;
          });
          // Keep WhatsApp's virtual row height unchanged while making room for
          // the third text line between the native title and message preview.
          titleLine.style.top = `${(Number.parseFloat(getComputedStyle(titleLine).top) || 0) - 6}px`;
          const rowBounds = row.getBoundingClientRect();
          const nameBounds = marker.getBoundingClientRect();
          // Keep the editor outside native title wrappers, which may clip it
          // or place a pointer overlay over their overflowing third line.
          if (getComputedStyle(row).position === 'static') {
            state.layouts.set(row, {
              position: row.style.position,
              top: row.style.top,
            });
            row.style.position = 'relative';
          }
          line.style.left = `${Math.max(0, nameBounds.left - rowBounds.left)}px`;
          const textRight =
            preview?.getBoundingClientRect().right || rowBounds.right - 18;
          const width = Math.max(0, textRight - nameBounds.left);
          line.style.width = `${width}px`;
          line.style.top = `${Math.max(0, nameBounds.bottom - rowBounds.top + 1)}px`;
          row.append(line);
          // Native row borders, padding and containing blocks can shift an
          // absolutely positioned input. Align the rendered box with the name,
          // rather than assuming the row's border box is its CSS origin.
          const actual = line.getBoundingClientRect();
          const scaleX =
            width > 0 && actual.width > 0 ? actual.width / width : 1;
          const scaleY = actual.height > 0 ? actual.height / 13 : 1;
          line.style.left = `${Number.parseFloat(line.style.left) + (nameBounds.left - actual.left) / scaleX}px`;
          line.style.top = `${Number.parseFloat(line.style.top) + (nameBounds.bottom + 1 - actual.top) / scaleY}px`;
          line.style.width = `${width / scaleX}px`;
          if (preview && !preview.dataset.zlCustomers) {
            state.layouts.set(preview, {
              position: preview.style.position,
              top: preview.style.top,
            });
            if (getComputedStyle(preview).position === 'static')
              preview.style.position = 'relative';
            const initialTop =
              Number.parseFloat(getComputedStyle(preview).top) || 0;
            const gap =
              line.getBoundingClientRect().bottom +
              1 -
              preview.getBoundingClientRect().top;
            // Move upward as well as downward to remove native margins; a
            // minimum positive shift previously left large blank bands.
            preview.style.top = `${initialTop + gap / scaleY}px`;
          }
          state.rowGeometry.set(row, {
            marker,
            preview,
            signature: state.geometry(row, marker, line, preview),
          });
          state.changedRows.delete(row);
          state.watchSize(titleLine);
          state.watchSize(preview);
        }
      }
    }
    let active = activeChatId || '';
    try {
      active ||= idOf(
        (page.WPP?.isReady ? page.WPP.chat?.getActiveChat?.() : undefined) ||
          page.require?.('WAWebChatGetters')?.getActiveChat?.(),
      );
    } catch {
      /* No conversation. */
    }
    const header = document.querySelector('#main header');
    // Remove notes left by an older injected version without touching native text.
    header?.querySelectorAll('.zl-header-note').forEach(n => n.remove());
    if (
      header &&
      (state.headerKey !== `${active}:${data.revision}` ||
        !header.querySelector('[data-zl-customers=header]'))
    ) {
      header.querySelectorAll('[data-zl-customers]').forEach(n => n.remove());
      const name = header.querySelector('[title]');
      if (name && active) {
        const line = document.createElement('span');
        line.dataset.zlCustomers = 'header';
        const markers = flags(active);
        if (markers.childNodes.length > 0) {
          line.append(markers);
          name.after(line);
        }
      }
      state.headerKey = `${active}:${data.revision}`;
    }
  }
  return state.queue.splice(0);
}

// Acknowledge only the same account/chat/value: an older save must not replace
// a newer inline draft, including after a row is recycled by the virtual list.
export function customerRemarkResult(
  owner: string,
  chatId: string,
  value: string,
  error?: string,
) {
  const state = (window as any).__zlCustomers;
  if (!state?.data || state.data.owner !== owner) return;
  const canonical = state.data.aliases[chatId] || chatId;
  const key = `${owner}:${canonical}`;
  if (state.inlineDrafts.get(key)?.value !== value) return;
  if (error) state.inlineDrafts.set(key, { value, error });
  else state.inlineDrafts.delete(key);
  for (const input of document.querySelectorAll<HTMLInputElement>(
    '.zl-chat-note',
  )) {
    const id = input.dataset.chatId || '';
    if ((state.data.aliases[id] || id) !== canonical || input.value !== value)
      continue;
    input.dataset.saveState = error ? 'error' : 'saved';
    input.title = error ? `保存失败：${error}，点击后可重试` : '已保存到本机';
  }
  state.dirty = true;
}
