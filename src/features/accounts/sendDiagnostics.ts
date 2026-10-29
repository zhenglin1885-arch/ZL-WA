/* eslint-disable unicorn/consistent-function-scoping, no-continue -- Serialized read-only guest helper with bounded filtering. */
export function readSendDiagnostics() {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const page = window as any;
  const read = (fn: () => any): any => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const token = (value: any): string | null =>
    typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value) ? value : null;
  const bool = (value: any): boolean | null =>
    typeof value === 'boolean' ? value : null;
  const version = (value: any): string | null =>
    typeof value === 'string' && /^\d+(?:\.\d+){1,5}$/.test(value)
      ? value
      : null;
  const wpp = page.WPP;
  const stream = read(() => wpp.conn.getStreamData());
  const socket = read(() => page.require('WAWebSocketModel').Socket.state);
  const nativeStore = read(() => page.require('WAWebCollections').Msg);
  const store = nativeStore || read(() => wpp.whatsapp.MsgStore);
  const models = read(() => store.getModelsArray());
  const outgoing = {
    inspected: 0,
    pending: 0,
    pendingOverTwoMinutes: 0,
    accepted: 0,
    failed: 0,
    ackCodes: {} as Record<string, number>,
  };
  if (Array.isArray(models)) {
    for (const message of models.slice(-200)) {
      const key = read(() => message.id);
      const own = read(
        () =>
          key?.fromMe === true ||
          message.isSentByMe === true ||
          (typeof key === 'string' && key.startsWith('true_')) ||
          (typeof key?._serialized === 'string' &&
            key._serialized.startsWith('true_')),
      );
      if (!own) continue;
      outgoing.inspected += 1;
      const ack = Number(read(() => message.ack ?? message.attributes?.ack));
      if (!Number.isInteger(ack) || ack < -7 || ack > 8) continue;
      outgoing.ackCodes[String(ack)] =
        (outgoing.ackCodes[String(ack)] || 0) + 1;
      if (ack < 0) outgoing.failed += 1;
      else if (ack >= 1) outgoing.accepted += 1;
      else {
        outgoing.pending += 1;
        const timestamp = Number(read(() => message.t));
        const milliseconds = timestamp > 1e12 ? timestamp : timestamp * 1000;
        if (timestamp > 0 && Date.now() - milliseconds > 120_000)
          outgoing.pendingOverTwoMinutes += 1;
      }
    }
  }
  // Only booleans/counts leave the page. Native IDs and customer text stay
  // local, including when a virtual row cannot be matched to a chat model.
  const customer = page.__zlCustomers;
  const adapter = page.__zlCustomerAdapter;
  const customerModels = read(() => adapter.models());
  const active = read(() => customer.activeChatId) || '';
  const canonical = (id: string) => customer?.data?.aliases?.[id] || id;
  const rows: HTMLElement[] =
    read(() =>
      [
        ...new Set(
          [
            ...document.querySelectorAll<HTMLElement>(
              '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
            ),
          ].map(row => row.closest<HTMLElement>('[role="row"]') || row),
        ),
      ].slice(0, 100),
    ) || [];
  const resolved = rows.map(row => read(() => customer.resolveRow(row)) || '');
  const activeRow =
    rows.find(
      (_row, i) =>
        active && resolved[i] && canonical(resolved[i]) === canonical(active),
    ) ||
    rows.find(
      row =>
        row.getAttribute('aria-selected') === 'true' ||
        row.querySelector('[aria-selected="true"]'),
    );
  const customers = {
    installed: Boolean(customer?.data),
    ownerMatches:
      read(() => adapter.owners().includes(customer.data.owner)) === true,
    models: Array.isArray(customerModels) ? customerModels.length : null,
    loadedRows: rows.length,
    resolvedRows: resolved.filter(Boolean).length,
    rowsWithNotes: rows.filter(row => row.querySelector('.zl-chat-note'))
      .length,
    activeChatKnown: Boolean(active),
    activeModelPresent: Boolean(
      active &&
        Array.isArray(customerModels) &&
        customerModels.some(
          model => canonical(adapter.wid(model.id)) === canonical(active),
        ),
    ),
    activeSummaryPresent: Boolean(
      active && customer?.data?.summaries?.[canonical(active)],
    ),
    activeRowLocated: Boolean(activeRow),
    activeTitleContainer: Boolean(
      activeRow?.querySelector('[data-testid="cell-frame-title"]'),
    ),
    activeNotePresent: Boolean(activeRow?.querySelector('.zl-chat-note')),
    activeFlagCount:
      activeRow?.querySelectorAll('.zl-customer-flag').length ?? null,
  };
  return {
    format: 1,
    browserOnline: bool(read(() => navigator.onLine)),
    socket: token(socket),
    sdkReady: bool(read(() => wpp.isReady)),
    sdkVersion: version(read(() => wpp.version)),
    whatsappVersion: version(read(() => page.Debug.VERSION)),
    stream: { mode: token(stream?.mode), info: token(stream?.info) },
    authenticated: bool(read(() => wpp.conn.isAuthenticated())),
    registered: bool(read(() => wpp.conn.isRegistered())),
    mainReady: bool(read(() => wpp.conn.isMainReady())),
    mainLoaded: bool(read(() => wpp.conn.isMainLoaded())),
    messageStoreReadable: Array.isArray(models),
    outgoing,
    customers,
  };
}
