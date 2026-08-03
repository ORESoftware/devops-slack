import { redactSensitiveText } from "../security/redaction.js";

const maximumHistoryPageSize = 15;
const allowedSubtypes = new Set([undefined, "thread_broadcast"]);

function assertInteger(name, value, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
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
 * coalescing. The class deliberately omits authors and strips Slack identifiers before returning
 * any content that may be sent to an external model provider.
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
   * @param {{ client: any, channelId?: string }} options
   * @returns {Promise<string[]>}
   */
  async get({ client, channelId }) {
    if (!this.enabled || !channelId) return [];

    const cached = this.cache.get(channelId);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(channelId);
      this.cache.set(channelId, cached);
      return [...cached.messages];
    }

    const active = this.inFlight.get(channelId);
    if (active) return [...(await active)];

    const request = this.#fetch(client, channelId);
    this.inFlight.set(channelId, request);
    try {
      return [...(await request)];
    } finally {
      if (this.inFlight.get(channelId) === request) this.inFlight.delete(channelId);
    }
  }

  async #fetch(client, channelId) {
    if (typeof client?.conversations?.history !== "function") {
      throw new TypeError("Slack client does not expose conversations.history");
    }

    const result = await client.conversations.history({
      channel: channelId,
      limit: Math.min(maximumHistoryPageSize, Math.max(this.messageCount, this.messageCount * 3))
    });
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const perMessageLimit = Math.max(1, Math.floor(this.maxChars / this.messageCount));
    const selected = messages
      .filter(isEligibleMessage)
      .map((message) => sanitizeSlackContextText(message.text))
      .filter(Boolean)
      .slice(0, this.messageCount)
      .reverse()
      .map((text) => truncate(text, perMessageLimit));

    this.cache.set(channelId, {
      expiresAt: this.now() + this.cacheTtlMs,
      messages: Object.freeze([...selected])
    });
    while (this.cache.size > this.maxEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return selected;
  }
}
