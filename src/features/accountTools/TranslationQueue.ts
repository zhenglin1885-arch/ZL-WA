interface ProviderResult {
  text?: string;
  error?: boolean;
  rateLimited?: boolean;
  unavailable?: boolean;
  fromCache?: boolean;
  retryAfterMs?: number;
  message?: string;
}
interface Job {
  accountId: string;
  outgoing: boolean;
  google: boolean;
  attempts: number;
  run: (signal: AbortSignal) => Promise<unknown>;
  fallback?: (signal: AbortSignal) => Promise<unknown>;
  manual: boolean;
  controller: AbortController;
  deadlineAt: number;
  promise?: Promise<unknown>;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
}
// Bound traffic across accounts. Google shares one paced lane because several
// accounts may use the same public IP; changing accounts must not defeat 429.
export default class TranslationQueue {
  private jobs = new Set<Job>();

  private active = new Set<string>();

  private waiting: Job[] = [];

  private googleActive = false;

  private googleNext = 0;

  private googleFailures = 0;

  private googleCooldown = 0;

  private timer?: ReturnType<typeof setTimeout>;

  private disposed = false;

  enqueue<T, F = T>(
    accountId: string,
    outgoing: boolean,
    run: (signal: AbortSignal) => Promise<T>,
    google = false,
    fallback?: (signal: AbortSignal) => Promise<F>,
    manual = false,
  ): Promise<T | F> {
    if (this.disposed) return Promise.reject(new Error('翻译队列已停止'));
    if (this.waiting.length >= 240)
      return Promise.reject(new Error('翻译队列繁忙，请稍后重试'));
    let queued: Job | undefined;
    const request = new Promise<T | F>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let job: Job;
      const finish = () => {
        settled = true;
        clearTimeout(deadline);
        this.jobs.delete(job);
      };
      job = {
        accountId,
        outgoing,
        run,
        google,
        fallback,
        manual,
        controller,
        deadlineAt: Date.now() + 120_000,
        attempts: 0,
        resolve: value => {
          if (!settled) {
            finish();
            resolve(value);
          }
        },
        reject: error => {
          if (!settled) {
            finish();
            reject(error);
          }
        },
      };
      // Includes queue waiting, proxy preparation, provider calls and fallback.
      deadline = setTimeout(() => {
        controller.abort();
        this.waiting = this.waiting.filter(item => item !== job);
        job.reject(new Error('翻译等待超时，请稍后重试或切换翻译通道'));
        this.drain();
      }, 120_000);
      this.jobs.add(job);
      queued = job;
      this.waiting.push(job);
      this.drain();
    });
    if (queued) queued.promise = request;
    return request;
  }

  prioritize(request: Promise<unknown>): void {
    for (const job of this.jobs) if (job.promise === request) job.manual = true;
    this.drain();
  }

  googleUnavailable(): boolean {
    return Date.now() < this.googleCooldown;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const job of this.jobs) {
      job.controller.abort();
      job.reject(new Error('翻译队列已停止'));
    }
    this.waiting = [];
  }

  private execute(job: Job, fallback: boolean): Promise<unknown> {
    const { signal } = job.controller;
    if (signal.aborted) return Promise.reject(new Error('翻译请求已取消'));
    let abort!: () => void;
    const canceled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('翻译请求已取消'));
      signal.addEventListener('abort', abort, { once: true });
    });
    let task: Promise<unknown>;
    try {
      task = (fallback ? job.fallback! : job.run)(signal);
    } catch (error) {
      task = Promise.reject(error);
    }
    return Promise.race([task, canceled]).finally(() =>
      signal.removeEventListener('abort', abort),
    );
  }

  private eligible(job: Job): boolean {
    return (
      Date.now() < job.deadlineAt &&
      !this.active.has(job.accountId) &&
      (!job.google ||
        (!this.googleActive &&
          Date.now() >= this.googleNext &&
          (Boolean(job.fallback) || !this.googleUnavailable())))
    );
  }

  private drain(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || this.active.size >= 3) return;
    const priority = this.waiting.findIndex(
      job => job.outgoing && this.eligible(job),
    );
    const manual = this.waiting.findIndex(
      job => job.manual && this.eligible(job),
    );
    const index =
      priority >= 0
        ? priority
        : manual >= 0
          ? manual
          : this.waiting.findIndex(job => this.eligible(job));
    if (index < 0) {
      if (
        !this.googleActive &&
        this.waiting.some(job => job.google && !this.active.has(job.accountId))
      ) {
        this.timer = setTimeout(
          () => this.drain(),
          Math.min(
            2_147_483_647,
            Math.max(
              1,
              Math.min(
                ...this.waiting
                  .filter(job => job.google && !this.active.has(job.accountId))
                  .map(job =>
                    Math.max(
                      this.googleNext,
                      job.fallback ? 0 : this.googleCooldown,
                    ),
                  ),
              ) - Date.now(),
            ),
          ),
        );
      }
      return;
    }
    const [job] = this.waiting.splice(index, 1);
    this.active.add(job.accountId);
    job.attempts += 1;
    if (job.google) {
      this.googleActive = true;
      this.googleNext = Date.now() + 1000;
    }
    const usingFallback =
      job.google && Boolean(job.fallback) && this.googleUnavailable();
    const task = this.execute(job, usingFallback);
    task
      .then(async value => {
        if (job.controller.signal.aborted) return;
        const result = value as ProviderResult | undefined;
        if (
          job.google &&
          !usingFallback &&
          (result?.rateLimited || result?.unavailable)
        ) {
          this.googleFailures += 1;
          const backoff = Math.min(
            120_000,
            5000 * 2 ** Math.min(5, this.googleFailures - 1),
          );
          const delay = Math.max(backoff, result.retryAfterMs || 0);
          this.googleCooldown = Math.max(
            this.googleCooldown,
            Date.now() + delay,
          );
          if (job.fallback && !this.disposed) {
            try {
              job.resolve(await this.execute(job, true));
            } catch (error) {
              job.reject(error);
            }
            return;
          }
          if (job.attempts < 3 && !this.disposed) {
            this.waiting.unshift(job);
            return;
          }
          job.resolve({
            ...result,
            retryAfterMs: delay,
            message: `Google 请求过于频繁，已自动重试 ${job.attempts - 1} 次；请约 ${Math.ceil(delay / 1000)} 秒后重试`,
          });
        } else {
          if (
            job.google &&
            !usingFallback &&
            result?.error === false &&
            !result.fromCache
          ) {
            this.googleFailures = 0;
            this.googleCooldown = 0;
          }
          job.resolve(value);
        }
      }, job.reject)
      .finally(() => {
        this.active.delete(job.accountId);
        if (job.google) this.googleActive = false;
        this.drain();
      });
    this.drain();
  }
}
