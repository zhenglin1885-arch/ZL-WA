import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { App, BrowserWindow } from 'electron';
import type { AccountToolsFileDiagnostic } from './AccountToolsFile';

// Inspect only the application shell, never embedded WhatsApp documents/text.
export function readWindowSurface() {
  const root = document.querySelector('#root');
  const bounds = root?.getBoundingClientRect();
  const style = root ? getComputedStyle(root) : null;
  let state:
    | `root-${'missing' | 'empty' | 'hidden' | 'present'}`
    | `startup-${'pending' | 'failed'}` = 'root-missing';
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
  if (state === 'root-present') {
    const startup = root
      ?.querySelector('[data-zl-startup]')
      ?.getAttribute('data-zl-startup');
    if (startup === 'pending' || startup === 'failed')
      state = `startup-${startup}`;
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
  configuration?: AccountToolsFileDiagnostic;
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
      'startup-pending',
      'startup-failed',
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
// Use the main-process reload path for both scheduled reloads and recovery.
export function reloadWindowShell(
  window: BrowserWindow,
  record: (event: WindowHealthEvent) => void,
  reason: string,
  loadShell?: () => void,
): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  if (window.webContents.isLoadingMainFrame()) {
    record({ event: 'renderer-reload-skipped', reason: 'already-loading' });
    return false;
  }
  record({ event: 'renderer-reload-requested', reason });
  try {
    if (loadShell) loadShell();
    else window.webContents.reload();
    return true;
  } catch {
    record({ event: 'recovery-failed', reason });
    return false;
  }
}

// Build the URL from a filesystem path: #, % and non-ASCII installation paths
// must not become URL fragments or escapes. Recovery always targets this shell,
// rather than reloading an error document or about:blank.
export async function loadWindowShell(
  window: BrowserWindow,
  file: string,
  record: (event: WindowHealthEvent) => void,
): Promise<boolean> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  try {
    await window.loadURL(pathToFileURL(file).href);
    return true;
  } catch (error) {
    const code = (error as { errno?: unknown })?.errno;
    record({
      event: 'renderer-shell-load-rejected',
      ...(typeof code === 'number' ? { exitCode: code } : {}),
    });
    return false;
  }
}

// A user-requested, single-launch graphics fallback. Keep profile/session paths
// and other launch arguments; do not change their saved acceleration preference.
export function restartWithoutGPU(
  app: Pick<App, 'relaunch' | 'quit'>,
  args: string[],
) {
  app.relaunch({
    args: [
      ...args.filter(
        argument =>
          !['--restart-without-gpu', '--reload-ui', '--disable-gpu'].includes(
            argument,
          ),
      ),
      '--disable-gpu',
    ],
  });
  app.quit();
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
const startupIncomplete = (surface: WindowSurface) =>
  'documentState' in surface &&
  surface.documentState === 'complete' &&
  [
    'root-missing',
    'root-empty',
    'root-hidden',
    'startup-pending',
    'startup-failed',
  ].includes(surface.state);

export function installWindowRecovery(
  window: BrowserWindow,
  hooks: {
    record: (event: WindowHealthEvent) => void;
    quitting: () => boolean;
    loadShell?: () => void;
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
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
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
  const confirmStartup = (generation: number) => {
    clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(async () => {
      confirmationTimer = undefined;
      if (
        !alive() ||
        generation !== inspectionGeneration ||
        !window.isVisible() ||
        window.isMinimized()
      )
        return;
      const surface = await inspectWindowSurface(window);
      if (!alive() || generation !== inspectionGeneration) return;
      hooks.record({ event: 'renderer-surface-confirmed', surface });
      if (
        !startupIncomplete(surface) ||
        !window.isVisible() ||
        window.isMinimized()
      )
        return;
      if (lastRecovery !== undefined && Date.now() - lastRecovery < 120_000) {
        hooks.record({
          event: 'recovery-suppressed',
          reason: 'startup-incomplete',
        });
        return;
      }
      if (contents.isLoadingMainFrame()) return;
      lastRecovery = Date.now();
      hooks.record({ event: 'renderer-reload', reason: 'startup-incomplete' });
      reloadWindowShell(
        window,
        hooks.record,
        'startup-incomplete',
        hooks.loadShell,
      );
    }, 6000);
  };
  const inspect = () => {
    inspectionGeneration += 1;
    const generation = inspectionGeneration;
    clearTimeout(surfaceTimer);
    clearTimeout(confirmationTimer);
    surfaceTimer = setTimeout(() => {
      surfaceTimer = undefined;
      if (!alive()) return;
      inspectWindowSurface(window).then(surface => {
        if (alive() && generation === inspectionGeneration) {
          hooks.record({ event: 'renderer-surface', surface });
          if (startupIncomplete(surface)) confirmStartup(generation);
        }
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
    clearTimeout(confirmationTimer);
    resumedAt = 0;
  };
  const shown = () => {
    if (resumedAt && Date.now() - resumedAt < 60_000) repaint();
    inspect();
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
  const loading = () => {
    inspectionGeneration += 1;
    clearTimeout(surfaceTimer);
    clearTimeout(confirmationTimer);
  };
  const unresponsive = () => hooks.record({ event: 'renderer-unresponsive' });
  const responsive = () => hooks.record({ event: 'renderer-responsive' });
  const loaded = () => {
    hooks.record({ event: 'renderer-loaded' });
    shown();
  };
  const failed = (
    _event: unknown,
    code: number,
    _description: string,
    _url: string,
    isMainFrame: boolean,
  ) => {
    // ERR_ABORTED is expected when the user reloads or replaces a navigation.
    if (!isMainFrame || code === -3) return;
    hooks.record({ event: 'renderer-load-failed', exitCode: code });
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
    contents.removeListener('did-fail-load', failed);
    contents.removeListener('did-start-loading', loading);
    window.removeListener('closed', dispose);
    window.removeListener('show', shown);
    window.removeListener('restore', shown);
  };
  contents.on('render-process-gone', gone);
  window.on('unresponsive', unresponsive);
  window.on('responsive', responsive);
  contents.on('did-finish-load', loaded);
  contents.on('did-fail-load', failed);
  contents.on('did-start-loading', loading);
  hooks.resumeEvents?.on('resume', resume);
  hooks.resumeEvents?.on('suspend', suspend);
  window.on('show', shown);
  window.on('restore', shown);
  window.once('closed', dispose);
  return dispose;
}
