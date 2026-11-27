// Serialized into each supported chat page. Keep helpers inside this function.
export function configureMessageSendMode(mode: string): boolean {
  const host = globalThis.location.hostname;
  if (host !== 'web.whatsapp.com' && host !== 'business.facebook.com')
    return false;
  const page = window as any;
  if (page.__zlSendMode) {
    page.__zlSendMode.mode = mode === 'shift-enter' ? mode : 'enter';
    return true;
  }
  const state = { mode: mode === 'shift-enter' ? mode : 'enter' };
  page.__zlSendMode = state;
  const sendSelector =
    '[data-icon="send"], [data-icon="wds-ic-send"], [data-icon^="wds-ic-send-"], [data-testid="compose-btn-send"], [data-testid="media-send"], [data-testid="media-editor-send"], [aria-label="Send"], [aria-label="Send message"], [aria-label="发送"], [aria-label="发送消息"], [aria-label="Enviar"], [aria-label="Enviar mensagem"], [aria-label="Send edited message"], [data-testid="edit-message-send"], [data-testid="edit-message-submit"], [data-testid="edit-message-confirm"], [data-icon="checkmark"], [data-icon="wds-ic-checkmark"]';
  const intercept = (event: KeyboardEvent) => {
    if (
      state.mode !== 'shift-enter' ||
      event.key !== 'Enter' ||
      event.isComposing ||
      // eslint-disable-next-line sonar/deprecation -- Preserve keyCode 229 for IME composition compatibility.
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    const { target } = event;
    if (!(target instanceof HTMLElement)) return;
    const input = target.closest<HTMLElement>(
      '[contenteditable="true"], [contenteditable="plaintext-only"], textarea',
    );
    if (
      !input ||
      input.closest('[data-zl-translation], [data-zl-audio-upload]') ||
      (input as HTMLTextAreaElement).disabled ||
      (input as HTMLTextAreaElement).readOnly ||
      input.getAttribute('aria-readonly') === 'true'
    )
      return;
    const root =
      host === 'web.whatsapp.com'
        ? input.closest(
            'footer, [data-testid="media-editor"], [data-testid="edit-message-dialog"], [data-testid="edit-message-modal"], [role="dialog"], [data-animate-modal-popup="true"]',
          )
        : input.closest('[role="dialog"], form, [data-pagelet], [role="main"]');
    if (!root) return;
    const candidates = [...root.querySelectorAll<HTMLElement>(sendSelector)];
    const buttons = [
      ...new Set(
        candidates.map(
          node => node.closest<HTMLElement>('button, [role="button"]') || node,
        ),
      ),
    ].filter(
      node =>
        node.getClientRects().length > 0 &&
        !node.closest('[aria-hidden="true"]') &&
        getComputedStyle(node).visibility !== 'hidden',
    );
    // Search/settings/note inputs must keep their native keyboard behavior.
    // An ambiguous composer is never dispatched to an arbitrary send button.
    if (host !== 'web.whatsapp.com' && buttons.length !== 1) return;
    event.stopImmediatePropagation();
    if (!event.shiftKey) return; // Preserve Chromium's native newline and undo/input events.
    event.preventDefault();
    if (event.type !== 'keydown' || event.repeat || buttons.length !== 1)
      return;
    const button = buttons[0];
    if (
      (button as HTMLButtonElement).disabled ||
      button.getAttribute('aria-disabled') === 'true'
    )
      return;
    // Use the existing click path, including translation preview/confirmation.
    button.click();
  };
  for (const type of ['keydown', 'keypress', 'keyup'])
    window.addEventListener(type, intercept as EventListener, true);
  return true;
}
