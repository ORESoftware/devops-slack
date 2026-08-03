import { redactSensitiveText } from "../security/redaction.js";

const maximumHistoryPageSize = 15;
const maximumSlackIdentifierLength = 128;
const allowedSubtypes = new Set([undefined, "thread_broadcast"]);

function assertInteger(name, value, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function optionalSlackIdentifier(name, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximumSlackIdentifierLength) {
    throw new TypeError(`${name} must be a string of at most ${maximumSlackIdentifierLength} characters`);
  }
  return value;
}

function contextKey({ enterpriseId, teamId, channelId }) {
  if (typeof channelId !== "string" || channelId.length === 0 || channelId.length > maximumSlackIdentifierLength) {
    throw new TypeError(
      `channelId must be a non-empty string of at most ${maximumSlackIdentifierLength} characters`
    );
  }

  return JSON.stringify([
    optionalSlackIdentifier("enterpriseId", enterpriseId),
    optionalSlackIdentifier("teamId", teamId),
    channelId
  ]);
}

/**
 * Converts Slack mrkdwn references into provider-safe, identifier-free text.
 *
 * @param {unknown} value
 */
export function sanitizeSlackContextText(value) {
  const redacted = redactSensitiveText(value);
  if (!redacted) return "";

  return String(redacted)
    .replace(
      /<!subteam\^[^>|]+(?:\|@?([^>]+))?>/gi,
      (_match, label) => `@${label || "group"}`
    )
    .replace(/<@[^>|]+(?:\|@?([^>]+))?>/gi, (_match, label) => `@${label || "user"}`)
    .replace(/<#[^>|]+(?:\|#?([^>]+))?>/gi, (_match, label) => `#${label || "channel"}`)
    .replace(/<!(channel|here|everyone)(?:\^[^>]*)?>/gi, (_match, name) => `@${name}`)
    .replace(/<mailto:[^>|]+\|([^>]+)>/gi, "$1")
    .replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/gi, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/gi, "$1")
    .replace(/\b[A-Z][A-Z0-9]{8,}\b/g, "[slack-id]")
    .replace(/\s+/g, " ")
    .trim();
}

function isEligibleMessage(message) {
  return (
    message &&
    typeof message === "object" &&
    typeof message.user === "string" &&
    !message.bot_id &&
    allowedSubtypes.has(message.subtype) &&
    typeof message.text === "string" &&
    message.text.trim().length > 0
  );
}

function truncate(value, maximum) {
  if (value.length <= maximum) return value;
  if (maximum <= 1) return "…".slice(0, maximum);
  return `${value.slice(0, maximum - 1)}…`;
}

/**
 * Loads recent human-authored channel messages with a bounded TTL/LRU cache and in-flight request
 * coalescing. Cache and in-flight keys include enterprise, workspace, and channel identity so a
 * multi-workspace process cannot reuse one workspace's context in another. The class deliberately
 * omits authors and strips Slack identifiers before returning content to an external provider.
 */
export class SlackChannelContext {
  constructor({
    messageCount = 5,
    cacheTtlMs = 60_000,
    maxChars = 6_000,
    maxEntries = 500,
    now = Date.now
  } = {}) {
    assertInteger("messageCount", messageCount, { min: 0, max: 15 });
    assertInteger("cacheTtlMs", cacheTtlMs, { min: 1_000, max: 3_600_000 });
    assertInteger("maxChars", maxChars, { min: 256, max: 50_000 });
    assertInteger("maxEntries", maxEntries, { min: 1, max: 10_000 });
    if (typeof now !== "function") throw new TypeError("now must be a function");

    this.messageCount = messageCount;
    this.cacheTtlMs = cacheTtlMs;
    this.maxChars = maxChars;
    this.maxEntries = maxEntries;
    this.now = now;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  get enabled() {
    return this.messageCount > 0;
  }

  /**
   * @param {{ client: any, enterpriseId?: string, teamId?: string, channelId?: string }} options
   * @returns {Promise<string[]>}
   */
  async get({ client, enterpriseId, teamId, channelId }) {
    if (!this.enabled || !channelId) return [];

    const key = contextKey({ enterpriseId, teamId, channelId });
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return [...cached.messages];
    }
    if (cached) this.cache.delete(key);

    const active = this.inFlight.get(key);
    if (active) return [...(await active)];

    const request = this.#fetch(client, channelId, key);
    this.inFlight.set(key, request);
    try {
      return [...(await request)];
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  async #fetch(client, channelId, key) {
    if (typeof client?.conversations?.history !== "function") {
      throw new TypeError("Slack client does not expose conversations.history");
    }

    const result = await client.conversations.history({
      channel: channelId,
      limit: Math.min(maximumHistoryPageSize, Math.max(this.messageCount, this.messageCount * 3))
    });
    if (!result || typeof result !== "object") {
      throw new TypeError("Slack conversations.history returned an invalid response");
    }
    if (result.ok === false) {
      const slackError =
        typeof result.error === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(result.error)
          ? result.error
          : "unknown_error";
      throw Object.assign(new Error(`Slack conversations.history failed: ${slackError}`), {
        code: "SLACK_HISTORY_FAILED"
      });
    }
    if (!Array.isArray(result.messages)) {
      throw new TypeError("Slack conversations.history did not return a messages array");
    }

    const perMessageLimit = Math.max(1, Math.floor(this.maxChars / this.messageCount));
    const selected = result.messages
      .filter(isEligibleMessage)
      .map((message) => sanitizeSlackContextText(message.text))
      .filter(Boolean)
      .slice(0, this.messageCount)
      .reverse()
      .map((text) => truncate(text, perMessageLimit));

    this.cache.set(key, {
      expiresAt: this.now() + this.cacheTtlMs,
      messages: Object.freeze([...selected])
    });
    while (this.cache.size > this.maxEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return selected;
  }
}
