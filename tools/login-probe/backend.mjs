export class Probe {
  constructor({ makeSocket, auth, version, qrImage, emit, logger, now = Date.now, timer = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { makeSocket, auth, version, qrImage, emit, logger, now, timer, cancel });
    this.socket = null; this.generation = 0; this.retries = 0; this.events = []; this.running = false;
    this.state = { status: 'idle', qr: null, received: 0, sent: 0, syncEvents: 0, lastCode: null };
    this.saves = Promise.resolve();
  }
  publish(patch = {}) { Object.assign(this.state, patch); this.emit({ ...this.state }); }
  record(event, code = null) {
    this.events.push({ at: new Date(this.now()).toISOString(), event, code });
    this.events = this.events.slice(-80);
  }
  async start() {
    if (this.running) return;
    this.running = true; this.retries = 0;
    try { await this.connect(); } catch { this.running = false; this.record('start-failed'); this.publish({ status: 'error', qr: null }); }
  }
  async connect() {
    const generation = ++this.generation;
    this.publish({ status: 'connecting', qr: null });
    const { state, saveCreds } = await this.auth();
    if (!this.running || generation !== this.generation) return;
    const sock = this.makeSocket({ auth: state, ...(this.version ? { version: this.version } : {}), logger: this.logger,
      markOnlineOnConnect: false, syncFullHistory: false, connectTimeoutMs: 60000,
      generateHighQualityLinkPreview: false });
    this.socket = sock;
    const current = () => this.running && generation === this.generation;
    sock.ev.on('creds.update', () => {
      this.saves = this.saves.then(saveCreds).catch(() => {
        if (current()) { this.stop(); this.record('credential-save-failed'); this.publish({ status: 'storage-error', qr: null }); }
      });
    });
    sock.ev.on('connection.update', async update => {
      if (!current()) return;
      if (update.qr) {
        const token = update.qr; this.qrToken = token;
        try {
          const image = await this.qrImage(token);
          if (current() && this.qrToken === token && this.state.status !== 'connected') {
            this.record('qr'); this.publish({ status: 'qr', qr: image });
          }
        } catch { if (current()) this.publish({ status: 'error', qr: null }); }
      }
      if (update.connection === 'open') {
        this.qrToken = null; this.record('connected');
        this.publish({ status: 'connected', qr: null, lastCode: null });
      }
      if (update.connection === 'close') {
        this.qrToken = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const safeCode = Number.isInteger(code) ? code : null;
        this.record('disconnected', safeCode); this.socket = null;
        this.publish({ status: 'disconnected', qr: null, lastCode: safeCode });
        // 401 means logged out; 440 means another connection owns this session. Never loop these.
        if ([401, 440, 403, 411, 500].includes(code) || this.retries >= 3) {
          this.running = false; return;
        }
        const delay = code === 515 ? 1000 : 2000 * (1 + this.retries);
        this.retries++; this.publish({ status: 'reconnecting' });
        this.retry = this.timer(() => { this.saves.then(() => { if (current()) return this.connect(); }).catch(() => {
          if (current()) { this.running = false; this.publish({ status: 'error', qr: null }); }
        }); }, delay);
      }
    });
    sock.ev.on('messaging-history.set', data => {
      if (!current()) return;
      this.record('history-received');
      this.publish({ syncEvents: this.state.syncEvents + 1 });
    });
    sock.ev.on('messages.upsert', data => {
      if (!current() || data.type !== 'notify') return;
      for (const message of data.messages || []) {
        if (message.key?.fromMe || !message.message || !message.key?.remoteJid || message.key.remoteJid === 'status@broadcast') continue;
        const jid = message.key.remoteJid;
        const text = message.message.conversation || message.message.extendedTextMessage?.text || '[非文字消息]';
        this.publish({ received: this.state.received + 1 });
        this.emit({ message: { jid, text: String(text).slice(0, 3000) } });
      }
    });
  }
  async send(number, text) {
    if (this.state.status !== 'connected' || !this.socket) throw Error('NOT_CONNECTED');
    if (typeof number !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(number)) throw Error('INVALID_NUMBER');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw Error('INVALID_TEXT');
    const sock = this.socket;
    this.record('send-requested');
    try {
      const result = await sock.sendMessage(`${number.replace(/^\+/, '')}@s.whatsapp.net`, { text });
      if (!result?.key?.id) throw Error('UNCONFIRMED');
      this.record('send-returned-id'); this.publish({ sent: this.state.sent + 1 });
      return { accepted: true };
    } catch {
      // Never resend an uncertain send automatically.
      this.record('send-unconfirmed'); throw Error('SEND_UNCONFIRMED');
    }
  }
  stop() {
    this.running = false; this.generation++; this.qrToken = null;
    if (this.retry) this.cancel(this.retry);
    this.socket?.end(undefined); this.socket = null;
    this.record('stopped'); this.publish({ status: 'stopped', qr: null });
  }
  diagnostics() {
    const { qr, ...state } = this.state;
    return { format: 1, tool: 'ZL-WA Login Probe 0.1.0', backend: 'Baileys 7.0.0-rc14',
      realPhoneLoginVerifiedByDeveloper: false, protocolVersion: this.version || 'library-default', state, events: [...this.events] };
  }
}
