// A fixed, per-window startup limit. Settled accounts stay mounted afterwards.
export default class StartupQueue {
  admitted = new Set<string>();

  private loading = new Set<string>();

  private pending: string[] = [];

  constructor(
    private notify: () => void,
    private limit = 2,
  ) {}

  update(ids: string[], immediate: ReadonlySet<string> = new Set()) {
    const current = new Set(ids);
    for (const id of this.loading)
      if (!current.has(id)) this.loading.delete(id);
    // User-created sessions open independently of the two boot-time slots.
    // They must not occupy or release those slots when their page settles.
    let changed = false;
    for (const id of ids) {
      if (immediate.has(id) && !this.admitted.has(id)) {
        this.admitted.add(id);
        changed = true;
      }
    }
    this.pending = ids.filter(id => !this.admitted.has(id));
    if (changed) this.notify();
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
