import assert from "node:assert/strict";
import test from "node:test";
import { SlackChannelContext, sanitizeSlackContextText } from "../src/slack/channel-context.js";

const fakeGitHubToken = `gh${"p"}_${"a".repeat(36)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("sanitizes Slack markup, identifiers, and recognizable credentials", () => {
  const value = sanitizeSlackContextText(
    "Ask <@U123456789> in <#C123456789|general> and <!subteam^S123456789|@ops> " +
      `about <!here> using ${fakeGitHubToken} and <https://example.com|docs>.`
  );

  assert.equal(
    value,
    "Ask @user in #general and @ops about @here using [REDACTED_TOKEN] and docs (https://example.com)."
  );
  assert.doesNotMatch(value, /U123456789|C123456789|S123456789|ghp_/);
});

test("returns the newest eligible human messages in chronological order", async () => {
  const calls = [];
  const context = new SlackChannelContext({ messageCount: 3, cacheTtlMs: 60_000 });
  const client = {
    conversations: {
      async history(payload) {
        calls.push(payload);
        return {
          messages: [
            { user: "U5", text: "newest" },
            { bot_id: "B1", user: "U4", text: "bot output" },
            { user: "U3", subtype: "channel_join", text: "joined" },
            { user: "U2", subtype: "thread_broadcast", text: "middle" },
            { user: "U1", text: "oldest selected" },
            { user: "U0", text: "too old" }
          ]
        };
      }
    }
  };

  assert.deepEqual(await context.get({ client, channelId: "C1" }), [
    "oldest selected",
    "middle",
    "newest"
  ]);
  assert.deepEqual(calls, [{ channel: "C1", limit: 9 }]);
});

test("coalesces concurrent reads and returns defensive copies", async () => {
  const response = deferred();
  let calls = 0;
  const context = new SlackChannelContext({ messageCount: 1, cacheTtlMs: 60_000 });
  const client = {
    conversations: {
      history() {
        calls += 1;
        return response.promise;
      }
    }
  };

  const first = context.get({ client, channelId: "C1" });
  const second = context.get({ client, channelId: "C1" });
  assert.equal(calls, 1);
  response.resolve({ messages: [{ user: "U1", text: "hello" }] });

  const [firstMessages, secondMessages] = await Promise.all([first, second]);
  firstMessages.push("mutated");
  assert.deepEqual(secondMessages, ["hello"]);
  assert.deepEqual(await context.get({ client, channelId: "C1" }), ["hello"]);
  assert.equal(calls, 1);
});

test("expires cached values and evicts the least recently used channel", async () => {
  let currentTime = 1_000;
  const calls = [];
  const context = new SlackChannelContext({
    messageCount: 1,
    cacheTtlMs: 1_000,
    maxEntries: 2,
    now: () => currentTime
  });
  const client = {
    conversations: {
      async history({ channel }) {
        calls.push(channel);
        return { messages: [{ user: "U1", text: `${channel}-${calls.length}` }] };
      }
    }
  };

  await context.get({ client, channelId: "C1" });
  await context.get({ client, channelId: "C2" });
  await context.get({ client, channelId: "C1" });
  await context.get({ client, channelId: "C3" });
  await context.get({ client, channelId: "C2" });
  currentTime += 1_001;
  await context.get({ client, channelId: "C1" });

  assert.deepEqual(calls, ["C1", "C2", "C3", "C2", "C1"]);
});

test("bounds each retained message so aggregate context stays within maxChars", async () => {
  const context = new SlackChannelContext({ messageCount: 2, maxChars: 256 });
  const client = {
    conversations: {
      async history() {
        return {
          messages: [
            { user: "U2", text: "b".repeat(500) },
            { user: "U1", text: "a".repeat(500) }
          ]
        };
      }
    }
  };

  const messages = await context.get({ client, channelId: "C1" });
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.length <= 128));
  assert.ok(messages.reduce((total, message) => total + message.length, 0) <= 256);
  assert.ok(messages.every((message) => message.endsWith("…")));
});

test("disabled context avoids Slack API calls", async () => {
  const context = new SlackChannelContext({ messageCount: 0 });
  assert.equal(context.enabled, false);
  assert.deepEqual(
    await context.get({
      channelId: "C1",
      client: {
        conversations: {
          history() {
            throw new Error("must not be called");
          }
        }
      }
    }),
    []
  );
});

test("rejects invalid limits and malformed Slack clients", async () => {
  assert.throws(() => new SlackChannelContext({ messageCount: 16 }), /messageCount/);
  assert.throws(() => new SlackChannelContext({ cacheTtlMs: 999 }), /cacheTtlMs/);
  assert.throws(() => new SlackChannelContext({ maxChars: 255 }), /maxChars/);
  assert.throws(() => new SlackChannelContext({ maxEntries: 0 }), /maxEntries/);
  assert.throws(() => new SlackChannelContext({ now: 42 }), /now/);

  const context = new SlackChannelContext();
  await assert.rejects(() => context.get({ client: {}, channelId: "C1" }), /conversations.history/);
});
