export class DrainTimeoutError extends Error {
  constructor(activeTasks) {
    super(`Timed out waiting for ${activeTasks} in-flight command(s) to finish`);
    this.name = "DrainTimeoutError";
    this.code = "DRAIN_TIMEOUT";
    this.activeTasks = activeTasks;
  }
}

export class TaskTracker {
  #accepting = true;
  #tasks = new Set();

  get accepting() {
    return this.#accepting;
  }

  get active() {
    return this.#tasks.size;
  }

  stopAccepting() {
    this.#accepting = false;
  }

  run(factory) {
    if (!this.#accepting) return undefined;

    let task;
    try {
      task = Promise.resolve(factory());
    } catch (error) {
      task = Promise.reject(error);
    }

    this.#tasks.add(task);
    const cleanup = () => this.#tasks.delete(task);
    void task.then(cleanup, cleanup);
    return task;
  }

  async drain(timeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("TaskTracker timeout must be a positive integer");
    }

    const deadline = Date.now() + timeoutMs;
    while (this.#tasks.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new DrainTimeoutError(this.active);

      let timer;
      try {
        await Promise.race([
          Promise.allSettled([...this.#tasks]),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new DrainTimeoutError(this.active)), remainingMs);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
