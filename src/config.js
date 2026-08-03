import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCommands, validateProfiles } from "./config-validation.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${relativePath}`, { cause: error });
  }
}

function readText(relativePath) {
  const text = readFileSync(resolve(rootDir, relativePath), "utf8").trim();
  if (!text) throw new Error(`${relativePath} must not be empty`);
  return text;
}

const parsedCommands = validateCommands(readJson("config/commands.json"));
const parsedProfiles = validateProfiles(readJson("config/profiles.json"));

for (const command of parsedCommands) {
  if (!parsedProfiles[command.profile]) {
    throw new Error(`Command ${command.command} references unknown profile ${command.profile}`);
  }
}

export const commandDefinitions = Object.freeze(
  parsedCommands.map((entry) => Object.freeze(entry))
);

export const profiles = Object.freeze(
  Object.fromEntries(
    Object.entries(parsedProfiles).map(([key, value]) => [
      key,
      Object.freeze({
        ...value,
        systemPrompt: readText(value.systemPromptFile)
      })
    ])
  )
);

export function integerEnv(
  name,
  fallback,
  { min = 0, max = Number.MAX_SAFE_INTEGER, env = process.env } = {}
) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function booleanEnv(name, fallback, { env = process.env } = {}) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim();
  if (/^(1|true|yes|on)$/i.test(normalized)) return true;
  if (/^(0|false|no|off)$/i.test(normalized)) return false;
  throw new Error(`${name} must be a boolean`);
}

export function enumEnv(name, fallback, allowedValues, { env = process.env } = {}) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

export function csvEnv(name, { env = process.env } = {}) {
  return new Set(
    (env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function loadRuntimeConfig(env = process.env) {
  return Object.freeze({
    socketMode: booleanEnv("SLACK_SOCKET_MODE", true, { env }),
    allowPublicResponses: booleanEnv("ALLOW_PUBLIC_RESPONSES", true, { env }),
    includeSlackIdentifiersInPrompt: booleanEnv(
      "INCLUDE_SLACK_IDENTIFIERS_IN_PROMPT",
      false,
      { env }
    ),
    slackContextMessageCount: integerEnv("SLACK_CONTEXT_MESSAGE_COUNT", 5, {
      min: 0,
      max: 15,
      env
    }),
    slackContextCacheTtlMs: integerEnv("SLACK_CONTEXT_CACHE_TTL_MS", 60_000, {
      min: 1_000,
      max: 3_600_000,
      env
    }),
    slackContextMaxChars: integerEnv("SLACK_CONTEXT_MAX_CHARS", 6_000, {
      min: 256,
      max: 50_000,
      env
    }),
    slackContextCacheMaxEntries: integerEnv("SLACK_CONTEXT_CACHE_MAX_ENTRIES", 500, {
      min: 1,
      max: 10_000,
      env
    }),
    slackContextMaxPages: integerEnv("SLACK_CONTEXT_MAX_PAGES", 3, {
      min: 1,
      max: 10,
      env
    }),
    slackContextFetchTimeoutMs: integerEnv("SLACK_CONTEXT_FETCH_TIMEOUT_MS", 10_000, {
      min: 100,
      max: 60_000,
      env
    }),
    timeoutMs: integerEnv("AGENT_TIMEOUT_MS", 120_000, { min: 1_000, max: 600_000, env }),
    maxOutputTokens: integerEnv("MAX_OUTPUT_TOKENS", 3_000, { min: 64, max: 32_000, env }),
    maxPromptChars: integerEnv("MAX_PROMPT_CHARS", 12_000, { min: 1, max: 100_000, env }),
    maxResponseChars: integerEnv("MAX_RESPONSE_CHARS", 16_000, { min: 500, max: 35_000, env }),
    maxConcurrentRequests: integerEnv("MAX_CONCURRENT_REQUESTS", 4, { min: 1, max: 100, env }),
    maxQueuedRequests: integerEnv("MAX_QUEUED_REQUESTS", 20, { min: 0, max: 1_000, env }),
    maxConcurrentRequestsPerUser: integerEnv("MAX_CONCURRENT_REQUESTS_PER_USER", 2, {
      min: 1,
      max: 100,
      env
    }),
    maxQueuedRequestsPerUser: integerEnv("MAX_QUEUED_REQUESTS_PER_USER", 4, {
      min: 0,
      max: 100,
      env
    }),
    maxQueueWaitMs: integerEnv("MAX_QUEUE_WAIT_MS", 30_000, {
      min: 100,
      max: 300_000,
      env
    }),
    shutdownGraceMs: integerEnv("SHUTDOWN_GRACE_MS", 30_000, {
      min: 1_000,
      max: 300_000,
      env
    }),
    requestDedupeTtlMs: integerEnv("REQUEST_DEDUPE_TTL_MS", 300_000, {
      min: 1_000,
      max: 3_600_000,
      env
    }),
    requestDedupeMaxEntries: integerEnv("REQUEST_DEDUPE_MAX_ENTRIES", 10_000, {
      min: 1,
      max: 100_000,
      env
    }),
    logLevel: enumEnv("LOG_LEVEL", "info", ["debug", "info", "warn", "error"], { env }),
    port: integerEnv("PORT", 3_000, { min: 1, max: 65_535, env }),
    allowedUserIds: csvEnv("ALLOWED_SLACK_USER_IDS", { env }),
    allowedChannelIds: csvEnv("ALLOWED_SLACK_CHANNEL_IDS", { env }),
    allowedModels: Object.freeze({
      openai: csvEnv("OPENAI_ALLOWED_MODELS", { env }),
      anthropic: csvEnv("ANTHROPIC_ALLOWED_MODELS", { env })
    })
  });
}

export const runtimeConfig = loadRuntimeConfig();
