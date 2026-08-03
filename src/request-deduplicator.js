/**
 * Bounded TTL deduplication for Slack retry identifiers.
 * The map relies on insertion order so expired/oldest entries can be evicted cheaply.
 */
export class RequestDeduplicator {
  #entries = new Map();

  constructor({ ttlMs = 300_000, maxEntries = 10_000, now = Date.now } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new Error("RequestDeduplicator ttlMs must be a positive integer");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("RequestDeduplicator maxEntries must be a positive integer");
    }
    if (typeof now !== "function") throw new Error("RequestDeduplicator now must be a function");
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size() {
    return this.#entries.size;
  }

  accept(key) {
    if (typeof key !== "string" || key.length === 0 || key.length > 512) {
      throw new Error("RequestDeduplicator key must be a non-empty string of at most 512 characters");
    }

    const now = this.now();
    this.#pruneExpired(now);
    const expiresAt = this.#entries.get(key);
    if (expiresAt !== undefined && expiresAt > now) return false;

    this.#entries.delete(key);
    while (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, now + this.ttlMs);
    return true;
  }

  #pruneExpired(now) {
    for (const [key, expiresAt] of this.#entries) {
      if (expiresAt > now) break;
      this.#entries.delete(key);
    }
  }
}
