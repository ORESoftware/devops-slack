const commandPattern = /^\/[a-z0-9][a-z0-9-]{0,30}$/;
const providerNames = new Set(["openai", "anthropic"]);
const profileFilePattern = /^[A-Za-z0-9._/-]+$/;

/** @returns {never} */
function fail(path, message) {
  throw new Error(`${path} ${message}`);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, any>}
 */
function expectObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ min?: number, max?: number, pattern?: RegExp }} [options]
 * @returns {string}
 */
function expectString(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER, pattern } = {}) {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length < min || value.length > max) {
    fail(path, `must contain between ${min} and ${max} characters`);
  }
  if (pattern && !pattern.test(value)) fail(path, "has an invalid format");
  return value;
}

function rejectUnknownKeys(value, path, allowedKeys) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) fail(path, `contains unknown keys: ${unknown.join(", ")}`);
}

export function validateCommands(value) {
  if (!Array.isArray(value)) throw new Error("config/commands.json must contain an array");
  if (value.length === 0 || value.length > 50) {
    throw new Error("config/commands.json must contain between 1 and 50 slash commands");
  }

  const seen = new Set();
  return value.map((rawEntry, index) => {
    const path = `commands[${index}]`;
    const entry = expectObject(rawEntry, path);
    rejectUnknownKeys(
      entry,
      path,
      new Set(["command", "provider", "profile", "description", "usage_hint"])
    );

    const command = expectString(entry.command, `${path}.command`, {
      min: 2,
      max: 32,
      pattern: commandPattern
    });
    if (seen.has(command)) fail(`${path}.command`, `duplicates ${command}`);
    seen.add(command);

    const provider = expectString(entry.provider, `${path}.provider`, { min: 1, max: 32 });
    if (!providerNames.has(provider)) {
      fail(`${path}.provider`, `must be one of: ${[...providerNames].join(", ")}`);
    }

    return {
      command,
      provider,
      profile: expectString(entry.profile, `${path}.profile`, { min: 1, max: 64 }),
      description: expectString(entry.description, `${path}.description`, { min: 1, max: 2_000 }),
      usage_hint: expectString(entry.usage_hint, `${path}.usage_hint`, { max: 1_000 })
    };
  });
}

export function validateProfiles(value) {
  const record = expectObject(value, "config/profiles.json");
  const entries = Object.entries(record);
  if (entries.length === 0) {
    throw new Error("config/profiles.json must define at least one profile");
  }

  return Object.fromEntries(
    entries.map(([name, rawProfile]) => {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
        fail(`profiles.${name}`, "has an invalid profile name");
      }
      const path = `profiles.${name}`;
      const profile = expectObject(rawProfile, path);
      rejectUnknownKeys(profile, path, new Set(["label", "systemPromptFile"]));
      const systemPromptFile = expectString(profile.systemPromptFile, `${path}.systemPromptFile`, {
        min: 1,
        max: 256,
        pattern: profileFilePattern
      });
      if (systemPromptFile.startsWith("/") || systemPromptFile.split("/").includes("..")) {
        fail(`${path}.systemPromptFile`, "must stay within the repository");
      }
      return [
        name,
        {
          label: expectString(profile.label, `${path}.label`, { min: 1, max: 80 }),
          systemPromptFile
        }
      ];
    })
  );
}
