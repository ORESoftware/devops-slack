import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

function trimmedEnv(name, env) {
  const value = env[name]?.trim();
  return value || undefined;
}

export function providerBaseUrlEnv(name, env = process.env) {
  const raw = trimmedEnv(name, env);
  if (!raw) return undefined;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  if (url.hash) throw new Error(`${name} must not contain a URL fragment`);
  return url.toString();
}

export function createProviders({ timeoutMs, maxOutputTokens }, env = process.env) {
  return {
    openai: new OpenAIProvider({
      apiKey: trimmedEnv("OPENAI_API_KEY", env),
      baseURL: providerBaseUrlEnv("OPENAI_BASE_URL", env),
      defaultModel: trimmedEnv("OPENAI_MODEL", env) || "gpt-5.6",
      timeoutMs,
      maxOutputTokens
    }),
    anthropic: new AnthropicProvider({
      apiKey: trimmedEnv("ANTHROPIC_API_KEY", env),
      baseURL: providerBaseUrlEnv("ANTHROPIC_BASE_URL", env),
      defaultModel: trimmedEnv("ANTHROPIC_MODEL", env) || "claude-sonnet-5",
      timeoutMs,
      maxOutputTokens
    })
  };
}
