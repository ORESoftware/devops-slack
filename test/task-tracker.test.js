import assert from "node:assert/strict";
import test from "node:test";
import { TaskTracker } from "../src/task-tracker.js";

test("tracks tasks and drains after command intake stops", async () => {
  const tracker = new TaskTracker();
  /** @type {() => void} */
  let finish = () => {
    throw new Error("task resolver was not initialized");
  };
  const task = tracker.run(
    () =>
      new Promise((resolve) => {
        finish = () => resolve();
      })
  );

  assert.ok(task);
  assert.equal(tracker.active, 1);
  tracker.stopAccepting();
  assert.equal(tracker.run(async () => {}), undefined);

  const draining = tracker.drain(1_000);
  finish();
  await draining;
  assert.equal(tracker.active, 0);
});

test("drain reports a bounded timeout without losing task state", async () => {
  const tracker = new TaskTracker();
  tracker.run(() => new Promise(() => {}));
  tracker.stopAccepting();

  await assert.rejects(tracker.drain(10), (error) => {
    const details = /** @type {any} */ (error);
    assert.equal(details.code, "DRAIN_TIMEOUT");
    assert.equal(details.activeTasks, 1);
    return true;
  });
  assert.equal(tracker.active, 1);
});

test("synchronous task failures remain tracked promises", async () => {
  const tracker = new TaskTracker();
  const task = tracker.run(() => {
    throw new Error("boom");
  });
  await assert.rejects(task, /boom/);
  await tracker.drain(100);
  assert.equal(tracker.active, 0);
});
