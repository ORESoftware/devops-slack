#!/usr/bin/env node
import { createCommandHarness } from "../support/command-harness.mjs";

function parseCsv(value) {
  return new Set((value || "").split(",").map((entry) => entry.trim()).filter(Boolean));
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = {
    commandName: "",
    text: "",
    userId: "U_E2E",
    channelId: "C_E2E",
    channelMessages: [],
    runtimeConfig: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--command") options.commandName = requireValue(argv, index++, arg);
    else if (arg === "--text") options.text = requireValue(argv, index++, arg);
    else if (arg === "--user-id") options.userId = requireValue(argv, index++, arg);
    else if (arg === "--channel-id") options.channelId = requireValue(argv, index++, arg);
    else if (arg === "--context-message") {
      options.channelMessages.push(requireValue(argv, index++, arg));
    }
    else if (arg === "--allowed-users") {
      options.runtimeConfig.allowedUserIds = parseCsv(requireValue(argv, index++, arg));
    } else if (arg === "--allowed-channels") {
      options.runtimeConfig.allowedChannelIds = parseCsv(requireValue(argv, index++, arg));
    } else if (arg === "--openai-models") {
      options.runtimeConfig.allowedModels = {
        ...(options.runtimeConfig.allowedModels || {}),
        openai: parseCsv(requireValue(argv, index++, arg))
      };
    } else if (arg === "--anthropic-models") {
      options.runtimeConfig.allowedModels = {
        ...(options.runtimeConfig.allowedModels || {}),
        anthropic: parseCsv(requireValue(argv, index++, arg))
      };
    } else if (arg === "--disable-public") options.runtimeConfig.allowPublicResponses = false;
    else if (arg === "--max-prompt-chars") {
      const value = Number(requireValue(argv, index++, arg));
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("--max-prompt-chars must be a positive integer");
      }
      options.runtimeConfig.maxPromptChars = value;
    } else if (arg === "--pretty") options.pretty = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.commandName) throw new Error("--command is required");
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const harness = createCommandHarness({
    runtimeConfig: options.runtimeConfig,
    channelMessages: options.channelMessages
  });
  const result = await harness.invoke({
    commandName: options.commandName,
    text: options.text,
    userId: options.userId,
    channelId: options.channelId
  });
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
