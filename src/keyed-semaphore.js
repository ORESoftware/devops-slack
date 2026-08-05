import { Semaphore } from "./semaphore.js";

/**
 * Lazily creates one bounded semaphore per key and removes idle entries.
 * This prevents a single Slack user from occupying every global queue slot.
 */
export class KeyedSemaphore {
  #entries = new Map();

  constructor(limit, options = {}) {
    // Validate constructor arguments eagerly through the underlying primitive.
    new Semaphore(limit, options);
    this.limit = limit;
    this.options = Object.freeze({ ...options });
  }

  get size() {
    return this.#entries.size;
  }

  activeFor(key) {
    return this.#entries.get(key)?.active ?? 0;
  }

  queuedFor(key) {
    return this.#entries.get(key)?.queued ?? 0;
  }

  async use(key, callback) {
    if (typeof key !== "string" || key.length === 0 || key.length > 256) {
      throw new Error("KeyedSemaphore key must be a non-empty string of at most 256 characters");
    }
    if (typeof callback !== "function") {
      throw new Error("KeyedSemaphore callback must be a function");
    }

    let semaphore = this.#entries.get(key);
    if (!semaphore) {
      semaphore = new Semaphore(this.limit, this.options);
      this.#entries.set(key, semaphore);
    }

    try {
      return await semaphore.use(callback);
    } finally {
      if (
        semaphore.active === 0 &&
        semaphore.queued === 0 &&
        this.#entries.get(key) === semaphore
      ) {
        this.#entries.delete(key);
      }
    }
  }
}
