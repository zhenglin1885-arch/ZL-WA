import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import type { BrowserWindow } from 'electron';

// Inspect only the application shell, never embedded WhatsApp documents/text.
export function readWindowSurface() {
  const root = document.querySelector('#root');
  const bounds = root?.getBoundingClientRect();
  const style = root ? getComputedStyle(root) : null;
  let state: 'root-missing' | 'root-empty' | 'root-hidden' | 'root-present' =
    'root-missing';
  if (root) {
    state =
      root.childElementCount === 0
        ? 'root-empty'
        : !bounds?.width ||
            !bounds.height ||
            style?.display === 'none' ||
            style?.visibility === 'hidden' ||
            style?.opacity === '0'
          ? 'root-hidden'
          : 'root-present';
  }
  return { state, documentState: document.readyState };
}
type WindowSurface =
  | ReturnType<typeof readWindowSurface>
  | {
      state: 'unavailable' | 'timed-out' | 'page-changed';
    };

export interface WindowHealthEvent {
  event: string;
  reason?: string;
  exitCode?: number;
  processType?: string;
  frames?: string[];
  surface?: WindowSurface;
}

export async function inspectWindowSurface(
  window: BrowserWindow,
): Promise<WindowSurface> {
  const contents = window.webContents;
  if (window.isDestroyed() || contents.isDestroyed())
    return { state: 'unavailable' };
  let changed = false;
  const navigating = () => {
    changed = true;
  };
  contents.on('did-start-loading', navigating);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      contents.executeJavaScript(`(${readWindowSurface.toString()})()`),
      new Promise<WindowSurface>(resolve => {
        timer = setTimeout(() => resolve({ state: 'timed-out' }), 3000);
      }),
    ]);
    if (changed || window.isDestroyed() || contents.isDestroyed())
      return { state: 'page-changed' };
    const states = [
      'root-missing',
      'root-empty',
      'root-hidden',
      'root-present',
    ];
    if (
      states.includes(result?.state) &&
      ['loading', 'interactive', 'complete'].includes(result?.documentState)
    )
      return { state: result.state, documentState: result.documentState };
    return {
      state: result?.state === 'timed-out' ? 'timed-out' : 'unavailable',
    };
  } catch {
    return { state: 'unavailable' };
  } finally {
    clearTimeout(timer);
    contents.removeListener('did-start-loading', navigating);
  }
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
    resumeEvents?: {
      on(event: 'resume', listener: () => void): unknown;
      // Electron PowerMonitor exposes literal overloads; a union parameter is incompatible.
      // eslint-disable-next-line @typescript-eslint/unified-signatures
      on(event: 'suspend', listener: () => void): unknown;
      removeListener(event: 'resume', listener: () => void): unknown;
      // eslint-disable-next-line @typescript-eslint/unified-signatures -- Match Electron's overloads.
      removeListener(event: 'suspend', listener: () => void): unknown;
    };
  },
) {
  const contents = window.webContents;
  let lastRecovery: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let surfaceTimer: ReturnType<typeof setTimeout> | undefined;
  let repaintTimer: ReturnType<typeof setTimeout> | undefined;
  let resumedAt = 0;
  let disposed = false;
  let inspectionGeneration = 0;
  const alive = () =>
    !disposed &&
    !window.isDestroyed() &&
    !contents.isDestroyed() &&
    !hooks.quitting();
  const repaint = () => {
    if (!alive() || !window.isVisible() || window.isMinimized()) return;
    try {
      contents.invalidate();
      hooks.record({ event: 'renderer-repaint-requested' });
    } catch {
      hooks.record({ event: 'renderer-repaint-failed' });
    }
  };
  const inspect = () => {
    inspectionGeneration += 1;
    const generation = inspectionGeneration;
    clearTimeout(surfaceTimer);
    surfaceTimer = setTimeout(() => {
      surfaceTimer = undefined;
      if (!alive()) return;
      inspectWindowSurface(window).then(surface => {
        if (alive() && generation === inspectionGeneration)
          hooks.record({ event: 'renderer-surface', surface });
      });
    }, 2000);
  };
  const resume = () => {
    resumedAt = Date.now();
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(repaint, 1000);
    inspect();
  };
  const suspend = () => {
    inspectionGeneration += 1;
    clearTimeout(repaintTimer);
    clearTimeout(surfaceTimer);
    resumedAt = 0;
  };
  const shown = () => {
    if (resumedAt && Date.now() - resumedAt < 60_000) repaint();
  };
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
  const loaded = () => {
    hooks.record({ event: 'renderer-loaded' });
    shown();
    inspect();
  };
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    suspend();
    hooks.resumeEvents?.removeListener('resume', resume);
    hooks.resumeEvents?.removeListener('suspend', suspend);
    contents.removeListener('render-process-gone', gone);
    window.removeListener('unresponsive', unresponsive);
    window.removeListener('responsive', responsive);
    contents.removeListener('did-finish-load', loaded);
    window.removeListener('closed', dispose);
    window.removeListener('show', shown);
    window.removeListener('restore', shown);
  };
  contents.on('render-process-gone', gone);
  window.on('unresponsive', unresponsive);
  window.on('responsive', responsive);
  contents.on('did-finish-load', loaded);
  hooks.resumeEvents?.on('resume', resume);
  hooks.resumeEvents?.on('suspend', suspend);
  window.on('show', shown);
  window.on('restore', shown);
  window.once('closed', dispose);
  return dispose;
}
