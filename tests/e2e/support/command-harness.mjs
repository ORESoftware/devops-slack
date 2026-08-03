import { AgentRouter } from "../../../src/agent-router.js";
import { commandDefinitions, profiles } from "../../../src/config.js";
import { KeyedSemaphore } from "../../../src/keyed-semaphore.js";
import { handleSlashCommand } from "../../../src/register-commands.js";
import { Semaphore } from "../../../src/semaphore.js";
import { SlackChannelContext } from "../../../src/slack/channel-context.js";

const baseRuntimeConfig = Object.freeze({
  allowPublicResponses: true,
  allowedUserIds: new Set(),
  allowedChannelIds: new Set(),
  allowedModels: Object.freeze({ openai: new Set(), anthropic: new Set() }),
  maxPromptChars: 12_000,
  maxResponseChars: 16_000
});

function createProvider(name, defaultModel) {
  return {
    async generate({ prompt, model, systemPrompt }) {
      if (prompt.includes("[e2e:error]")) {
        throw new Error("synthetic provider failure with secret sk-test-never-expose");
      }
      const delayMatch = prompt.match(/\[e2e:delay=(\d+)\]/);
      if (delayMatch) await new Promise((resolve) => setTimeout(resolve, Number(delayMatch[1])));
      const profileLine = systemPrompt.split("\n", 1)[0].trim();
      const body = prompt.includes("[e2e:long]") ? "chunk ".repeat(1_500) : prompt;
      return {
        provider: name,
        model: model || defaultModel,
        text: [`E2E ${name} response`, `Prompt: ${body}`, `Profile: ${profileLine}`].join("\n")
      };
    }
  };
}

function mergeRuntimeConfig(overrides = {}) {
  return {
    ...baseRuntimeConfig,
    ...overrides,
    allowedUserIds: overrides.allowedUserIds ?? baseRuntimeConfig.allowedUserIds,
    allowedChannelIds: overrides.allowedChannelIds ?? baseRuntimeConfig.allowedChannelIds,
    allowedModels: {
      ...baseRuntimeConfig.allowedModels,
      ...(overrides.allowedModels ?? {})
    }
  };
}

export function createCommandHarness(options = {}) {
  const {
    runtimeConfig,
    providers: providerOverrides,
    channelMessages = [],
    channelHistoryPages = undefined,
    historyHandler = undefined,
    channelContextOptions = {},
    concurrency = 2,
    perUserConcurrency = 1,
    perUserQueue = 2
  } = /** @type {any} */ (options);
  const providers = {
    openai: createProvider("openai", "e2e-openai-model"),
    anthropic: createProvider("anthropic", "e2e-anthropic-model"),
    ...providerOverrides
  };
  const router = new AgentRouter({ providers, profiles });
  const semaphore = new Semaphore(concurrency);
  const userSemaphore = new KeyedSemaphore(perUserConcurrency, { maxQueue: perUserQueue });
  const resolvedRuntimeConfig = mergeRuntimeConfig(runtimeConfig);
  const defaultMessageCount = channelHistoryPages
    ? 5
    : Math.min(15, channelMessages.length);
  const channelContext = new SlackChannelContext({
    messageCount: channelContextOptions.messageCount ?? defaultMessageCount,
    ...channelContextOptions
  });
  const historyCalls = [];

  return {
    commands: commandDefinitions.map((definition) => definition.command),
    semaphore,
    historyCalls,
    async invoke({ commandName, text = "", userId = "U_E2E", channelId = "C_E2E" }) {
      const definition = commandDefinitions.find((entry) => entry.command === commandName);
      if (!definition) throw new Error(`Unknown command: ${commandName}`);

      const responses = [];
      const publicPosts = [];
      const ephemeralPosts = [];
      const logs = [];

      await handleSlashCommand({
        definition,
        command: {
          command: commandName,
          text,
          team_id: "T_E2E",
          channel_id: channelId,
          user_id: userId
        },
        respond: async (payload) => {
          responses.push(structuredClone(payload));
        },
        client: {
          conversations: {
            history: async (payload) => {
              historyCalls.push(structuredClone(payload));
              if (historyHandler) {
                return historyHandler(payload, historyCalls.length - 1);
              }
              if (channelHistoryPages) {
                return structuredClone(
                  channelHistoryPages[historyCalls.length - 1] ?? { messages: [] }
                );
              }
              return {
                messages: [...channelMessages]
                  .reverse()
                  .map((message, index) =>
                    typeof message === "string"
                      ? { user: `U_CONTEXT_${index}`, text: message }
                      : structuredClone(message)
                  )
              };
            }
          },
          chat: {
            postMessage: async (payload) => {
              publicPosts.push(structuredClone(payload));
              return { ok: true, ts: `1700000000.${publicPosts.length}` };
            },
            postEphemeral: async (payload) => {
              ephemeralPosts.push(structuredClone(payload));
              return { ok: true };
            }
          }
        },
        logger: {
          info(event, payload) {
            logs.push({ level: "info", event, payload: structuredClone(payload) });
          },
          warn(event, payload) {
            logs.push({ level: "warn", event, payload: structuredClone(payload) });
          },
          error(event, payload) {
            logs.push({
              level: "error",
              event,
              payload: {
                ...structuredClone({ ...payload, error: undefined }),
                errorName: payload?.error?.name,
                errorMessage: payload?.error?.message
              }
            });
          }
        },
        router,
        semaphore,
        userSemaphore,
        channelContext,
        runtimeConfig: resolvedRuntimeConfig,
        profiles
      });

      return {
        command: commandName,
        responses,
        publicPosts,
        ephemeralPosts,
        logs,
        historyCalls: structuredClone(historyCalls),
        finalResponse: responses.at(-1)?.text || "",
        publicTranscript: publicPosts.map((entry) => entry.text).join("\n\n")
      };
    }
  };
}
