// A suspend/resume cycle can request one reload, never a repeating reload loop.
export default class ResumeReload {
  private suspendedAt?: number;

  private pending = false;

  private timer?: ReturnType<typeof setTimeout>;

  private disposed = false;

  constructor(
    private hooks: {
      enabled: () => boolean;
      thresholdMinutes: () => number;
      online: () => boolean;
      reload: () => void;
    },
  ) {}

  suspend() {
    if (this.disposed) return;
    this.cancel();
    this.suspendedAt = Date.now();
  }

  resume() {
    if (this.disposed || this.suspendedAt === undefined) return;
    const started = this.suspendedAt;
    this.suspendedAt = undefined;
    const threshold = this.hooks.thresholdMinutes();
    if (
      !this.hooks.enabled() ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      Date.now() - started < threshold * 60_000
    )
      return;
    this.pending = true;
    this.schedule();
  }

  online() {
    this.schedule();
  }

  private schedule() {
    if (
      this.disposed ||
      !this.pending ||
      this.timer !== undefined ||
      !this.hooks.online()
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.pending || this.disposed) return;
      if (!this.hooks.enabled()) {
        this.cancel();
        return;
      }
      if (!this.hooks.online()) return;
      this.pending = false;
      this.hooks.reload();
    }, 2000);
  }

  private cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
