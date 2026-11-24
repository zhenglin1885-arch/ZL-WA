import { app, BrowserWindow, ipcMain, clipboard } from 'electron';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { Probe } from './backend.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const data = process.env.ZL_PROBE_TEST_DATA || join(app.getPath('appData'), 'ZL-WA-Login-Probe');
app.setPath('userData', data);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, probe;
  app.whenReady().then(async () => {
  await mkdir(join(data, 'auth'), { recursive: true, mode: 0o700 });
  probe = new Probe({ makeSocket: makeWASocket, auth: () => useMultiFileAuthState(join(data, 'auth')),
    qrImage: token => QRCode.toDataURL(token, { width: 300, margin: 2 }),
    logger: pino({ level: 'silent' }),
    emit: state => { if (window && !window.isDestroyed()) window.webContents.send('probe-state', state); },
  });
  window = new BrowserWindow({ width: 880, height: 850, title: 'ZL-WA 独立登录验证',
    webPreferences: { preload: join(root, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('probe', async (event, action, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('FORBIDDEN');
    if (action === 'state') return probe.state;
    if (action === 'start') { await probe.start(); return true; }
    if (action === 'stop') { probe.stop(); await probe.saves; return true; }
    if (action === 'send') return probe.send(...args);
    if (action === 'diagnostics') { clipboard.writeText(JSON.stringify(probe.diagnostics(), null, 2)); return true; }
    throw Error('UNKNOWN_ACTION');
  });
  await window.loadFile(join(root, 'index.html'));
  // Offline smoke mode validates actual packaged IPC, auth persistence and dependency loading, without a phone.
  if (process.argv.includes('--smoke-test')) {
    try {
      const authCheck = await useMultiFileAuthState(join(data, 'auth'));
      await authCheck.saveCreds();
      const restored = await useMultiFileAuthState(join(data, 'auth'));
      if (!Buffer.from(authCheck.state.creds.noiseKey.public).equals(Buffer.from(restored.state.creds.noiseKey.public))) throw Error('AUTH_RESTORE_FAILED');
      const state = await window.webContents.executeJavaScript("window.probe.invoke('state')");
      if (state.status !== 'idle') throw Error('BAD_INITIAL_STATE');
      const ui = await window.webContents.executeJavaScript("({sendDisabled: document.getElementById('send').disabled, qrHidden: document.getElementById('qr').hidden, nodeHidden: typeof require === 'undefined'})");
      if (!ui.sendDisabled || !ui.qrHidden || !ui.nodeHidden) throw Error('BAD_RENDERER');
      const first = await readFile(join(data, 'smoke-session.json'), 'utf8').catch(() => null);
      const authHash = createHash('sha256').update(restored.state.creds.noiseKey.public).digest('hex');
      if (first && JSON.parse(first).authHash !== authHash) throw Error('AUTH_CHANGED_ON_RESTART');
      await writeFile(join(data, 'smoke-session.json'), JSON.stringify({ authHash }));
      await window.webContents.executeJavaScript("window.probe.invoke('diagnostics')");
      const diag = JSON.parse(clipboard.readText());
      if (diag.backend !== 'Baileys 7.0.0-rc14' || diag.state.qr !== undefined) throw Error('BAD_DIAGNOSTICS');
      await writeFile(join(data, first ? 'resume-pass.json' : 'startup-pass.json'), JSON.stringify({ passed: true, packaged: app.isPackaged, native: process.platform, realPhoneLoginVerified: false }));
      app.quit();
    } catch { app.exit(1); }
  }
  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; probe.stop();
    probe.saves.finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
  app.on('second-instance', () => { window.restore(); window.focus(); });
  }).catch(() => app.exit(1));
}
