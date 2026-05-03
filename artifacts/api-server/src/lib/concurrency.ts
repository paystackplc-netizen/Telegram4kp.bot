/**
 * Simple semaphore — limits how many async tasks run simultaneously.
 * Excess requests get a "busy" rejection immediately (no unbounded queue).
 */
export class Semaphore {
  private running = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get active(): number { return this.running; }
  get available(): boolean { return this.running < this.max; }

  /**
   * Run `fn` if a slot is free. Returns false if all slots are taken.
   */
  async run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (this.running >= this.max) return { ok: false };
    this.running++;
    try {
      const value = await fn();
      return { ok: true, value };
    } finally {
      this.running--;
    }
  }
}

// Shared semaphore: 3 concurrent voice/media tasks across all users
export const taskSemaphore = new Semaphore(3);
