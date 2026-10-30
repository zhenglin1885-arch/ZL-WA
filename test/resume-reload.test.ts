import ResumeReload from '../src/helpers/ResumeReload';

let recovery: ResumeReload;
let enabled: boolean;
let online: boolean;
let reload: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  enabled = true;
  online = true;
  reload = jest.fn();
  recovery = new ResumeReload({
    enabled: () => enabled,
    thresholdMinutes: () => 10,
    online: () => online,
    reload,
  });
});
afterEach(() => {
  recovery.dispose();
  jest.useRealTimers();
});
function sleep(minutes = 15) {
  recovery.suspend();
  jest.setSystemTime(Date.now() + minutes * 60_000);
  recovery.resume();
}
it('reloads exactly once after overnight suspend, including duplicate resume events', () => {
  sleep(480);
  recovery.resume();
  recovery.resume();
  jest.advanceTimersByTime(30_000);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('ignores short suspends and resume events without a matching suspend', () => {
  recovery.resume();
  sleep(3);
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
});
it('waits for online without polling and reloads once when the network returns', () => {
  online = false;
  sleep();
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
  online = true;
  recovery.online();
  recovery.online();
  jest.advanceTimersByTime(30_000);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('cancels a stale recovery when another suspend starts', () => {
  sleep();
  recovery.suspend();
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
  jest.setSystemTime(Date.now() + 12 * 60_000);
  recovery.resume();
  jest.advanceTimersByTime(2000);
  expect(reload).toHaveBeenCalledTimes(1);
});
it('honors the existing preference before scheduling and just before reload', () => {
  enabled = false;
  sleep();
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
  enabled = true;
  sleep();
  enabled = false;
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
});
it('disposes pending recovery and remains stopped across later events', () => {
  sleep();
  recovery.dispose();
  recovery.resume();
  recovery.online();
  jest.advanceTimersByTime(30_000);
  expect(reload).not.toHaveBeenCalled();
});
