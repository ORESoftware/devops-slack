import assert from "node:assert/strict";
import test from "node:test";
import { createCommandHarness } from "../support/command-harness.mjs";

function immediateTimer(callback) {
  queueMicrotask(callback);
  return Symbol("timer");
}

test("CLI flow paginates Slack history before invoking the provider", async () => {
  const harness = createCommandHarness({
    channelHistoryPages: [
      {
        messages: [{ user: "U_BOT", bot_id: "B1", text: "ignore me" }],
        has_more: true,
        response_metadata: { next_cursor: "next-page" }
      },
      {
        messages: [{ user: "U_HUMAN", text: "paginated CLI context marker" }],
        has_more: false,
        response_metadata: { next_cursor: "" }
      }
    ],
    channelContextOptions: { messageCount: 1, maxPages: 2 }
  });

  const result = await harness.invoke({
    commandName: "/ores-chatgpt",
    text: "audit this plan"
  });

  assert.equal(result.historyCalls.length, 2);
  assert.equal(result.historyCalls[1].cursor, "next-page");
  assert.match(result.finalResponse, /paginated CLI context marker/);
  assert.match(result.finalResponse, /currentUserRequest/);
});

test("CLI flow fails open when Slack context retrieval times out", async () => {
  const harness = createCommandHarness({
    historyHandler() {
      return new Promise(() => {});
    },
    channelContextOptions: {
      messageCount: 1,
      fetchTimeoutMs: 1,
      setTimer: immediateTimer,
      clearTimer() {}
    }
  });

  const result = await harness.invoke({
    commandName: "/ores-chatgpt",
    text: "continue without Slack history"
  });

  assert.match(result.finalResponse, /Prompt: continue without Slack history/);
  assert.doesNotMatch(result.finalResponse, /recentSlackMessages/);
  const warning = result.logs.find((entry) => entry.event === "slack_context_unavailable");
  assert.equal(warning?.level, "warn");
  assert.equal(warning?.payload?.error?.code, "SLACK_HISTORY_TIMEOUT");
});
