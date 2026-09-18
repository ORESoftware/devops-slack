import assert from "node:assert/strict";
import test from "node:test";
import { RequestDeduplicator } from "../src/request-deduplicator.js";

test("rejects duplicates during the TTL and accepts them after expiry", () => {
  let now = 1_000;
  const dedupe = new RequestDeduplicator({ ttlMs: 100, maxEntries: 10, now: () => now });
  assert.equal(dedupe.accept("T1:trigger-1"), true);
  assert.equal(dedupe.accept("T1:trigger-1"), false);
  now += 101;
  assert.equal(dedupe.accept("T1:trigger-1"), true);
});

test("evicts the oldest entry when the bounded map is full", () => {
  const dedupe = new RequestDeduplicator({ ttlMs: 10_000, maxEntries: 2, now: () => 1_000 });
  assert.equal(dedupe.accept("one"), true);
  assert.equal(dedupe.accept("two"), true);
  assert.equal(dedupe.accept("three"), true);
  assert.equal(dedupe.size, 2);
  assert.equal(dedupe.accept("one"), true);
});

test("validates limits and keys", () => {
  assert.throws(() => new RequestDeduplicator({ ttlMs: 0 }), /positive integer/);
  assert.throws(() => new RequestDeduplicator({ maxEntries: 0 }), /positive integer/);
  const dedupe = new RequestDeduplicator();
  assert.throws(() => dedupe.accept(""), /non-empty string/);
});
