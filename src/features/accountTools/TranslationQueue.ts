interface ProviderResult {
  text?: string;
  error?: boolean;
  rateLimited?: boolean;
  retryAfterMs?: number;
  message?: string;
}
interface Job {
  accountId: string;
  outgoing: boolean;
  google: boolean;
  attempts: number;
  run: () => Promise<unknown>;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
}
// Bound traffic across accounts. Google shares one paced lane because several
// accounts may use the same public IP; changing accounts must not defeat 429.
export default class TranslationQueue {
  private active = new Set<string>();

  private waiting: Job[] = [];

  private googleActive = false;

  private googleNext = 0;

  private googleFailures = 0;

  private timer?: ReturnType<typeof setTimeout>;

  private disposed = false;

  enqueue<T>(
    accountId: string,
    outgoing: boolean,
    run: () => Promise<T>,
    google = false,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('翻译队列已停止'));
    if (this.waiting.length >= 240)
      return Promise.reject(new Error('翻译队列繁忙，请稍后重试'));
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        accountId,
        outgoing,
        run,
        google,
        attempts: 0,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const job of this.waiting) job.reject(new Error('翻译队列已停止'));
    this.waiting = [];
  }

  private eligible(job: Job): boolean {
    return (
      !this.active.has(job.accountId) &&
      (!job.google || (!this.googleActive && Date.now() >= this.googleNext))
    );
  }

  private drain(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || this.active.size >= 3) return;
    const priority = this.waiting.findIndex(
      job => job.outgoing && this.eligible(job),
    );
    const index =
      priority >= 0
        ? priority
        : this.waiting.findIndex(job => this.eligible(job));
    if (index < 0) {
      if (
        !this.googleActive &&
        this.waiting.some(job => job.google && !this.active.has(job.accountId))
      ) {
        this.timer = setTimeout(
          () => this.drain(),
          Math.min(2_147_483_647, Math.max(1, this.googleNext - Date.now())),
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
    let task: Promise<unknown>;
    try {
      task = job.run();
    } catch (error) {
      task = Promise.reject(error);
    }
    task
      .then(value => {
        const result = value as ProviderResult | undefined;
        if (job.google && result?.rateLimited) {
          this.googleFailures += 1;
          const backoff = Math.min(
            120_000,
            5000 * 2 ** Math.min(5, this.googleFailures - 1),
          );
          const delay = Math.max(backoff, result.retryAfterMs || 0);
          this.googleNext = Math.max(this.googleNext, Date.now() + delay);
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
          if (job.google && result?.error === false) this.googleFailures = 0;
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
