/* eslint-disable no-continue -- Skip structural nodes that cannot carry a full-height seam. */
// Keep list sizing local to this account's browser partition; never reload chats.
export function configureWhatsAppLayout(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  const side =
    document.querySelector<HTMLElement>('#side') ||
    document.querySelector<HTMLElement>('#pane-side') ||
    document.querySelector<HTMLElement>('[data-testid="chat-list-pane"]');
  if (!side) {
    if (page.__zlChatListLayout?.button)
      page.__zlChatListLayout.button.hidden = true;
    if (page.__zlChatListLayout?.divider)
      page.__zlChatListLayout.divider.hidden = true;
    return false;
  }
  if (!page.__zlChatListLayout) {
    let width = 0;
    try {
      width = Number(localStorage.getItem('zl-chat-list-width')) || 0;
    } catch {
      /* Browser storage may be unavailable. */
    }
    const state: any = { width };
    page.__zlChatListLayout = state;
    const style = document.createElement('style');
    style.textContent =
      '[data-zl-chat-column]{box-sizing:border-box!important;width:var(--zl-chat-list-width)!important;min-width:var(--zl-chat-list-width)!important;max-width:var(--zl-chat-list-width)!important;flex:0 0 var(--zl-chat-list-width)!important}[data-zl-chat-inner]{box-sizing:border-box!important;width:auto!important;min-width:0!important;max-width:100%!important;flex:1 1 0%!important}[data-zl-chat-pane]{min-width:0!important;width:auto!important;max-width:none!important;flex:1 1 0%!important}[data-zl-chat-grid]{grid-template-columns:var(--zl-chat-grid-columns)!important}[data-zl-chat-edge="list"],[data-zl-chat-inner]{border-right-color:transparent!important;box-shadow:none!important}[data-zl-chat-edge="pane"],[data-zl-chat-edge="pane"] #main{border-left-color:transparent!important;box-shadow:none!important}[data-zl-chat-edge="list"]::after,[data-zl-chat-inner]::after{border-right-color:transparent!important;box-shadow:none!important}[data-zl-chat-edge="pane"]::before,[data-zl-chat-edge="pane"] #main::before{border-left-color:transparent!important;box-shadow:none!important}[data-zl-chat-seam]{box-shadow:none!important}[data-zl-chat-seam-line]{background:transparent!important;border-color:transparent!important;box-shadow:none!important}[data-zl-chat-seam-before]::before,[data-zl-chat-seam-after]::after,html body #app [data-zl-chat-seam-before]::before,html body #app [data-zl-chat-seam-after]::after{background:transparent!important;border-color:transparent!important;box-shadow:none!important}[data-zl-chat-resize]{position:fixed!important;left:0;top:0;z-index:2147483000;opacity:0;pointer-events:none;width:28px;height:34px;padding:3px;border:0;border-radius:5px;background:transparent;color:var(--primary,#8696a0);cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center}[data-zl-chat-resize][data-zl-visible="true"],[data-zl-chat-resize]:focus-visible{opacity:1;pointer-events:auto}[data-zl-chat-divider]{position:fixed!important;z-index:2147482999;width:10px;background:transparent!important;border:0!important;outline:0!important;box-shadow:none!important;cursor:ew-resize;touch-action:none}[data-zl-chat-divider][hidden],[data-zl-chat-resize][hidden]{display:none!important}[data-zl-chat-resize]:hover,[data-zl-chat-resize]:focus-visible{background:rgba(128,128,128,.22);outline:2px solid currentColor;outline-offset:-2px}';
    document.head.append(style);
    state.apply = (value: number, persist = false) => {
      const rect = state.column.getBoundingClientRect();
      const available =
        (state.split?.getBoundingClientRect().right || window.innerWidth) -
        rect.left;
      const min = Math.min(240, Math.max(120, available * 0.35));
      const max = Math.max(min, available - Math.min(300, available / 2));
      const next = Math.round(Math.min(max, Math.max(min, value)));
      state.width = next;
      state.column.dataset.zlChatColumn = 'true';
      state.column.style.setProperty('--zl-chat-list-width', `${next}px`);
      // Resize the actual split tracks too. Fixed percentage/grid tracks on
      // WhatsApp's parent otherwise leave the right pane at its old width.
      if (state.split && state.pane) {
        state.pane.dataset.zlChatPane = 'true';
        const computed = getComputedStyle(state.split);
        if (computed.display.includes('grid')) {
          const tracks = computed.gridTemplateColumns.split(' ');
          if (
            tracks.length > 1 &&
            tracks.every((track: string) => /^\d+(?:\.\d+)?px$/.test(track))
          ) {
            let x =
              state.split.getBoundingClientRect().left +
              (Number.parseFloat(computed.paddingLeft) || 0) +
              (Number.parseFloat(computed.borderLeftWidth) || 0);
            const paneLeft = state.pane.getBoundingClientRect().left;
            let leftTrack = -1;
            let rightTrack = -1;
            tracks.forEach((track: string, index: number) => {
              if (Math.abs(x - rect.left) < 5) leftTrack = index;
              if (Math.abs(x - paneLeft) < 5) rightTrack = index;
              x +=
                Number.parseFloat(track) +
                (Number.parseFloat(computed.columnGap) || 0);
            });
            if (leftTrack >= 0 && rightTrack >= 0 && leftTrack !== rightTrack) {
              tracks[leftTrack] = `${next}px`;
              tracks[rightTrack] = 'minmax(0,1fr)';
              state.split.dataset.zlChatGrid = 'true';
              state.split.style.setProperty(
                '--zl-chat-grid-columns',
                tracks.join(' '),
              );
            }
          }
        }
      }
      state.cleanSeams?.();
      state.position?.();
      if (persist) {
        try {
          localStorage.setItem('zl-chat-list-width', String(next));
        } catch {
          /* Sizing still works without persistence. */
        }
      }
    };
    // The welcome/chat pane can contain a second full-height border or a
    // one-pixel separator at the old split position. Scope visual cleanup to
    // full-height structural nodes; leave message/card borders untouched.
    state.cleanSeams = () => {
      const pane = state.pane as HTMLElement | undefined;
      const bounds = pane?.getBoundingClientRect();
      const marked = new Set<HTMLElement>();
      state.seamStyles ||= new Map();
      for (const node of state.seams || []) {
        const saved = state.seamStyles.get(node);
        if (saved)
          for (const [property, [value, priority]] of saved) {
            if (value) node.style.setProperty(property, value, priority);
            else node.style.removeProperty(property);
          }
        state.seamStyles.delete(node);
        for (const attribute of [
          'zlChatSeam',
          'zlChatSeamLine',
          'zlChatSeamBefore',
          'zlChatSeamAfter',
        ])
          Reflect.deleteProperty(node.dataset, attribute);
      }
      const paint = (node: HTMLElement, property: string, value: string) => {
        let saved = state.seamStyles.get(node);
        if (!saved) {
          saved = new Map();
          state.seamStyles.set(node, saved);
        }
        if (!saved.has(property))
          saved.set(property, [
            node.style.getPropertyValue(property),
            node.style.getPropertyPriority(property),
          ]);
        node.style.setProperty(property, value, 'important');
      };
      if (pane && bounds && bounds.height > 0) {
        const nearSplit = (x: number) =>
          Math.abs(x - bounds.left) <= 4 ||
          Math.abs(x - (state.nativeBoundary ?? bounds.left)) <= 4 ||
          (x >= bounds.left &&
            x - bounds.left <= Math.min(180, bounds.width / 3));
        const nodes = [pane];
        for (let index = 0; index < nodes.length && index < 100; index += 1) {
          const node = nodes[index];
          const rect = node.getBoundingClientRect();
          if (rect.height < bounds.height * 0.8) continue;
          nodes.push(
            ...[...node.children].filter(
              (child): child is HTMLElement => child instanceof HTMLElement,
            ),
          );
          const computed = getComputedStyle(node);
          const direction = computed.direction === 'rtl';
          for (const [edge, logical, x, value] of [
            [
              'left',
              direction ? 'end' : 'start',
              rect.left,
              computed.borderLeftWidth,
            ],
            [
              'right',
              direction ? 'start' : 'end',
              rect.right,
              computed.borderRightWidth,
            ],
          ] as const) {
            const width = Number.parseFloat(value);
            if (width > 0 && width <= 3 && nearSplit(x)) {
              node.dataset.zlChatSeam = 'true';
              paint(node, `border-${edge}-color`, 'transparent');
              paint(node, `border-inline-${logical}-color`, 'transparent');
              paint(node, 'box-shadow', 'none');
              marked.add(node);
            }
          }
          if (rect.width > 0 && rect.width <= 3 && nearSplit(rect.left)) {
            node.dataset.zlChatSeamLine = 'true';
            paint(node, 'background', 'transparent');
            paint(node, 'border-color', 'transparent');
            paint(node, 'outline-color', 'transparent');
            paint(node, 'box-shadow', 'none');
            marked.add(node);
          }
          for (const [pseudo, attribute] of [
            ['::before', 'zlChatSeamBefore'],
            ['::after', 'zlChatSeamAfter'],
          ]) {
            const decoration = getComputedStyle(node, pseudo);
            if (
              decoration.content === 'none' ||
              decoration.content === 'normal'
            )
              continue;
            const width = Number.parseFloat(decoration.width);
            const height = Number.parseFloat(decoration.height);
            const offset = Number.parseFloat(decoration.left);
            const x = Number.isFinite(offset)
              ? rect.left + offset
              : rect.right - width - (Number.parseFloat(decoration.right) || 0);
            if (width <= 3 && height >= bounds.height * 0.8 && nearSplit(x)) {
              node.dataset[attribute] = 'true';
              marked.add(node);
            }
          }
        }
      }
      state.seams = marked;
    };
    const finishDrag = () => {
      if (!state.drag) return;
      if (state.drag.moved) state.apply(state.width, true);
      state.suppressClick = state.drag.moved;
      document.documentElement.style.cursor = state.drag.cursor;
      document.documentElement.style.userSelect = state.drag.selection;
      state.drag = undefined;
      state.position?.();
    };
    // Capture before React consumes the native header's pointer events. Keep
    // tracking at window level even if WhatsApp replaces the header mid-drag.
    window.addEventListener(
      'pointerdown',
      event => {
        const button = (event.target as Element)?.closest?.(
          '[data-zl-chat-resize], [data-zl-chat-divider]',
        );
        if (!button || event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        state.suppressClick = false;
        try {
          (button as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          /* Window tracking remains available. */
        }
        state.drag = {
          id: event.pointerId,
          x: event.clientX,
          width: state.column.getBoundingClientRect().width,
          moved: false,
          cursor: document.documentElement.style.cursor,
          selection: document.documentElement.style.userSelect,
        };
        document.documentElement.style.cursor = 'ew-resize';
        document.documentElement.style.userSelect = 'none';
        state.nearBoundary = true;
        state.position?.();
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      event => {
        if (!state.drag && state.column) {
          const rect = state.column.getBoundingClientRect();
          const near =
            (Math.abs(event.clientX - rect.right) <= 12 &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom) ||
            Boolean(
              (event.target as Element)?.closest?.('[data-zl-chat-resize]'),
            );
          if (state.nearBoundary !== near) {
            state.nearBoundary = near;
            state.position?.();
          }
        }
        if (!state.drag || state.drag.id !== event.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const delta = event.clientX - state.drag.x;
        if (Math.abs(delta) > 3) state.drag.moved = true;
        if (state.drag.moved) state.apply(state.drag.width + delta);
      },
      true,
    );
    for (const type of ['pointerup', 'pointercancel'])
      window.addEventListener(
        type,
        event => {
          if (
            !state.drag ||
            state.drag.id !== (event as PointerEvent).pointerId
          )
            return;
          event.stopImmediatePropagation();
          finishDrag();
        },
        true,
      );
    window.addEventListener('blur', () => {
      finishDrag();
      state.nearBoundary = false;
      state.position?.();
    });
    window.addEventListener(
      'pointerout',
      event => {
        if (!event.relatedTarget && !state.drag) {
          state.nearBoundary = false;
          state.position?.();
        }
      },
      true,
    );
    window.addEventListener(
      'click',
      event => {
        if (!(event.target as Element)?.closest?.('[data-zl-chat-resize]'))
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!state.suppressClick) {
          const rect = state.column.getBoundingClientRect();
          const available = window.innerWidth - rect.left;
          const wide = Math.max(
            240,
            Math.min(560, available * 0.65, available - 300),
          );
          const narrow = Math.min(340, wide - 80);
          state.apply(
            rect.width < (Math.max(240, narrow) + wide) / 2 ? wide : narrow,
            true,
          );
        }
        state.suppressClick = false;
      },
      true,
    );
    window.addEventListener('resize', () => {
      if (state.width) state.apply(state.width);
      state.position?.();
    });
    if (typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (state.refreshPending) return;
        state.refreshPending = true;
        requestAnimationFrame(() => {
          state.refreshPending = false;
          configureWhatsAppLayout();
        });
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  const state = page.__zlChatListLayout;
  // Find the two real WhatsApp panes geometrically, including the welcome
  // screen (which has no #main) and wrappers with padding or fixed tracks.
  let column: HTMLElement = side;
  let split: HTMLElement | undefined;
  let pane: HTMLElement | undefined;
  for (
    let branch: HTMLElement = side;
    branch.parentElement && branch.parentElement !== document.body;
    branch = branch.parentElement
  ) {
    const rect = branch.getBoundingClientRect();
    const sibling = [...branch.parentElement.children].find(node => {
      if (node === branch || !(node instanceof HTMLElement)) return false;
      const other = node.getBoundingClientRect();
      const { position } = getComputedStyle(node);
      return (
        position !== 'absolute' &&
        position !== 'fixed' &&
        other.width >= 150 &&
        other.height >= 180 &&
        other.left >= rect.right - 5 &&
        Math.min(other.bottom, rect.bottom) - Math.max(other.top, rect.top) >=
          Math.min(180, rect.height * 0.6)
      );
    }) as HTMLElement | undefined;
    if (sibling) {
      column = branch;
      split = branch.parentElement;
      pane = sibling;
      break;
    }
  }
  if (
    state.column !== column ||
    state.split !== split ||
    state.pane !== pane ||
    state.side !== side
  ) {
    if (state.column) delete state.column.dataset.zlChatEdge;
    if (state.pane) delete state.pane.dataset.zlChatEdge;
    state.column?.removeAttribute('data-zl-chat-column');
    state.column?.style.removeProperty('--zl-chat-list-width');
    for (const node of state.inner || []) delete node.dataset.zlChatInner;
    state.pane?.removeAttribute('data-zl-chat-pane');
    state.split?.removeAttribute('data-zl-chat-grid');
    state.split?.style.removeProperty('--zl-chat-grid-columns');
    state.column = column;
    state.split = split;
    state.pane = pane;
    state.nativeBoundary = pane?.getBoundingClientRect().left;
    state.inner = [];
    for (
      let node: HTMLElement = side;
      node !== column && node.parentElement;
      node = node.parentElement
    ) {
      node.dataset.zlChatInner = 'true';
      state.inner.push(node);
    }
  }
  state.side = side;
  state.column.dataset.zlChatEdge = 'list';
  if (state.pane) state.pane.dataset.zlChatEdge = 'pane';
  if (state.width) state.apply(state.width);
  else state.cleanSeams();
  if (!state.button?.isConnected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.zlChatResize = 'true';
    button.setAttribute('aria-label', '调整聊天列表宽度');
    button.title = '拖动调整宽度';
    button.innerHTML =
      '<svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true"><path d="M8 3v16M12 3v16M4 8l-2 3 2 3M16 8l2 3-2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      state.apply(
        state.column.getBoundingClientRect().width +
          (event.key === 'ArrowLeft' ? -30 : 30),
        true,
      );
    });
    button.addEventListener('focus', () => state.position?.());
    button.addEventListener('blur', () => state.position?.());
    state.button = button;
    // Keep the handle outside React-owned headers and overflow-clipped list
    // wrappers. Its fixed position follows only the WhatsApp split boundary.
    document.body.append(button);
  }
  if (!state.divider?.isConnected) {
    const divider = document.createElement('div');
    divider.dataset.zlChatDivider = 'true';
    divider.setAttribute('aria-hidden', 'true');
    state.divider = divider;
    document.body.append(divider);
  }
  state.position = () => {
    const button = state.button as HTMLButtonElement;
    const rect = state.column.getBoundingClientRect();
    const root = state.column as HTMLElement;
    const header = root.querySelector<HTMLElement>(
      'header, [data-testid="chat-list-header"], [role="banner"]',
    );
    const newChat = root.querySelector<HTMLElement>(
      '[aria-label="New chat"], [aria-label="新聊天"], [aria-label="发起新聊天"], [title="New chat"], [data-testid="menu-bar-chat"], [data-icon="new-chat-outline"], [data-icon="chat-new"], [data-icon="wds-ic-chat-plus"], [data-icon="wds-ic-plus"]',
    );
    const anchor =
      newChat?.getBoundingClientRect() || header?.getBoundingClientRect();
    const modal = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ].some(node => node.getClientRects().length > 0 && !root.contains(node));
    button.hidden =
      !state.side.isConnected || rect.width <= 0 || rect.height <= 0 || modal;
    state.divider.hidden = button.hidden;
    if (button.hidden) return;
    button.dataset.zlVisible = String(
      Boolean(
        state.nearBoundary || state.drag || document.activeElement === button,
      ),
    );
    state.divider.style.left = `${Math.round(rect.right - 5)}px`;
    state.divider.style.top = `${Math.round(rect.top)}px`;
    state.divider.style.height = `${Math.round(rect.height)}px`;
    button.style.left = `${Math.round(rect.right - 14)}px`;
    button.style.top = `${Math.round((anchor && anchor.height > 0 ? anchor.top + anchor.height / 2 : rect.top + 36) - 17)}px`;
  };
  state.position();
  return true;
}
