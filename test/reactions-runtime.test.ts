import { defaultReactionPreferences } from '../src/features/reactions/types';

jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(async () => {}),
}));

const { ReactionRuntime } = require('../src/features/reactions/runtime');
const {
  ensureBulkLibrary,
} = require('../src/features/accountTools/bulkRuntime');

const ownerId = '8613800000001@c.us';
const target = {
  accountId: 'account-a',
  ownerId,
  accountName: 'A',
  target: '10001@g.us',
  name: 'G',
};
const task = {
  ...target,
  id: 'task',
  text: '你好',
  messageId: 'false_10001@g.us_A',
  emoji: '👍',
  plannedAt: 1,
  status: 'queued',
  result: '',
};
const setup = () => {
  const service = {
    id: 'account-a',
    recipe: { id: 'whatsapp' },
    isEnabled: true,
    isHibernating: false,
    accountSnapshot: { status: 'online', ownerId },
    webview: {
      executeJavaScript: jest.fn(async () => ({
        status: 'success',
        message: 'OK',
      })),
    },
  };
  const runtime = new ReactionRuntime({ services: { all: [service] } } as any);
  return {
    service,
    runtime,
    execute: () => (runtime as any).execute(task, defaultReactionPreferences()),
  };
};
describe('reaction runtime dispatch isolation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(ensureBulkLibrary).mockImplementation(async () => {});
  });
  afterEach(() => jest.useRealTimers());
  it('reports an offline or replaced identity without issuing a guest request', async () => {
    const h = setup();
    h.service.accountSnapshot.ownerId = '8613900000000@c.us';
    expect(await h.execute()).toMatchObject({ status: 'failed' });
    expect(h.service.webview.executeJavaScript).not.toHaveBeenCalled();
  });
  it('does not send after a library preparation timeout resolves late', async () => {
    let resolve!: () => void;
    jest.mocked(ensureBulkLibrary).mockReturnValueOnce(
      new Promise<void>(r => {
        resolve = r;
      }),
    );
    const h = setup();
    const pending = h.execute();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('未发送'),
    });
    resolve();
    await Promise.resolve();
    expect(h.service.webview.executeJavaScript).not.toHaveBeenCalled();
  });
  it('blocks further dispatch while a timed-out native mutation remains in flight', async () => {
    const h = setup();
    let resolve!: (value: any) => void;
    h.service.webview.executeJavaScript.mockReturnValueOnce(
      new Promise(r => {
        resolve = r;
      }),
    );
    const pending = h.execute();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({
      status: 'uncertain',
      inFlight: true,
    });
    expect(await h.execute()).toMatchObject({ inFlight: true });
    expect(h.service.webview.executeJavaScript).toHaveBeenCalledTimes(1);
    resolve({ status: 'success', message: 'OK' });
    await Promise.resolve();
    expect(await h.execute()).toMatchObject({ status: 'success' });
    expect(h.service.webview.executeJavaScript).toHaveBeenCalledTimes(2);
  });
  it('keeps guest transport rejection uncertain instead of falsely reporting failure', async () => {
    const h = setup();
    h.service.webview.executeJavaScript.mockRejectedValue(
      new Error('guest destroyed'),
    );
    expect(await h.execute()).toMatchObject({ status: 'uncertain' });
  });
});
