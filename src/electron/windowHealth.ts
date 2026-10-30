import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import type { BrowserWindow } from 'electron';

export interface WindowHealthEvent {
  event: string;
  reason?: string;
  exitCode?: number;
  processType?: string;
  frames?: string[];
}
export function readWindowHealth(path: string): unknown[] {
  try {
    if (statSync(path).size > 200_000) return [];
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(rows) ? rows.slice(-80) : [];
  } catch {
    return [];
  }
}
export function recordWindowHealth(path: string, details: WindowHealthEvent) {
  try {
    const rows = readWindowHealth(path);
    rows.push({ timestamp: new Date().toISOString(), ...details });
    writeFileSync(`${path}.tmp`, JSON.stringify(rows.slice(-80)), {
      mode: 0o600,
    });
    renameSync(`${path}.tmp`, path);
  } catch {
    /* Diagnostic storage must never prevent recovery or startup. */
  }
}
export function installWindowRecovery(
  window: BrowserWindow,
  hooks: {
    record: (event: WindowHealthEvent) => void;
    quitting: () => boolean;
  },
) {
  const contents = window.webContents;
  let lastRecovery: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () =>
    !window.isDestroyed() && !contents.isDestroyed() && !hooks.quitting();
  const gone = (
    _event: unknown,
    details: { reason: string; exitCode: number },
  ) => {
    hooks.record({
      event: 'renderer-gone',
      reason: details.reason,
      exitCode: details.exitCode,
    });
    if (!alive() || ['clean-exit', 'killed'].includes(details.reason)) return;
    if (lastRecovery !== undefined && Date.now() - lastRecovery < 120_000) {
      hooks.record({ event: 'recovery-suppressed' });
      return;
    }
    lastRecovery = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!alive()) return;
      hooks.record({ event: 'renderer-reload' });
      try {
        contents.reload();
      } catch {
        hooks.record({ event: 'recovery-failed' });
      }
    }, 1000);
  };
  const unresponsive = () => hooks.record({ event: 'renderer-unresponsive' });
  const responsive = () => hooks.record({ event: 'renderer-responsive' });
  const loaded = () => hooks.record({ event: 'renderer-loaded' });
  const dispose = () => {
    clearTimeout(timer);
    contents.removeListener('render-process-gone', gone);
    window.removeListener('unresponsive', unresponsive);
    window.removeListener('responsive', responsive);
    contents.removeListener('did-finish-load', loaded);
    window.removeListener('closed', dispose);
  };
  contents.on('render-process-gone', gone);
  window.on('unresponsive', unresponsive);
  window.on('responsive', responsive);
  contents.on('did-finish-load', loaded);
  window.once('closed', dispose);
  return dispose;
}
