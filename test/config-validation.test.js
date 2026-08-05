import assert from "node:assert/strict";
import test from "node:test";
import { enumEnv, integerEnv, loadRuntimeConfig } from "../src/config.js";
import { validateCommands, validateProfiles } from "../src/config-validation.js";

const command = {
  command: "/test-command",
  provider: "openai",
  profile: "ores",
  description: "A test command",
  usage_hint: "<prompt>"
};

test("command validation rejects duplicates, unknown fields, and unsupported providers", () => {
  assert.throws(() => validateCommands([command, command]), /duplicates/);
  assert.throws(() => validateCommands([{ ...command, typo: true }]), /unknown keys/);
  assert.throws(() => validateCommands([{ ...command, provider: "other" }]), /must be one of/);
});

test("profile validation prevents repository traversal", () => {
  assert.throws(
    () => validateProfiles({ ores: { label: "ORES", systemPromptFile: "../secret.txt" } }),
    /must stay within the repository/
  );
});

test("integer environment parsing rejects partial and unsafe numbers", () => {
  assert.throws(() => integerEnv("COUNT", 1, { min: 1, max: 10, env: { COUNT: "2oops" } }), /must be an integer/);
  assert.throws(
    () => integerEnv("COUNT", 1, { min: 1, max: Number.MAX_SAFE_INTEGER, env: { COUNT: "9007199254740992" } }),
    /must be an integer/
  );
});

test("runtime config parses restrictions without mutating process.env", () => {
  const config = loadRuntimeConfig({
    SLACK_SOCKET_MODE: " false ",
    ALLOW_PUBLIC_RESPONSES: " no ",
    INCLUDE_SLACK_IDENTIFIERS_IN_PROMPT: " yes ",
    SLACK_CONTEXT_MESSAGE_COUNT: "7",
    SLACK_CONTEXT_CACHE_TTL_MS: "90000",
    SLACK_CONTEXT_MAX_CHARS: "7000",
    SLACK_CONTEXT_CACHE_MAX_ENTRIES: "700",
    PORT: "4444",
    MAX_QUEUED_REQUESTS: "7",
    MAX_CONCURRENT_REQUESTS_PER_USER: "2",
    MAX_QUEUED_REQUESTS_PER_USER: "3",
    MAX_QUEUE_WAIT_MS: "4500",
    SHUTDOWN_GRACE_MS: "15000",
    REQUEST_DEDUPE_TTL_MS: "60000",
    REQUEST_DEDUPE_MAX_ENTRIES: "500",
    LOG_LEVEL: " WARN ",
    OPENAI_ALLOWED_MODELS: "gpt-a,gpt-b",
    ALLOWED_SLACK_USER_IDS: "U1,U2"
  });
  assert.equal(config.socketMode, false);
  assert.equal(config.allowPublicResponses, false);
  assert.equal(config.includeSlackIdentifiersInPrompt, true);
  assert.equal(config.slackContextMessageCount, 7);
  assert.equal(config.slackContextCacheTtlMs, 90_000);
  assert.equal(config.slackContextMaxChars, 7_000);
  assert.equal(config.slackContextCacheMaxEntries, 700);
  assert.equal(config.port, 4444);
  assert.equal(config.maxQueuedRequests, 7);
  assert.equal(config.maxConcurrentRequestsPerUser, 2);
  assert.equal(config.maxQueuedRequestsPerUser, 3);
  assert.equal(config.maxQueueWaitMs, 4_500);
  assert.equal(config.shutdownGraceMs, 15_000);
  assert.equal(config.requestDedupeTtlMs, 60_000);
  assert.equal(config.requestDedupeMaxEntries, 500);
  assert.equal(config.logLevel, "warn");
  assert.deepEqual([...config.allowedModels.openai], ["gpt-a", "gpt-b"]);
  assert.deepEqual([...config.allowedUserIds], ["U1", "U2"]);
});

test("runtime config rejects unsafe queue, shutdown, and log settings", () => {
  assert.throws(() => loadRuntimeConfig({ MAX_QUEUED_REQUESTS: "-1" }), /MAX_QUEUED_REQUESTS/);
  assert.throws(
    () => loadRuntimeConfig({ MAX_CONCURRENT_REQUESTS_PER_USER: "0" }),
    /MAX_CONCURRENT_REQUESTS_PER_USER/
  );
  assert.throws(
    () => loadRuntimeConfig({ MAX_QUEUED_REQUESTS_PER_USER: "-1" }),
    /MAX_QUEUED_REQUESTS_PER_USER/
  );
  assert.throws(() => loadRuntimeConfig({ MAX_QUEUE_WAIT_MS: "99" }), /MAX_QUEUE_WAIT_MS/);
  assert.throws(() => loadRuntimeConfig({ SHUTDOWN_GRACE_MS: "999" }), /SHUTDOWN_GRACE_MS/);
  assert.throws(() => loadRuntimeConfig({ REQUEST_DEDUPE_TTL_MS: "999" }), /REQUEST_DEDUPE_TTL_MS/);
  assert.throws(
    () => loadRuntimeConfig({ REQUEST_DEDUPE_MAX_ENTRIES: "0" }),
    /REQUEST_DEDUPE_MAX_ENTRIES/
  );
  assert.throws(() => enumEnv("LOG_LEVEL", "info", ["info", "warn"], { env: { LOG_LEVEL: "trace" } }), /must be one of/);
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_MESSAGE_COUNT: "16" }),
    /SLACK_CONTEXT_MESSAGE_COUNT/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_CACHE_TTL_MS: "999" }),
    /SLACK_CONTEXT_CACHE_TTL_MS/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_MAX_CHARS: "255" }),
    /SLACK_CONTEXT_MAX_CHARS/
  );
  assert.throws(
    () => loadRuntimeConfig({ SLACK_CONTEXT_CACHE_MAX_ENTRIES: "0" }),
    /SLACK_CONTEXT_CACHE_MAX_ENTRIES/
  );
});

test("recent Slack context defaults to five messages and can be disabled", () => {
  const defaults = loadRuntimeConfig({});
  assert.equal(defaults.slackContextMessageCount, 5);
  assert.equal(defaults.slackContextCacheTtlMs, 60_000);
  assert.equal(defaults.slackContextMaxChars, 6_000);
  assert.equal(defaults.slackContextCacheMaxEntries, 500);

  assert.equal(
    loadRuntimeConfig({ SLACK_CONTEXT_MESSAGE_COUNT: "0" }).slackContextMessageCount,
    0
  );
});
