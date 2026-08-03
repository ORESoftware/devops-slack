export class QueueFullError extends Error {
  constructor(maxQueue) {
    super(`Request queue is full (maximum ${maxQueue})`);
    this.name = "QueueFullError";
    this.code = "QUEUE_FULL";
    this.maxQueue = maxQueue;
  }
}

export class QueueTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Timed out after ${timeoutMs}ms waiting for a concurrency permit`);
    this.name = "QueueTimeoutError";
    this.code = "QUEUE_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

export class Semaphore {
  #active = 0;
  #queue = [];

  constructor(
    limit,
    {
      maxQueue = Number.POSITIVE_INFINITY,
      queueTimeoutMs = Number.POSITIVE_INFINITY
    } = {}
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Semaphore limit must be positive");
    }
    if (
      maxQueue !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(maxQueue) || maxQueue < 0)
    ) {
      throw new Error("Semaphore maxQueue must be a non-negative integer or Infinity");
    }
    if (
      queueTimeoutMs !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(queueTimeoutMs) || queueTimeoutMs < 1)
    ) {
      throw new Error("Semaphore queueTimeoutMs must be a positive integer or Infinity");
    }
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#queue.length;
  }

  async acquire() {
    if (this.#active < this.limit) {
      this.#active += 1;
      return this.#releaseFactory();
    }

    if (this.#queue.length >= this.maxQueue) {
      throw new QueueFullError(this.maxQueue);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: undefined };
      if (Number.isFinite(this.queueTimeoutMs)) {
        waiter.timer = setTimeout(() => {
          const index = this.#queue.indexOf(waiter);
          if (index === -1) return;
          this.#queue.splice(index, 1);
          reject(new QueueTimeoutError(this.queueTimeoutMs));
        }, this.queueTimeoutMs);
      }
      this.#queue.push(waiter);
    });
  }

  async use(callback) {
    const release = await this.acquire();
    try {
      return await callback();
    } finally {
      release();
    }
  }

  #releaseFactory() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#queue.shift();
      if (next) {
        clearTimeout(next.timer);
        // Transfer the existing permit directly to the oldest waiter. Keeping
        // #active unchanged prevents a new caller from barging into the gap.
        queueMicrotask(() => next.resolve(this.#releaseFactory()));
      } else {
        this.#active -= 1;
      }
    };
  }
}
