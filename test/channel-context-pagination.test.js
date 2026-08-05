import assert from "node:assert/strict";
import test from "node:test";
import { SlackChannelContext } from "../src/slack/channel-context.js";

test("paginates through ineligible Slack history and returns human context chronologically", async () => {
  const calls = [];
  const context = new SlackChannelContext({ messageCount: 2, maxPages: 3 });
  const client = {
    conversations: {
      async history(payload) {
        calls.push(payload);
        if (!payload.cursor) {
          return {
            ok: true,
            messages: [
              { user: "U_BOT", bot_id: "B1", text: "ignore bot output" },
              { user: "U_JOIN", subtype: "channel_join", text: "joined" }
            ],
            has_more: true,
            response_metadata: { next_cursor: "cursor-page-2" }
          };
        }
        return {
          ok: true,
          messages: [
            { ts: "2", user: "U2", text: "newer context" },
            { ts: "1", user: "U1", text: "older context" }
          ],
          has_more: false,
          response_metadata: { next_cursor: "" }
        };
      }
    }
  };

  assert.deepEqual(await context.get({ client, channelId: "C1" }), [
    "older context",
    "newer context"
  ]);
  assert.deepEqual(calls, [
    { channel: "C1", limit: 6 },
    { channel: "C1", limit: 6, cursor: "cursor-page-2" }
  ]);
});

test("stops pagination as soon as enough eligible messages are collected", async () => {
  const calls = [];
  const context = new SlackChannelContext({ messageCount: 1, maxPages: 3 });
  const client = {
    conversations: {
      async history(payload) {
        calls.push(payload);
        return {
          messages: [{ ts: "1", user: "U1", text: "enough" }],
          has_more: true,
          response_metadata: { next_cursor: "unused-page" }
        };
      }
    }
  };

  assert.deepEqual(await context.get({ client, channelId: "C1" }), ["enough"]);
  assert.equal(calls.length, 1);
});

test("rejects repeated cursors and does not cache partial paginated context", async () => {
  let calls = 0;
  const context = new SlackChannelContext({ messageCount: 2, maxPages: 3 });
  const client = {
    conversations: {
      async history({ cursor }) {
        calls += 1;
        if (!cursor) {
          return {
            messages: [{ ts: "2", user: "U2", text: "partial" }],
            has_more: true,
            response_metadata: { next_cursor: "same-cursor" }
          };
        }
        return {
          messages: [],
          has_more: true,
          response_metadata: { next_cursor: "same-cursor" }
        };
      }
    }
  };

  await assert.rejects(
    () => context.get({ client, channelId: "C1" }),
    (error) => error?.code === "SLACK_HISTORY_CURSOR_LOOP"
  );
  await assert.rejects(
    () => context.get({ client, channelId: "C1" }),
    (error) => error?.code === "SLACK_HISTORY_CURSOR_LOOP"
  );
  assert.equal(calls, 4);
});

test("times out a hung Slack history request and allows a later retry", async () => {
  let forceTimeout = true;
  const context = new SlackChannelContext({
    messageCount: 1,
    fetchTimeoutMs: 1,
    setTimer(callback) {
      if (forceTimeout) queueMicrotask(callback);
      return Symbol("timer");
    },
    clearTimer() {}
  });
  const hungClient = {
    conversations: {
      history() {
        return new Promise(() => {});
      }
    }
  };

  await assert.rejects(
    () => context.get({ client: hungClient, channelId: "C1" }),
    (error) => error?.code === "SLACK_HISTORY_TIMEOUT"
  );

  forceTimeout = false;
  const healthyClient = {
    conversations: {
      async history() {
        return { messages: [{ user: "U1", text: "recovered" }] };
      }
    }
  };
  assert.deepEqual(await context.get({ client: healthyClient, channelId: "C1" }), ["recovered"]);
});

