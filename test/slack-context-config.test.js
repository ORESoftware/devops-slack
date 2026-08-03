import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../src/config.js";

test("loads bounded Slack context pagination settings", () => {
  const config = loadRuntimeConfig({
    SLACK_CONTEXT_MAX_PAGES: "4",
    SLACK_CONTEXT_FETCH_TIMEOUT_MS: "2500"
  });

  assert.equal(config.slackContextMaxPages, 4);
  assert.equal(config.slackContextFetchTimeoutMs, 2_500);
});

test("uses safe Slack context pagination defaults", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.slackContextMaxPages, 3);
  assert.equal(config.slackContextFetchTimeoutMs, 10_000);
});

test("rejects unbounded Slack context pagination settings", () => {
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_MAX_PAGES: "0" }),
    /SLACK_CONTEXT_MAX_PAGES/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_MAX_PAGES: "11" }),
    /SLACK_CONTEXT_MAX_PAGES/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_FETCH_TIMEOUT_MS: "99" }),
    /SLACK_CONTEXT_FETCH_TIMEOUT_MS/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_FETCH_TIMEOUT_MS: "60001" }),
    /SLACK_CONTEXT_FETCH_TIMEOUT_MS/
  );
});
