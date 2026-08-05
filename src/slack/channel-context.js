import { redactSensitiveText } from "../security/redaction.js";

const maximumHistoryPageSize = 45;
const maximumSlackIdentifierLength = 128;
const maximumCursorLength = 512;
const allowedSubtypes = new Set([undefined, "thread_broadcast"]);

function assertInteger(name, value, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

function optionalSlackIdentifier(name, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximumSlackIdentifierLength) {
    throw new TypeError(`${name} must be a string of at most ${maximumSlackIdentifierLength} characters`);
  }
  return value;
}

function contextKey({ enterpriseId, teamId, channelId }) {
  if (
    typeof channelId !== "string" ||
    channelId.length === 0 ||
    channelId.length > maximumSlackIdentifierLength
  ) {
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

function continuationCursor(result) {
  if (result.has_more !== undefined && typeof result.has_more !== "boolean") {
    throw new TypeError("Slack conversations.history returned a non-boolean has_more value");
  }

  const metadata = result.response_metadata;
  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new TypeError("Slack conversations.history returned invalid response_metadata");
    }
  }

  const rawCursor = metadata?.next_cursor;
  if (rawCursor === undefined || rawCursor === null || rawCursor === "") {
    if (result.has_more === true) {
      throw new TypeError("Slack conversations.history indicated more pages without a cursor");
    }
    return null;
  }
  if (typeof rawCursor !== "string") {
    throw new TypeError("Slack conversations.history returned a non-string next_cursor");
  }

  const cursor = rawCursor.trim();
  if (
    cursor.length === 0 ||
    cursor.length > maximumCursorLength ||
    !/^[\x21-\x7E]+$/.test(cursor)
  ) {
    throw new TypeError(
      `Slack conversations.history next_cursor must be printable and at most ${maximumCursorLength} characters`
    );
  }
  return cursor;
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
 * Loads recent human-authored channel messages with bounded pagination, a per-page deadline, a
 * bounded TTL/LRU cache, and in-flight request coalescing. Cache and in-flight keys include
 * enterprise, workspace, and channel identity so a multi-workspace process cannot reuse one
 * workspace's context in another. The class deliberately omits authors and strips Slack identifiers
 * before returning content to an external provider.
 */
export class SlackChannelContext {
  constructor({
    messageCount = 5,
    cacheTtlMs = 60_000,
    maxChars = 6_000,
    maxEntries = 500,
    maxPages = 3,
    fetchTimeoutMs = 10_000,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = {}) {
    assertInteger("messageCount", messageCount, { min: 0, max: 15 });
    assertInteger("cacheTtlMs", cacheTtlMs, { min: 1_000, max: 3_600_000 });
    assertInteger("maxChars", maxChars, { min: 256, max: 50_000 });
    assertInteger("maxEntries", maxEntries, { min: 1, max: 10_000 });
    assertInteger("maxPages", maxPages, { min: 1, max: 10 });
    assertInteger("fetchTimeoutMs", fetchTimeoutMs, { min: 1, max: 60_000 });
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof setTimer !== "function") throw new TypeError("setTimer must be a function");
    if (typeof clearTimer !== "function") throw new TypeError("clearTimer must be a function");

    this.messageCount = messageCount;
    this.cacheTtlMs = cacheTtlMs;
    this.maxChars = maxChars;
    this.maxEntries = maxEntries;
    this.maxPages = maxPages;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
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

  async #fetchHistoryPage(client, payload) {
    let timerHandle;
    let historyRequest;
    try {
      historyRequest = Promise.resolve(client.conversations.history(payload));
    } catch (error) {
      historyRequest = Promise.reject(error);
    }
    const timeout = new Promise((_, reject) => {
      timerHandle = this.setTimer(() => {
        reject(
          codedError(
            `Slack conversations.history timed out after ${this.fetchTimeoutMs}ms`,
            "SLACK_HISTORY_TIMEOUT"
          )
        );
      }, this.fetchTimeoutMs);
    });

    try {
      return await Promise.race([historyRequest, timeout]);
    } finally {
      this.clearTimer(timerHandle);
    }
  }

  async #fetch(client, channelId, key) {
    if (typeof client?.conversations?.history !== "function") {
      throw new TypeError("Slack client does not expose conversations.history");
    }

    const selectedNewestFirst = [];
    const seenMessageIds = new Set();
    const seenCursors = new Set();
    const limit = Math.min(
      maximumHistoryPageSize,
      Math.max(this.messageCount, this.messageCount * 3)
    );
    let cursor = null;

    for (let page = 0; page < this.maxPages; page += 1) {
      const payload = { channel: channelId, limit };
      if (cursor) payload.cursor = cursor;

      const result = await this.#fetchHistoryPage(client, payload);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Slack conversations.history returned an invalid response");
      }
      if (result.ok === false) {
        const slackError =
          typeof result.error === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(result.error)
            ? result.error
            : "unknown_error";
        throw codedError(
          `Slack conversations.history failed: ${slackError}`,
          "SLACK_HISTORY_FAILED"
        );
      }
      if (!Array.isArray(result.messages)) {
        throw new TypeError("Slack conversations.history did not return a messages array");
      }

      for (const message of result.messages) {
        if (!isEligibleMessage(message)) continue;
        const messageId = typeof message.ts === "string" ? message.ts.trim() : "";
        if (messageId && seenMessageIds.has(messageId)) continue;

        const text = sanitizeSlackContextText(message.text);
        if (!text) continue;
        if (messageId) seenMessageIds.add(messageId);
        selectedNewestFirst.push(text);
        if (selectedNewestFirst.length >= this.messageCount) break;
      }

      if (selectedNewestFirst.length >= this.messageCount) break;
      const nextCursor = continuationCursor(result);
      if (!nextCursor) break;
      if (seenCursors.has(nextCursor)) {
        throw codedError(
          "Slack conversations.history returned a repeated pagination cursor",
          "SLACK_HISTORY_CURSOR_LOOP"
        );
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    const perMessageLimit = Math.max(1, Math.floor(this.maxChars / this.messageCount));
    const selected = selectedNewestFirst
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
