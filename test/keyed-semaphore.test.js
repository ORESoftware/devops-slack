import assert from "node:assert/strict";
import test from "node:test";
import { KeyedSemaphore } from "../src/keyed-semaphore.js";

test("limits work independently per key and removes idle entries", async () => {
  const keyed = new KeyedSemaphore(1, { maxQueue: 2 });
  let userAActive = 0;
  let userAPeak = 0;
  let totalActive = 0;
  let totalPeak = 0;

  const run = (key, delay) =>
    keyed.use(key, async () => {
      totalActive += 1;
      totalPeak = Math.max(totalPeak, totalActive);
      if (key === "U1") {
        userAActive += 1;
        userAPeak = Math.max(userAPeak, userAActive);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (key === "U1") userAActive -= 1;
      totalActive -= 1;
    });

  await Promise.all([run("U1", 10), run("U1", 2), run("U2", 5)]);
  assert.equal(userAPeak, 1);
  assert.equal(totalPeak, 2);
  assert.equal(keyed.size, 0);
});

test("one key cannot consume another key's queue allowance", async () => {
  const keyed = new KeyedSemaphore(1, { maxQueue: 0 });
  /** @type {(value?: unknown) => void} */
  let finish = () => {};
  const first = keyed.use("U1", () => new Promise((resolve) => { finish = resolve; }));

  await assert.rejects(keyed.use("U1", async () => {}), (error) => {
    assert.equal(/** @type {any} */ (error).code, "QUEUE_FULL");
    return true;
  });
  await keyed.use("U2", async () => {});
  finish();
  await first;
  assert.equal(keyed.size, 0);
});

test("validates keys and callbacks", async () => {
  const keyed = new KeyedSemaphore(1);
  await assert.rejects(keyed.use("", async () => {}), /non-empty string/);
  await assert.rejects(keyed.use("U1", /** @type {any} */ (null)), /must be a function/);
});
