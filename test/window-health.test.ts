/* eslint-disable unicorn/prefer-event-target -- Mock native Electron EventEmitter lifecycle. */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installWindowRecovery,
  recordWindowHealth,
  readWindowHealth,
} from '../src/electron/windowHealth';

function fixture() {
  const contents: any = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.reload = jest.fn();
  const window: any = new EventEmitter();
  window.webContents = contents;
  window.isDestroyed = () => false;
  const hooks = { record: jest.fn(), quitting: () => false };
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
