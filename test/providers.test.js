import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { createProviders, providerBaseUrlEnv } from "../src/providers/index.js";
import { OpenAIProvider } from "../src/providers/openai.js";

test("OpenAI provider sends bounded non-stored Responses API requests", async () => {
  let captured = /** @type {any} */ (undefined);
  const provider = new OpenAIProvider({
    apiKey: "sk-test-provider-key",
    defaultModel: "gpt-default",
    timeoutMs: 1_000,
    maxOutputTokens: 321,
    client: {
      responses: {
        async create(payload, options) {
          captured = { payload, options };
          return { output_text: "  response text  ", model: "gpt-returned" };
        }
      }
    }
  });

  assert.deepEqual(await provider.generate({ prompt: "hello", systemPrompt: "system", model: "gpt-override" }), {
    text: "response text",
    model: "gpt-returned",
    provider: "openai"
  });
  assert.deepEqual(captured.payload, {
    model: "gpt-override",
    instructions: "system",
    input: "hello",
    max_output_tokens: 321,
    store: false
  });
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.options.signal.aborted, false);
});

test("Anthropic provider sends bounded Messages API requests and joins text blocks", async () => {
  let captured = /** @type {any} */ (undefined);
  const provider = new AnthropicProvider({
    apiKey: "sk-ant-test-provider-key",
    defaultModel: "claude-default",
    timeoutMs: 1_000,
    maxOutputTokens: 654,
    client: {
      messages: {
        async create(payload, options) {
          captured = { payload, options };
          return {
            model: "claude-returned",
            content: [
              { type: "text", text: " first " },
              { type: "tool_use", id: "ignored" },
              { type: "text", text: "second" }
            ]
          };
        }
      }
    }
  });

  assert.deepEqual(await provider.generate({ prompt: "hello", systemPrompt: "system" }), {
    text: "first \nsecond",
    model: "claude-returned",
    provider: "anthropic"
  });
  assert.deepEqual(captured.payload, {
    model: "claude-default",
    max_tokens: 654,
    system: "system",
    messages: [{ role: "user", content: "hello" }]
  });
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.options.signal.aborted, false);
});

test("providers reject missing credentials and empty responses", async () => {
  const missing = new OpenAIProvider({
    apiKey: "",
    defaultModel: "gpt-default",
    timeoutMs: 1_000,
    maxOutputTokens: 10,
    client: { responses: { create: async () => ({ output_text: "unused" }) } }
  });
  await assert.rejects(missing.generate({ prompt: "hello", systemPrompt: "system" }), /OPENAI_API_KEY/);

  const empty = new AnthropicProvider({
    apiKey: "configured",
    defaultModel: "claude-default",
    timeoutMs: 1_000,
    maxOutputTokens: 10,
    client: { messages: { create: async () => ({ content: [], model: "claude-default" }) } }
  });
  await assert.rejects(empty.generate({ prompt: "hello", systemPrompt: "system" }), /empty response/);
});

test("provider configuration trims secrets and validates custom base URLs", () => {
  const providers = createProviders(
    { timeoutMs: 1_000, maxOutputTokens: 128 },
    {
      OPENAI_API_KEY: "  openai-key  ",
      OPENAI_MODEL: "  gpt-test  ",
      OPENAI_BASE_URL: "https://proxy.example.test/v1",
      ANTHROPIC_API_KEY: "  anthropic-key  "
    }
  );
  assert.equal(providers.openai.apiKey, "openai-key");
  assert.equal(providers.openai.defaultModel, "gpt-test");
  assert.equal(providers.openai.baseURL, "https://proxy.example.test/v1");
  assert.equal(providers.anthropic.apiKey, "anthropic-key");

  assert.throws(
    () => providerBaseUrlEnv("OPENAI_BASE_URL", { OPENAI_BASE_URL: "file:///tmp/socket" }),
    /HTTP or HTTPS/
  );
  assert.throws(
    () =>
      providerBaseUrlEnv("OPENAI_BASE_URL", {
        OPENAI_BASE_URL: "https://user:pass@example.test/v1"
      }),
    /embedded credentials/
  );
  assert.throws(
    () => providerBaseUrlEnv("OPENAI_BASE_URL", { OPENAI_BASE_URL: "not a url" }),
    /valid HTTP or HTTPS URL/
  );
});

test("provider defaults use active current-generation models", () => {
  const providers = createProviders({ timeoutMs: 1_000, maxOutputTokens: 128 }, {});

  assert.equal(providers.openai.defaultModel, "gpt-5.6");
  assert.equal(providers.anthropic.defaultModel, "claude-sonnet-5");
});
