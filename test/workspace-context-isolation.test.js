import assert from "node:assert/strict";
import test from "node:test";
import { handleSlashCommand } from "../src/register-commands.js";
import { SlackChannelContext } from "../src/slack/channel-context.js";

function historyClient(text, calls) {
  return {
    conversations: {
      async history(payload) {
        calls.push(payload);
        return { ok: true, messages: [{ user: "U1", text }] };
      }
    }
  };
}

test("isolates cached channel context by enterprise and workspace", async () => {
  const context = new SlackChannelContext({ messageCount: 1, cacheTtlMs: 60_000 });
  const firstCalls = [];
  const secondCalls = [];
  const enterpriseCalls = [];
  const firstClient = historyClient("workspace one", firstCalls);
  const secondClient = historyClient("workspace two", secondCalls);
  const enterpriseClient = historyClient("enterprise two", enterpriseCalls);

  assert.deepEqual(
    await context.get({ client: firstClient, teamId: "T1", channelId: "C_SHARED" }),
    ["workspace one"]
  );
  assert.deepEqual(
    await context.get({ client: secondClient, teamId: "T2", channelId: "C_SHARED" }),
    ["workspace two"]
  );
  assert.deepEqual(
    await context.get({
      client: enterpriseClient,
      enterpriseId: "E2",
      teamId: "T1",
      channelId: "C_SHARED"
    }),
    ["enterprise two"]
  );
  assert.deepEqual(
    await context.get({ client: firstClient, teamId: "T1", channelId: "C_SHARED" }),
    ["workspace one"]
  );

  assert.equal(firstCalls.length, 1);
  assert.equal(secondCalls.length, 1);
  assert.equal(enterpriseCalls.length, 1);
});

test("does not cache explicit Slack history failures or malformed responses", async () => {
  let failureCalls = 0;
  const context = new SlackChannelContext({ messageCount: 1 });
  const failingClient = {
    conversations: {
      async history() {
        failureCalls += 1;
        return { ok: false, error: "missing_scope" };
      }
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => context.get({ client: failingClient, teamId: "T1", channelId: "C1" }),
      (error) => {
        assert.equal(error.code, "SLACK_HISTORY_FAILED");
        assert.match(error.message, /missing_scope/);
        return true;
      }
    );
  }
  assert.equal(failureCalls, 2);

  await assert.rejects(
    () =>
      context.get({
        client: { conversations: { history: async () => ({ ok: true }) } },
        teamId: "T1",
        channelId: "C2"
      }),
    /messages array/
  );
});

test("validates cache-scope identifiers", async () => {
  const context = new SlackChannelContext({ messageCount: 1 });
  const client = historyClient("unused", []);

  await assert.rejects(
    () => context.get({ client, teamId: 42, channelId: "C1" }),
    /teamId must be a string/
  );
  await assert.rejects(
    () => context.get({ client, enterpriseId: "E".repeat(129), channelId: "C1" }),
    /enterpriseId must be a string/
  );
  await assert.rejects(
    () => context.get({ client, teamId: "T1", channelId: "C".repeat(129) }),
    /channelId must be a non-empty string/
  );
});

test("passes enterprise, workspace, and channel identity into context lookup", async () => {
  const responses = [];
  let received;
  await handleSlashCommand({
    definition: {
      command: "/ores-chatgpt",
      provider: "openai",
      profile: "ores",
      description: "Ask ChatGPT",
      usage_hint: "<prompt>"
    },
    command: {
      command: "/ores-chatgpt",
      text: "summarize this",
      enterprise_id: "E1",
      team_id: "T1",
      channel_id: "C1",
      user_id: "U1"
    },
    respond: async (payload) => responses.push(payload),
    client: {
      chat: {
        postEphemeral: async () => ({ ok: true }),
        postMessage: async () => ({ ok: true, ts: "1.1" })
      }
    },
    logger: { info() {}, warn() {}, error() {} },
    router: {
      async run(payload) {
        assert.deepEqual(payload.recentMessages, ["context"]);
        return { text: "done", model: "gpt-test", provider: "openai" };
      }
    },
    semaphore: { use: (callback) => callback() },
    channelContext: {
      enabled: true,
      async get(options) {
        received = options;
        return ["context"];
      }
    },
    runtimeConfig: {
      allowPublicResponses: true,
      allowedUserIds: new Set(),
      allowedChannelIds: new Set(),
      allowedModels: { openai: new Set(), anthropic: new Set() },
      maxPromptChars: 12_000,
      maxResponseChars: 16_000
    },
    profiles: { ores: { label: "ORES" } }
  });

  assert.equal(received.enterpriseId, "E1");
  assert.equal(received.teamId, "T1");
  assert.equal(received.channelId, "C1");
  assert.equal(responses.at(-1).replace_original, true);
  assert.match(responses.at(-1).text, /done/);
});
