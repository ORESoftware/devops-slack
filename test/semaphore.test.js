import assert from "node:assert/strict";
import test from "node:test";
import { Semaphore } from "../src/semaphore.js";

test("limits concurrent work", async () => {
  const semaphore = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const work = Array.from({ length: 6 }, (_, index) =>
    semaphore.use(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return index;
    })
  );
  assert.deepEqual(await Promise.all(work), [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});

test("hands a released permit to queued work without allowing barging", async () => {
  const semaphore = new Semaphore(1);
  const releaseFirst = await semaphore.acquire();
  const order = [];

  const queued = semaphore.use(async () => {
    order.push("queued");
  });
  assert.equal(semaphore.queued, 1);

  releaseFirst();
  const newcomer = semaphore.use(async () => {
    order.push("newcomer");
  });

  await Promise.all([queued, newcomer]);
  assert.deepEqual(order, ["queued", "newcomer"]);
  assert.equal(semaphore.active, 0);
  assert.equal(semaphore.queued, 0);
});

test("rejects excess queued work instead of growing without bound", async () => {
  const semaphore = new Semaphore(1, { maxQueue: 1 });
  const releaseFirst = await semaphore.acquire();
  const queued = semaphore.acquire();

  await assert.rejects(semaphore.acquire(), (error) => {
    const details = /** @type {any} */ (error);
    assert.equal(details.name, "QueueFullError");
    assert.equal(details.code, "QUEUE_FULL");
    return true;
  });

  releaseFirst();
  const releaseQueued = await queued;
  releaseQueued();
  assert.equal(semaphore.active, 0);
  assert.equal(semaphore.queued, 0);
});

test("supports disabling the wait queue entirely", async () => {
  const semaphore = new Semaphore(1, { maxQueue: 0 });
  const release = await semaphore.acquire();
  await assert.rejects(semaphore.acquire(), /Request queue is full/);
  release();
});

test("expires stale queued work without leaking a waiter", async () => {
  const semaphore = new Semaphore(1, { maxQueue: 2, queueTimeoutMs: 10 });
  const release = await semaphore.acquire();

  await assert.rejects(semaphore.acquire(), (error) => {
    const details = /** @type {any} */ (error);
    assert.equal(details.code, "QUEUE_TIMEOUT");
    assert.equal(details.timeoutMs, 10);
    return true;
  });

  assert.equal(semaphore.queued, 0);
  release();
  assert.equal(semaphore.active, 0);
});
