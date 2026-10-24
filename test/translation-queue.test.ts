import TranslationQueue from '../src/features/accountTools/TranslationQueue';

describe('translation traffic queue', () => {
  it('limits total concurrency to three accounts and one request per account', async () => {
    const queue = new TranslationQueue();
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const run = (name: string) => () =>
      new Promise<void>(resolve => {
        started.push(name);
        releases.push(resolve);
      });
    const jobs = [
      queue.enqueue('a', false, run('a1')),
      queue.enqueue('a', false, run('a2')),
      queue.enqueue('b', false, run('b')),
      queue.enqueue('c', false, run('c')),
      queue.enqueue('d', false, run('d')),
    ];
    expect(started).toEqual(['a1', 'b', 'c']);
    releases[0]();
    await jobs[0];
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    expect(started).toEqual(['a1', 'b', 'c', 'a2']);
    releases[1]();
    releases[2]();
    releases[3]();
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    releases[4]();
    await Promise.all(jobs);
  });
  it('gives a send preview priority over queued incoming translations and recovers after errors', async () => {
    const queue = new TranslationQueue();
    const started: string[] = [];
    let release!: () => void;
    const first = queue.enqueue(
      'a',
      false,
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    const incoming = queue.enqueue('a', false, async () => {
      started.push('incoming');
      return 'in';
    });
    const outgoing = queue.enqueue('a', true, async () => {
      started.push('outgoing');
      throw new Error('synthetic');
    });
    const rejection = outgoing.catch(error => error.message);
    release();
    await first;
    expect(await rejection).toBe('synthetic');
    expect(await incoming).toBe('in');
    expect(started).toEqual(['outgoing', 'incoming']);
  });
});

describe('Google pacing and backoff', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it('paces Google across accounts and lets outgoing previews pass queued history', async () => {
    const queue = new TranslationQueue();
    const started: string[] = [];
    const run = (name: string) => async () => {
      started.push(name);
      return { text: name, error: false };
    };
    const first = queue.enqueue('a', false, run('first'), true);
    const history = queue.enqueue('b', false, run('history'), true);
    const outgoing = queue.enqueue('c', true, run('outgoing'), true);
    await first;
    await jest.advanceTimersByTimeAsync(999);
    expect(started).toEqual(['first']);
    await jest.advanceTimersByTimeAsync(1);
    await outgoing;
    expect(started).toEqual(['first', 'outgoing']);
    await jest.advanceTimersByTimeAsync(1000);
    await history;
    queue.dispose();
  });
  it('never overlaps Google requests even after the pacing interval has elapsed', async () => {
    const queue = new TranslationQueue();
    let release!: (value: any) => void;
    const first = queue.enqueue(
      'a',
      false,
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
      true,
    );
    const next = jest.fn(async () => ({ text: 'second', error: false }));
    const second = queue.enqueue('b', false, next, true);
    await jest.advanceTimersByTimeAsync(5000);
    expect(next).not.toHaveBeenCalled();
    release({ text: 'first', error: false });
    await first;
    await second;
    expect(next).toHaveBeenCalledTimes(1);
    queue.dispose();
  });
  it('backs off 5 then 10 seconds, bounds automatic retries and retains a shared cooldown', async () => {
    const queue = new TranslationQueue();
    const limited = jest.fn(async () => ({
      text: '',
      error: true,
      rateLimited: true,
      retryAfterMs: 0,
    }));
    const job = queue.enqueue('a', true, limited, true);
    await jest.advanceTimersByTimeAsync(4999);
    expect(limited).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(limited).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(9999);
    expect(limited).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(limited).toHaveBeenCalledTimes(3);
    expect(await job).toMatchObject({
      error: true,
      retryAfterMs: 20_000,
      message: expect.stringContaining('自动重试 2 次'),
    });
    const next = jest.fn(async () => ({ text: 'ok', error: false }));
    const other = queue.enqueue('different-account', false, next, true);
    await jest.advanceTimersByTimeAsync(19_999);
    expect(next).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(await other).toEqual({ text: 'ok', error: false });
    queue.dispose();
  });
  it('honors Retry-After, releases Google waiting slots for other providers and resets backoff after success', async () => {
    const queue = new TranslationQueue();
    const google = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        error: true,
        rateLimited: true,
        retryAfterMs: 12_000,
      })
      .mockResolvedValue({ text: 'translated', error: false });
    const pending = queue.enqueue('a', false, google, true);
    await jest.advanceTimersByTimeAsync(0);
    const other = queue.enqueue('a', true, async () => 'other-provider');
    expect(await other).toBe('other-provider');
    await jest.advanceTimersByTimeAsync(11_999);
    expect(google).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ text: 'translated', error: false });
    const afterRecovery = jest
      .fn()
      .mockResolvedValueOnce({ text: '', error: true, rateLimited: true })
      .mockResolvedValue({ text: 'recovered', error: false });
    const recovered = queue.enqueue('b', true, afterRecovery, true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(afterRecovery).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4999);
    expect(afterRecovery).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await recovered).toEqual({ text: 'recovered', error: false });
    queue.dispose();
  });
  it('stops queued retries when disposed', async () => {
    const queue = new TranslationQueue();
    const google = jest.fn(async () => ({
      text: '',
      error: true,
      rateLimited: true,
    }));
    const pending = queue.enqueue('a', false, google, true);
    const rejected = pending.catch(error => error.message);
    await jest.advanceTimersByTimeAsync(0);
    queue.dispose();
    expect(await rejected).toContain('已停止');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(google).toHaveBeenCalledTimes(1);
  });
});
