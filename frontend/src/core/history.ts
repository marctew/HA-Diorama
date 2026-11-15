/** Undo and redo over whole states. States are never changed in place (see
 * plan.ts), so keeping the old ones is cheap. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private current: T,
    private readonly limit = 200,
  ) {}

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make `state` the present. Does nothing if it already is. */
  push(state: T): void {
    if (state === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = state;
    this.future = [];
  }

  undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) return this.current;
    this.future.push(this.current);
    this.current = previous;
    return this.current;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.current;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }

  /** Start again from `state`, forgetting everything before it. */
  reset(state: T): void {
    this.current = state;
    this.past = [];
    this.future = [];
  }
}
