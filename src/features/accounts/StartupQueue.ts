// A fixed, per-window startup limit. Settled accounts stay mounted afterwards.
export default class StartupQueue {
  admitted = new Set<string>();

  private loading = new Set<string>();

  private pending: string[] = [];

  constructor(
    private notify: () => void,
    private limit = 2,
  ) {}

  update(ids: string[]) {
    const current = new Set(ids);
    for (const id of this.loading)
      if (!current.has(id)) this.loading.delete(id);
    this.pending = ids.filter(id => !this.admitted.has(id));
    this.drain();
  }

  complete(id: string) {
    if (this.loading.delete(id)) this.drain();
  }

  private drain() {
    let changed = false;
    while (this.loading.size < this.limit && this.pending.length > 0) {
      const id = this.pending.shift()!;
      if (!this.admitted.has(id)) {
        this.loading.add(id);
        this.admitted.add(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }
}