test("does not cache a successful first page when a later Slack page fails", async () => {
  let attempt = 0;
  const context = new SlackChannelContext({ messageCount: 2, maxPages: 2 });
  const client = {
    conversations: {
      async history({ cursor }) {
        if (!cursor) {
          attempt += 1;
          return {
            messages: [{ ts: `partial-${attempt}`, user: "U1", text: `partial-${attempt}` }],
            has_more: true,
            response_metadata: { next_cursor: `page-${attempt}` }
          };
        }
        if (attempt === 1) return { ok: false, error: "ratelimited" };
        return {
          messages: [{ ts: "complete", user: "U2", text: "complete" }],
          has_more: false,
          response_metadata: { next_cursor: "" }
        };
      }
    }
  };

  await assert.rejects(
    () => context.get({ client, channelId: "C1" }),
    (error) => error?.code === "SLACK_HISTORY_FAILED"
  );
  assert.deepEqual(await context.get({ client, channelId: "C1" }), ["complete", "partial-2"]);
});

test("deduplicates overlapping pages by Slack timestamp", async () => {
  const context = new SlackChannelContext({ messageCount: 3, maxPages: 2 });
  const client = {
    conversations: {
      async history({ cursor }) {
        if (!cursor) {
          return {
            messages: [
              { ts: "3", user: "U3", text: "newest" },
              { ts: "2", user: "U2", text: "overlap" }
            ],
            has_more: true,
            response_metadata: { next_cursor: "page-2" }
          };
        }
        return {
          messages: [
            { ts: "2", user: "U2", text: "overlap duplicate" },
            { ts: "1", user: "U1", text: "oldest" }
          ],
          has_more: false,
          response_metadata: { next_cursor: "" }
        };
      }
    }
  };

  assert.deepEqual(await context.get({ client, channelId: "C1" }), [
    "oldest",
    "overlap",
    "newest"
  ]);
});

test("rejects contradictory or malformed pagination metadata", async () => {
  const missingCursor = new SlackChannelContext({ messageCount: 2 });
  await assert.rejects(
    () =>
      missingCursor.get({
        channelId: "C1",
        client: {
          conversations: {
            async history() {
              return { messages: [], has_more: true };
            }
          }
        }
      }),
    /without a cursor/
  );

  const malformedMetadata = new SlackChannelContext({ messageCount: 2 });
  await assert.rejects(
    () =>
      malformedMetadata.get({
        channelId: "C1",
        client: {
          conversations: {
            async history() {
              return { messages: [], response_metadata: [] };
            }
          }
        }
      }),
    /invalid response_metadata/
  );
});

test("never reads beyond the configured page cap", async () => {
  const calls = [];
  const context = new SlackChannelContext({ messageCount: 3, maxPages: 2 });
  const client = {
    conversations: {
      async history({ cursor }) {
        calls.push(cursor || null);
        return {
          messages: [{ ts: String(calls.length), user: "U1", text: `page-${calls.length}` }],
          has_more: true,
          response_metadata: { next_cursor: `cursor-${calls.length}` }
        };
      }
    }
  };

  assert.deepEqual(await context.get({ client, channelId: "C1" }), ["page-2", "page-1"]);
  assert.deepEqual(calls, [null, "cursor-1"]);
});

test("validates pagination and timeout limits", () => {
  assert.throws(() => new SlackChannelContext({ maxPages: 0 }), /maxPages/);
  assert.throws(() => new SlackChannelContext({ maxPages: 11 }), /maxPages/);
  assert.throws(() => new SlackChannelContext({ fetchTimeoutMs: 0 }), /fetchTimeoutMs/);
  assert.throws(() => new SlackChannelContext({ fetchTimeoutMs: 60_001 }), /fetchTimeoutMs/);
  assert.throws(() => new SlackChannelContext({ setTimer: null }), /setTimer/);
  assert.throws(() => new SlackChannelContext({ clearTimer: null }), /clearTimer/);
});
