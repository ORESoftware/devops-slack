import assert from "node:assert/strict";
import test from "node:test";
import { handleSlashCommand, registerCommands, safeErrorMessage } from "../src/register-commands.js";

const fakeGitHubToken = `gh${"p"}_${"a".repeat(36)}`;

const definition = {
  command: "/ores-chatgpt",
  provider: "openai",
  profile: "ores",
  description: "Ask ChatGPT using the ORES engineering profile",
  usage_hint: "[--public] [--model MODEL] <prompt>"
};

function fixture(text) {
  const responses = [];
  const publicPosts = [];
  const ephemeralPosts = [];
  const logs = [];
  return {
    responses,
    publicPosts,
    ephemeralPosts,
    logs,
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
          postMessage: async (payload) => {
            publicPosts.push(payload);
            return { ok: true, ts: publicPosts.length === 1 ? "100.1" : `100.${publicPosts.length}` };
          },
          postEphemeral: async (payload) => {
            ephemeralPosts.push(payload);
            return { ok: true };
          }
        }
      },
      logger: {
        info(event, payload) {
          logs.push({ level: "info", event, payload });
        },
        warn(event, payload) {
          logs.push({ level: "warn", event, payload });
        },
        error(event, payload) {
          logs.push({ level: "error", event, payload });
        }
      },
      router: {
        run: async ({ model }) => ({
          text: "done",
          model: model || "gpt-5.2",
          provider: "openai"
        })
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

test("empty prompt returns help without invoking the provider", async () => {
  const data = fixture("");
  let invoked = false;
  data.dependencies.router.run = async () => {
    invoked = true;
    throw new Error("should not run");
  };
  await handleSlashCommand(data.dependencies);
  assert.equal(invoked, false);
  assert.equal(data.responses.length, 1);
  assert.match(data.responses[0].text, /Usage:/);
});

test("public output posts to the channel and clears the working message", async () => {
  const data = fixture("--public inspect this");
  await handleSlashCommand(data.dependencies);
  assert.equal(data.responses[0].text, "Working on /ores-chatgpt…");
  assert.equal(data.publicPosts.length, 1);
  assert.match(data.publicPosts[0].text, /ORES · ChatGPT/);
  assert.equal(data.publicPosts[0].unfurl_links, false);
  assert.equal(data.publicPosts[0].unfurl_media, false);
  assert.equal(data.responses.at(-1).replace_original, true);
  assert.match(data.responses.at(-1).text, /Posted/);
});

test("ephemeral output replaces the working message", async () => {
  const data = fixture("inspect this");
  await handleSlashCommand(data.dependencies);
  assert.equal(data.publicPosts.length, 0);
  assert.equal(data.responses.length, 2);
  assert.equal(data.responses[1].replace_original, true);
  assert.match(data.responses[1].text, /done/);
});

test("generated Slack mention markup is neutralized before posting", async () => {
  const data = fixture("--public inspect this");
  data.dependencies.router.run = async () => ({
    text: "Notify <!channel>, <!here>, <!subteam^S123|@ops>, <@U123>, and <#C123|general>.",
    model: "gpt-5.2",
    provider: "openai"
  });

  await handleSlashCommand(data.dependencies);
  const posted = data.publicPosts[0].text;
  assert.doesNotMatch(posted, /<!(?:channel|here|subteam)|<@U123>|<#C123/);
  assert.match(posted, /@\u200Bchannel/);
  assert.match(posted, /@\u200Bops/);
  assert.match(posted, /@\u200Buser/);
  assert.match(posted, /#\u200Bchannel/);
});

test("public responses and model overrides can be restricted", async () => {
  const publicData = fixture("--public inspect this");
  publicData.dependencies.runtimeConfig.allowPublicResponses = false;
  await handleSlashCommand(publicData.dependencies);
  assert.match(publicData.responses[0].text, /Public responses are disabled/);

  const modelData = fixture("--model gpt-denied inspect this");
  modelData.dependencies.runtimeConfig.allowedModels.openai = new Set(["gpt-approved"]);
  await handleSlashCommand(modelData.dependencies);
  assert.match(modelData.responses[0].text, /not allowed for ChatGPT/);
});

test("capacity and timeout errors are sanitized consistently", () => {
  assert.equal(
    safeErrorMessage(Object.assign(new Error("full"), { code: "QUEUE_FULL" })),
    "The app is at capacity. Try again shortly."
  );
  assert.equal(
    safeErrorMessage(Object.assign(new Error("stale"), { code: "QUEUE_TIMEOUT" })),
    "The app is at capacity. Try again shortly."
  );
  assert.equal(
    safeErrorMessage(Object.assign(new Error("request failed"), { code: "ETIMEDOUT" })),
    "The AI request timed out."
  );
  assert.equal(
    safeErrorMessage(new Error("secret sk-test-value")),
    "The command failed. Check the app logs for the internal error."
  );
});

test("structured error logs redact provider and environment credentials", async () => {
  const data = fixture("inspect this");
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-environment-secret-value";
  data.dependencies.router.run = async () => {
    throw new Error(
      "Bearer private-bearer-token and sk-inline-secret-value and xapp-inline-secret-value " +
        `and ${fakeGitHubToken} and sk-environment-secret-value`
    );
  };

  try {
    await handleSlashCommand(data.dependencies);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }

  const serialized = JSON.stringify(data.logs.at(-1));
  assert.doesNotMatch(
    serialized,
    /private-bearer-token|sk-inline-secret-value|xapp-inline-secret-value|ghp_|sk-environment-secret-value/
  );
  assert.match(serialized, /REDACTED/);
});

test("registered listeners acknowledge before long-running provider work completes", async () => {
  const handlers = new Map();
  const app = {
    command(name, handler) {
      handlers.set(name, handler);
    }
  };
  const data = fixture("inspect this");
  /** @type {() => void} */
  let finishProvider = () => {
    throw new Error("provider resolver was not initialized");
  };
  data.dependencies.router.run = () =>
    new Promise((resolve) => {
      finishProvider = () => resolve({ text: "done", model: "gpt-5.2", provider: "openai" });
    });

  registerCommands({ app, commandDefinitions: [definition], ...data.dependencies });
  let acknowledged = false;
  await handlers.get(definition.command)({
    command: data.dependencies.command,
    ack: async () => {
      acknowledged = true;
    },
    respond: data.dependencies.respond,
    client: data.dependencies.client,
    logger: data.dependencies.logger
  });

  assert.equal(acknowledged, true);
  assert.equal(data.responses[0].text, "Working on /ores-chatgpt…");
  finishProvider();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(data.responses.at(-1).text, /done/);
});

test("registered listeners reject new commands after shutdown begins", async () => {
  const handlers = new Map();
  const app = {
    command(name, handler) {
      handlers.set(name, handler);
    }
  };
  const data = fixture("inspect this");
  const runtime = registerCommands({
    app,
    commandDefinitions: [definition],
    ...data.dependencies
  });
  runtime.stopAccepting();

  let acknowledged = false;
  await handlers.get(definition.command)({
    command: data.dependencies.command,
    ack: async () => {
      acknowledged = true;
    },
    respond: data.dependencies.respond,
    client: data.dependencies.client,
    logger: data.dependencies.logger
  });

  assert.equal(acknowledged, true);
  assert.equal(data.responses.length, 1);
  assert.match(data.responses[0].text, /not accepting new commands/);
  assert.equal(runtime.active, 0);
});

test("queue saturation replaces the working message with a safe retry response", async () => {
  const data = fixture("inspect this");
  data.dependencies.semaphore = {
    use: async () => {
      throw Object.assign(new Error("internal queue detail"), { code: "QUEUE_FULL" });
    }
  };

  await handleSlashCommand(data.dependencies);
  assert.equal(data.responses[0].text, "Working on /ores-chatgpt…");
  assert.equal(data.responses.at(-1).replace_original, true);
  assert.equal(data.responses.at(-1).text, "The app is at capacity. Try again shortly.");
});

test("per-user admission wraps the global provider semaphore", async () => {
  const data = fixture("inspect this");
  let observedKey;
  let userLimiterCalls = 0;
  data.dependencies.userSemaphore = {
    use: async (key, callback) => {
      observedKey = key;
      userLimiterCalls += 1;
      return callback();
    }
  };

  await handleSlashCommand(data.dependencies);
  assert.equal(observedKey, "T1:U1");
  assert.equal(userLimiterCalls, 1);
  assert.match(data.responses.at(-1).text, /done/);
});

test("registered listeners deduplicate Slack retries by trigger ID", async () => {
  const handlers = new Map();
  const app = {
    command(name, handler) {
      handlers.set(name, handler);
    }
  };
  const data = fixture("inspect this");
  let providerCalls = 0;
  /** @type {() => void} */
  let finishProvider = () => {
    throw new Error("provider resolver was not initialized");
  };
  data.dependencies.router.run = () => {
    providerCalls += 1;
    return new Promise((resolve) => {
      finishProvider = () => resolve({ text: "done", model: "gpt-5.6", provider: "openai" });
    });
  };
  registerCommands({ app, commandDefinitions: [definition], ...data.dependencies });

  const firstResponses = [];
  const secondResponses = [];
  const command = { ...data.dependencies.command, trigger_id: "1337.abc" };
  const common = {
    command,
    ack: async () => {},
    client: data.dependencies.client,
    logger: data.dependencies.logger
  };

  await handlers.get(definition.command)({
    ...common,
    respond: async (payload) => firstResponses.push(payload)
  });
  await handlers.get(definition.command)({
    ...common,
    respond: async (payload) => secondResponses.push(payload)
  });

  assert.equal(providerCalls, 1);
  assert.equal(firstResponses[0].text, "Working on /ores-chatgpt…");
  assert.equal(secondResponses.length, 1);
  assert.match(secondResponses[0].text, /already accepted/);

  finishProvider();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(firstResponses.at(-1).text, /done/);
});

test("passes bounded recent channel context to the agent router", async () => {
  const data = fixture("summarize this");
  let routed;
  data.dependencies.channelContext = {
    enabled: true,
    async get({ channelId }) {
      assert.equal(channelId, "C1");
      return ["first message", "second message"];
    }
  };
  data.dependencies.router.run = async (payload) => {
    routed = payload;
    return { text: "done", model: "gpt-5.6", provider: "openai" };
  };

  await handleSlashCommand(data.dependencies);

  assert.deepEqual(routed.recentMessages, ["first message", "second message"]);
  assert.equal(routed.prompt, "summarize this");
  assert.equal(data.logs.at(-1).payload.contextMessages, 2);
});

test("continues without channel context when Slack history lookup fails", async () => {
  const data = fixture("summarize this");
  let routed;
  data.dependencies.channelContext = {
    enabled: true,
    async get() {
      throw new Error(`history failed with ${fakeGitHubToken}`);
    }
  };
  data.dependencies.router.run = async (payload) => {
    routed = payload;
    return { text: "done", model: "gpt-5.6", provider: "openai" };
  };

  await handleSlashCommand(data.dependencies);

  assert.deepEqual(routed.recentMessages, []);
  assert.match(data.responses.at(-1).text, /done/);
  const warning = data.logs.find((entry) => entry.event === "slack_context_unavailable");
  assert.equal(warning.level, "warn");
  assert.doesNotMatch(JSON.stringify(warning), /ghp_/);
});

test("rejects disallowed users before parsing or invoking providers", async () => {
  const data = fixture("--unknown should never parse");
  data.dependencies.runtimeConfig.allowedUserIds = new Set(["U2"]);
  let invoked = false;
  data.dependencies.router.run = async () => {
    invoked = true;
    throw new Error("must not run");
  };

  await handleSlashCommand(data.dependencies);

  assert.equal(invoked, false);
  assert.equal(data.responses.length, 1);
  assert.match(data.responses[0].text, /not allowed/);
});

test("returns contextual help for parse errors and explicit help", async () => {
  const malformed = fixture("--model");
  await handleSlashCommand(malformed.dependencies);
  assert.match(malformed.responses[0].text, /--model requires a value/);
  assert.match(malformed.responses[0].text, /Usage:/);

  const help = fixture("--help ignored prompt");
  await handleSlashCommand(help.dependencies);
  assert.equal(help.responses.length, 1);
  assert.match(help.responses[0].text, /Options:/);
});

test("rejects an oversized prompt without starting provider work", async () => {
  const data = fixture("123456");
  data.dependencies.runtimeConfig.maxPromptChars = 5;
  let invoked = false;
  data.dependencies.router.run = async () => {
    invoked = true;
    throw new Error("must not run");
  };

  await handleSlashCommand(data.dependencies);

  assert.equal(invoked, false);
  assert.match(data.responses[0].text, /Prompt is too long \(6 characters; max 5\)/);
});

test("falls back to the response URL when extra ephemeral chunks cannot use chat.postEphemeral", async () => {
  const data = fixture("make a long response");
  data.dependencies.router.run = async () => ({
    text: "x".repeat(8_500),
    model: "gpt-5.6",
    provider: "openai"
  });
  data.dependencies.client.chat.postEphemeral = async () => {
    throw new Error("ephemeral API unavailable");
  };

  await handleSlashCommand(data.dependencies);

  assert.equal(data.responses[1].replace_original, true);
  assert.ok(data.responses.length >= 4);
  assert.ok(data.responses.slice(2).every((response) => response.response_type === "ephemeral"));
});

test("maps provider rate-limit and credential failures to safe user messages", () => {
  assert.equal(
    safeErrorMessage(new Error("429 Too Many Requests")),
    "The provider rate limit was reached. Try again shortly."
  );
  assert.equal(
    safeErrorMessage(new Error("401 invalid API key")),
    "The provider rejected its API credentials."
  );
  assert.equal(
    safeErrorMessage(new Error("OPENAI_API_KEY is not configured")),
    "OPENAI_API_KEY is not configured"
  );
});
