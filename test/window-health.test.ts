/* eslint-disable unicorn/prefer-event-target -- Mock native Electron EventEmitter lifecycle. */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installWindowRecovery,
  recordWindowHealth,
  readWindowHealth,
  inspectWindowSurface,
} from '../src/electron/windowHealth';

function fixture() {
  const contents: any = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.reload = jest.fn();
  contents.invalidate = jest.fn();
  contents.executeJavaScript = jest.fn(async () => ({
    state: 'root-present',
    documentState: 'complete',
  }));
  const window: any = new EventEmitter();
  window.webContents = contents;
  window.isDestroyed = () => false;
  window.isVisible = jest.fn(() => true);
  window.isMinimized = () => false;
  const resumeEvents = new EventEmitter();
  const hooks = { record: jest.fn(), quitting: () => false, resumeEvents };
  const dispose = installWindowRecovery(window, hooks);
  return { window, contents, hooks, dispose };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it.each(['crashed', 'oom', 'abnormal-exit'])(
  'recovers a confirmed %s renderer without touching sessions or retrying sends',
  reason => {
    const { contents, hooks, dispose } = fixture();
    contents.emit('render-process-gone', {}, { reason, exitCode: 5 });
    jest.advanceTimersByTime(1000);
    expect(contents.reload).toHaveBeenCalledTimes(1);
    expect(hooks.record).toHaveBeenCalledWith({
      event: 'renderer-gone',
      reason,
      exitCode: 5,
    });
    dispose();
  },
);
it('suppresses repeated crash/reload cycles until a stable period has elapsed', () => {
  const { contents, hooks, dispose } = fixture();
  const crash = () =>
    contents.emit(
      'render-process-gone',
      {},
      { reason: 'crashed', exitCode: 5 },
    );
  crash();
  jest.advanceTimersByTime(1000);
  crash();
  jest.advanceTimersByTime(10_000);
  expect(contents.reload).toHaveBeenCalledTimes(1);
  expect(hooks.record).toHaveBeenCalledWith({ event: 'recovery-suppressed' });
  jest.advanceTimersByTime(120_000);
  crash();
  jest.advanceTimersByTime(1000);
  expect(contents.reload).toHaveBeenCalledTimes(2);
  dispose();
});
it('requests a repaint after resume without reloading or retrying account work, then records shell state', async () => {
  const { contents, hooks, dispose } = fixture();
  hooks.resumeEvents.emit('resume');
  await jest.advanceTimersByTimeAsync(4000);
  expect(contents.invalidate).toHaveBeenCalledTimes(1);
  expect(contents.reload).not.toHaveBeenCalled();
  expect(hooks.record).toHaveBeenCalledWith({
    event: 'renderer-surface',
    surface: { state: 'root-present', documentState: 'complete' },
  });
  dispose();
  expect(hooks.resumeEvents.listenerCount('resume')).toBe(0);
});
it('defers repainting a hidden window until shown and cancels pending work on suspend/close', async () => {
  const { contents, window, hooks, dispose } = fixture();
  window.isVisible.mockReturnValue(false);
  hooks.resumeEvents.emit('resume');
  await jest.advanceTimersByTimeAsync(1000);
  expect(contents.invalidate).not.toHaveBeenCalled();
  window.isVisible.mockReturnValue(true);
  window.emit('show');
  expect(contents.invalidate).toHaveBeenCalledTimes(1);
  hooks.resumeEvents.emit('suspend');
  await jest.advanceTimersByTimeAsync(4000);
  expect(contents.executeJavaScript).not.toHaveBeenCalled();
  hooks.resumeEvents.emit('resume');
  dispose();
  await jest.advanceTimersByTimeAsync(4000);
  expect(contents.invalidate).toHaveBeenCalledTimes(1);
});
it('exports only fixed shell state even if a renderer returns extra private fields', async () => {
  const { contents, window, dispose } = fixture();
  contents.executeJavaScript.mockResolvedValue({
    state: 'root-empty',
    documentState: 'complete',
    text: 'private customer',
    url: 'private URL',
  });
  expect(await inspectWindowSurface(window)).toEqual({
    state: 'root-empty',
    documentState: 'complete',
  });
  contents.executeJavaScript.mockResolvedValue({
    state: 'private message',
    documentState: 'complete',
  });
  expect(await inspectWindowSurface(window)).toEqual({ state: 'unavailable' });
  dispose();
});
it('bounds a hung shell probe and removes timers/listeners', async () => {
  const { contents, window, dispose } = fixture();
  contents.executeJavaScript.mockImplementation(() => new Promise(() => {}));
  const pending = inspectWindowSurface(window);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await pending).toEqual({ state: 'timed-out' });
  expect(contents.listenerCount('did-start-loading')).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  dispose();
});
it('does not attribute a shell probe from before a reload to the current document', async () => {
  const { contents, window, dispose } = fixture();
  const pending = inspectWindowSurface(window);
  contents.emit('did-start-loading');
  expect(await pending).toEqual({ state: 'page-changed' });
  dispose();
});
it('does not reload a healthy, temporarily unresponsive, intentionally killed or exiting renderer', () => {
  const { contents, window, dispose } = fixture();
  window.emit('unresponsive');
  window.emit('responsive');
  for (const reason of ['clean-exit', 'killed'])
    contents.emit('render-process-gone', {}, { reason, exitCode: 0 });
  jest.advanceTimersByTime(30_000);
  expect(contents.reload).not.toHaveBeenCalled();
  dispose();
});
it('cancels recovery during close or app shutdown', () => {
  const { contents, window, dispose } = fixture();
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 5 });
  window.emit('closed');
  jest.advanceTimersByTime(1000);
  expect(contents.reload).not.toHaveBeenCalled();
  expect(contents.listenerCount('render-process-gone')).toBe(0);
  dispose();
  const other = fixture();
  other.hooks.quitting = () => true;
  other.contents.emit(
    'render-process-gone',
    {},
    { reason: 'crashed', exitCode: 5 },
  );
  jest.advanceTimersByTime(1000);
  expect(other.contents.reload).not.toHaveBeenCalled();
  other.dispose();
});
it('keeps bounded diagnostics across restart and tolerates missing/corrupt storage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zl-health-'));
  const path = join(directory, 'health.json');
  try {
    expect(readWindowHealth(path)).toEqual([]);
    writeFileSync(path, 'invalid json');
    recordWindowHealth(path, { event: 'renderer-gone', reason: 'oom' });
    expect(readWindowHealth(path)).toHaveLength(1);
    for (let i = 0; i < 90; i += 1)
      recordWindowHealth(path, { event: 'renderer-loaded', exitCode: i });
    const rows: any[] = readWindowHealth(path);
    expect(rows).toHaveLength(80);
    expect(rows.at(-1).exitCode).toBe(89);
    expect(() =>
      recordWindowHealth(join(directory, 'missing/health.json'), {
        event: 'renderer-loaded',
      }),
    ).not.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
