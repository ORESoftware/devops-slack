import assert from "node:assert/strict";
import test from "node:test";
import { handleSlashCommand } from "../src/register-commands.js";

const definition = {
  command: "/ores-chatgpt",
  provider: "openai",
  profile: "ores",
  description: "Ask ChatGPT",
  usage_hint: "<prompt>"
};

function fixture() {
  const responses = [];
  return {
    responses,
    dependencies: {
      definition,
      command: {
        command: definition.command,
        text: "summarize the channel",
        enterprise_id: "E1",
        team_id: "T1",
        channel_id: "C1",
        user_id: "U1"
      },
      respond: async (payload) => responses.push(payload),
      client: {
        chat: {
          postMessage: async () => ({ ok: true, ts: "1.1" }),
          postEphemeral: async () => ({ ok: true })
        }
      },
      logger: { info() {}, warn() {}, error() {} },
      router: {
        async run() {
          return { text: "done", model: "gpt-test", provider: "openai" };
        }
      },
      semaphore: { use: (callback) => callback() },
      runtimeConfig: {
        allowPublicResponses: true,
        allowedUserIds: new Set(),
        allowedChannelIds: new Set(),
        allowedModels: { openai: new Set(), anthropic: new Set() },
        maxPromptChars: 12_000,
        maxResponseChars: 16_000
      },
      profiles: { ores: { label: "ORES" } }
    }
  };
}

test("queue saturation rejects before reading Slack channel history", async () => {
  const data = fixture();
  let contextCalls = 0;
  let routerCalls = 0;
  data.dependencies.channelContext = {
    enabled: true,
    async get() {
      contextCalls += 1;
      return ["must not be fetched"];
    }
  };
  data.dependencies.router.run = async () => {
    routerCalls += 1;
    return { text: "must not run", model: "gpt-test", provider: "openai" };
  };
  data.dependencies.semaphore = {
    async use() {
      throw Object.assign(new Error("queue is full"), { code: "QUEUE_FULL" });
    }
  };

  await handleSlashCommand(data.dependencies);

  assert.equal(contextCalls, 0);
  assert.equal(routerCalls, 0);
  assert.equal(data.responses[0].text, "Working on /ores-chatgpt…");
  assert.equal(data.responses.at(-1).replace_original, true);
  assert.equal(data.responses.at(-1).text, "The app is at capacity. Try again shortly.");
});

test("per-user and global admission both wrap context retrieval and provider work", async () => {
  const data = fixture();
  const events = [];
  let routedContext;

  data.dependencies.userSemaphore = {
    async use(key, callback) {
      assert.equal(key, "T1:U1");
      events.push("user:enter");
      try {
        return await callback();
      } finally {
        events.push("user:exit");
      }
    }
  };
  data.dependencies.semaphore = {
    async use(callback) {
      events.push("global:enter");
      try {
        return await callback();
      } finally {
        events.push("global:exit");
      }
    }
  };
  data.dependencies.channelContext = {
    enabled: true,
    async get({ enterpriseId, teamId, channelId }) {
      assert.deepEqual({ enterpriseId, teamId, channelId }, {
        enterpriseId: "E1",
        teamId: "T1",
        channelId: "C1"
      });
      events.push("context");
      return ["bounded channel context"];
    }
  };
  data.dependencies.router.run = async ({ recentMessages }) => {
    routedContext = recentMessages;
    events.push("router");
    return { text: "done", model: "gpt-test", provider: "openai" };
  };

  await handleSlashCommand(data.dependencies);

  assert.deepEqual(events, [
    "user:enter",
    "global:enter",
    "context",
    "router",
    "global:exit",
    "user:exit"
  ]);
  assert.deepEqual(routedContext, ["bounded channel context"]);
  assert.match(data.responses.at(-1).text, /done/);
});
