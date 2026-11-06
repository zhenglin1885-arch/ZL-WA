import { ipcRenderer } from 'electron';

// Keep startup reporting independent of stores, router and React initialization.
export function reportRendererException(error: unknown) {
  let reason = 'Error';
  let frames: string[] = [];
  try {
    const value = error as { name?: unknown; stack?: unknown } | null;
    if (
      typeof value?.name === 'string' &&
      [
        'Error',
        'TypeError',
        'ReferenceError',
        'RangeError',
        'SyntaxError',
      ].includes(value.name)
    )
      reason = value.name;
    if (typeof value?.stack === 'string')
      frames = value.stack
        .split('\n')
        .slice(1)
        .flatMap(line => line.match(/[\w.-]+\.(?:js|tsx?):\d+:\d+/g) || [])
        .slice(0, 8);
  } catch {
    // Exception inspection itself must not prevent the recovery screen.
  }
  try {
    ipcRenderer.send('zl-window-renderer-error', { reason, frames });
  } catch {
    // The recovery button remains usable when IPC is unavailable.
  }
}

export function showRendererStartupFailure(error: unknown) {
  reportRendererException(error);
  const show = () => {
    const root = document.querySelector('#root');
    if (
      !root ||
      (root.childElementCount && !root.querySelector('[data-zl-startup]'))
    )
      return;
    const panel = document.createElement('section');
    panel.dataset.zlStartup = 'failed';
    panel.setAttribute('role', 'alert');
    panel.style.cssText =
      'padding:48px;min-height:100vh;box-sizing:border-box;color-scheme:light dark;background:Canvas;color:CanvasText;font:16px/1.7 system-ui,sans-serif';
    const title = document.createElement('h1');
    title.textContent = '界面未能启动';
    const detail = document.createElement('p');
    detail.textContent =
      '请重新载入界面，恢复后先核查进行中任务的执行结果。若仍无法恢复，可从托盘导出窗口诊断。';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = '重新载入界面';
    reload.style.cssText = 'padding:10px 20px;cursor:pointer';
    reload.addEventListener('click', () => window.location.reload());
    panel.append(title, detail, reload);
    root.replaceChildren(panel);
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
}

export function installRendererStartupGuard() {
  window.addEventListener('error', event => {
    if (event.error !== undefined && event.error !== null)
      reportRendererException(event.error);
  });
  window.addEventListener('unhandledrejection', event => {
    reportRendererException(event.reason);
  });
}

export function startRendererWhenReady(initialize: () => void) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    try {
      initialize();
    } catch (error) {
      showRendererStartupFailure(error);
    }
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
