import assert from "node:assert/strict";
import test from "node:test";
import { handleSlashCommand } from "../src/register-commands.js";

const syntheticToken = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const definition = {
  command: "/ores-chatgpt",
  provider: "openai",
  profile: "ores",
  description: "Ask ChatGPT",
  usage_hint: "<prompt>"
};

function fixture(text) {
  const responses = [];
  const logs = [];
  let routedPrompt;
  return {
    responses,
    logs,
    get routedPrompt() {
      return routedPrompt;
    },
    dependencies: {
      definition,
      command: {
        command: definition.command,
        text,
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
      logger: {
        info(event, payload) {
          logs.push({ level: "info", event, payload });
        },
        warn() {},
        error(event, payload) {
          logs.push({ level: "error", event, payload });
        }
      },
      router: {
        async run({ prompt }) {
          routedPrompt = prompt;
          return { text: `provider saw: ${prompt}`, model: "gpt-test", provider: "openai" };
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

test("redacts credential-like command text before provider processing", async () => {
  const data = fixture(`review token ${syntheticToken} without exposing it`);
  await handleSlashCommand(data.dependencies);

  assert.doesNotMatch(data.routedPrompt, new RegExp(syntheticToken));
  assert.match(data.routedPrompt, /\[REDACTED_TOKEN\]/);
  assert.doesNotMatch(JSON.stringify(data.responses), new RegExp(syntheticToken));
  assert.match(data.responses.at(-1).text, /Credential-like text was redacted/);
  assert.equal(data.logs.at(-1).payload.promptRedacted, true);
});

test("does not add a redaction notice for ordinary command text", async () => {
  const data = fixture("review the deployment plan");
  await handleSlashCommand(data.dependencies);

  assert.equal(data.routedPrompt, "review the deployment plan");
  assert.doesNotMatch(data.responses.at(-1).text, /Credential-like text was redacted/);
  assert.equal(data.logs.at(-1).payload.promptRedacted, false);
});
