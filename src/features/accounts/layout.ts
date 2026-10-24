// Keep list sizing local to this account's browser partition; never reload chats.
export function configureWhatsAppLayout(): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const side = document.querySelector<HTMLElement>('#side');
  const header = side?.querySelector<HTMLElement>('header');
  if (!side || !header) return false;
  const page = window as any;
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
      '[data-zl-chat-column]{box-sizing:border-box!important;width:var(--zl-chat-list-width)!important;min-width:var(--zl-chat-list-width)!important;max-width:var(--zl-chat-list-width)!important;flex:0 0 var(--zl-chat-list-width)!important}[data-zl-chat-inner]{box-sizing:border-box!important;width:auto!important;min-width:0!important;max-width:100%!important;flex:1 1 0%!important}[data-zl-chat-pane]{min-width:0!important;width:auto!important;max-width:none!important;flex:1 1 0%!important}[data-zl-chat-grid]{grid-template-columns:var(--zl-chat-grid-columns)!important}[data-zl-chat-header]{position:relative!important;padding-right:36px!important}[data-zl-chat-resize]{position:absolute!important;right:3px;top:50%;transform:translateY(-50%);z-index:20;pointer-events:auto;width:28px;height:34px;padding:3px;border:0;border-radius:5px;background:transparent;color:var(--primary,#8696a0);cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center}[data-zl-chat-resize]:hover,[data-zl-chat-resize]:focus-visible{background:rgba(128,128,128,.22);outline:2px solid currentColor;outline-offset:-2px}';
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
      if (persist) {
        try {
          localStorage.setItem('zl-chat-list-width', String(next));
        } catch {
          /* Sizing still works without persistence. */
        }
      }
    };
    const finishDrag = () => {
      if (!state.drag) return;
      if (state.drag.moved) state.apply(state.width, true);
      state.suppressClick = state.drag.moved;
      document.documentElement.style.cursor = state.drag.cursor;
      document.documentElement.style.userSelect = state.drag.selection;
      state.drag = undefined;
    };
    // Capture before React consumes the native header's pointer events. Keep
    // tracking at window level even if WhatsApp replaces the header mid-drag.
    window.addEventListener(
      'pointerdown',
      event => {
        const button = (event.target as Element)?.closest?.(
          '[data-zl-chat-resize]',
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
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      event => {
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
    window.addEventListener('blur', finishDrag);
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
    });
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
    state.column?.removeAttribute('data-zl-chat-column');
    state.column?.style.removeProperty('--zl-chat-list-width');
    for (const node of state.inner || []) delete node.dataset.zlChatInner;
    state.pane?.removeAttribute('data-zl-chat-pane');
    state.split?.removeAttribute('data-zl-chat-grid');
    state.split?.style.removeProperty('--zl-chat-grid-columns');
    state.column = column;
    state.split = split;
    state.pane = pane;
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
  if (state.width) state.apply(state.width);
  if (!header.querySelector('[data-zl-chat-resize]')) {
    header.dataset.zlChatHeader = 'true';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.zlChatResize = 'true';
    button.setAttribute('aria-label', '调整聊天列表宽度');
    button.title = '点击切换宽窄，或拖动调整聊天列表宽度';
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
    header.append(button);
  }
  return true;
}
