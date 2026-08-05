const tokenPatterns = [
  /\b(?:sk|xox[a-z]|xapp)-[A-Za-z0-9_-]{8,}\b/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi
];

/**
 * Removes common credential formats and configured process secrets from text before logging or
 * forwarding Slack context to an external model provider.
 *
 * @param {unknown} value
 * @returns {string | undefined | null}
 */
export function redactSensitiveText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "") return "";

  let redacted = String(value).replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED_TOKEN]");
  for (const pattern of tokenPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED_TOKEN]");
  }

  for (const [name, secret] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name) || !secret || secret.length < 8) continue;
    redacted = redacted.split(secret).join(`[REDACTED_${name}]`);
  }
  return redacted;
}

/** @param {unknown} value */
export function logScalar(value) {
  if (value === undefined || value === null) return value;
  return redactSensitiveText(String(value).slice(0, 500));
}

/** @param {unknown} error */
export function errorDetailsForLog(error) {
  if (!(error instanceof Error)) return { message: logScalar(error) };
  const details = /** @type {Error & { code?: unknown, status?: unknown }} */ (error);
  return {
    name: logScalar(details.name),
    message: logScalar(details.message),
    code: logScalar(details.code),
    status: logScalar(details.status),
    stack: redactSensitiveText(details.stack)?.slice(0, 4_000)
  };
}
