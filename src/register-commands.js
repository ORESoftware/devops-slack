import { parseCommandText } from "./command-options.js";
import { errorDetailsForLog, redactSensitiveText } from "./security/redaction.js";
import { isAllowed } from "./security/access.js";
import { chunkText, truncateText } from "./slack/chunk-text.js";
import { RequestDeduplicator } from "./request-deduplicator.js";
import { TaskTracker } from "./task-tracker.js";

const providerLabels = {
  openai: "ChatGPT",
  anthropic: "Claude"
};

function helpText(definition) {
  return [
    `*${definition.command}* — ${definition.description}`,
    `Usage: \`${definition.command} ${definition.usage_hint}\``,
    "Options: `--public`, `--ephemeral`, `--model MODEL`, `--help`, `--`"
  ].join("\n");
}

function isTimeoutError(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || error?.cause?.code || "");
  const message = String(error?.message || "");
  return (
    /abort|timeout/i.test(name) ||
    /ETIMEDOUT|ECONNABORTED/i.test(code) ||
    /timed?\s*out/i.test(message)
  );
}

function neutralizeSlackMentions(value) {
  return String(value)
    .replace(
      /<!(channel|here|everyone)(?:\^[^>]*)?>/gi,
      (_match, name) => `@\u200B${name.toLowerCase()}`
    )
    .replace(
      /<!subteam\^[^>|]+(?:\|@?([^>]+))?>/gi,
      (_match, label) => `@\u200B${label || "group"}`
    )
    .replace(/<@[A-Z0-9]+>/gi, "@\u200Buser")
    .replace(/<#[A-Z0-9]+(?:\|[^>]*)?>/gi, "#\u200Bchannel");
}

export function safeErrorMessage(error) {
  if (error?.code === "QUEUE_FULL" || error?.code === "QUEUE_TIMEOUT") {
    return "The app is at capacity. Try again shortly.";
  }
  if (isTimeoutError(error)) return "The AI request timed out.";
  const message = error instanceof Error ? error.message : String(error);
  if (
    /^(Unknown option:|--model (?:requires|must be)|Trailing escape|Unterminated quoted)/.test(
      message
    )
  ) {
    return message;
  }
  if (/API_KEY is not configured/.test(message)) return message;
  if (/rate.?limit|too many requests|429/i.test(message)) {
    return "The provider rate limit was reached. Try again shortly.";
  }
  if (/401|authentication|unauthorized|invalid.?api.?key/i.test(message)) {
    return "The provider rejected its API credentials.";
  }
  return "The command failed. Check the app logs for the internal error.";
}

async function sendChunks({ chunks, responseType, respond, client, command }) {
  if (responseType === "in_channel") {
    let threadTs;
    for (const text of chunks) {
      const result = await client.chat.postMessage({
        channel: command.channel_id,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false
      });
      threadTs ||= result.ts;
    }
    await respond({
      response_type: "ephemeral",
      replace_original: true,
      text: `Posted the ${command.command} response in this channel.`
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    replace_original: true,
    text: chunks[0]
  });
  for (const text of chunks.slice(1)) {
    try {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text
      });
    } catch {
      await respond({
        response_type: "ephemeral",
        text
      });
    }
  }
}

function isModelAllowed(definition, model, runtimeConfig) {
  if (!model) return true;
  const allowed = runtimeConfig.allowedModels?.[definition.provider];
  return !allowed || allowed.size === 0 || allowed.has(model);
}

export async function handleSlashCommand({
  definition,
  command,
  respond,
  client,
  logger,
  router,
  semaphore,
  userSemaphore = undefined,
  channelContext = undefined,
  runtimeConfig,
  profiles
}) {
  if (
    !isAllowed({
      userId: command.user_id,
      channelId: command.channel_id,
      allowedUserIds: runtimeConfig.allowedUserIds,
      allowedChannelIds: runtimeConfig.allowedChannelIds
    })
  ) {
    await respond({
      response_type: "ephemeral",
      text: "You are not allowed to use this command here."
    });
    return;
  }

  let options;
  try {
    options = parseCommandText(command.text || "");
  } catch (error) {
    await respond({
      response_type: "ephemeral",
      text: `${safeErrorMessage(error)}\n\n${helpText(definition)}`
    });
    return;
  }

  if (options.help || !options.prompt) {
    await respond({ response_type: "ephemeral", text: helpText(definition) });
    return;
  }

  if (options.prompt.length > runtimeConfig.maxPromptChars) {
    await respond({
      response_type: "ephemeral",
      text: `Prompt is too long (${options.prompt.length} characters; max ${runtimeConfig.maxPromptChars}).`
    });
    return;
  }

  const providerPrompt = redactSensitiveText(options.prompt) || "";
  const promptRedacted = providerPrompt !== options.prompt;

  if (options.responseType === "in_channel" && runtimeConfig.allowPublicResponses === false) {
    await respond({
      response_type: "ephemeral",
      text: "Public responses are disabled for this app. Remove `--public` and try again."
    });
    return;
  }

  if (!isModelAllowed(definition, options.model, runtimeConfig)) {
    await respond({
      response_type: "ephemeral",
      text: `Model \`${options.model}\` is not allowed for ${
        providerLabels[definition.provider] || definition.provider
      }.`
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `Working on ${definition.command}…`
  });

  try {
    const executeAdmittedCommand = async () => {
      let recentMessages = [];
      if (channelContext?.enabled) {
        try {
          recentMessages = await channelContext.get({
            client,
            enterpriseId: command.enterprise_id,
            teamId: command.team_id,
            channelId: command.channel_id
          });
        } catch (error) {
          logger.warn?.("slack_context_unavailable", {
            command: definition.command,
            channelId: command.channel_id,
            error: errorDetailsForLog(error)
          });
        }
      }

      const result = await router.run({
        definition,
        prompt: providerPrompt,
        model: options.model,
        recentMessages,
        context: {
          teamId: command.team_id,
          channelId: command.channel_id,
          userId: command.user_id
        }
      });
      return { result, contextMessages: recentMessages.length };
    };

    const runWithinGlobalLimit = () => semaphore.use(executeAdmittedCommand);
    const userKey = `${command.team_id || "unknown"}:${command.user_id || "unknown"}`;
    const { result, contextMessages } = userSemaphore
      ? await userSemaphore.use(userKey, runWithinGlobalLimit)
      : await runWithinGlobalLimit();

    const profileLabel = profiles[definition.profile]?.label || definition.profile;
    const providerLabel = providerLabels[definition.provider] || definition.provider;
    const heading = `*${profileLabel} · ${providerLabel}*  _${result.model}_`;
    const redactionNotice = promptRedacted
      ? "\n\n_Credential-like text was redacted before provider processing._"
      : "";
    const slackSafeOutput = neutralizeSlackMentions(
      `${heading}${redactionNotice}\n\n${result.text}`
    );
    const limited = truncateText(slackSafeOutput, runtimeConfig.maxResponseChars);
    const chunks = chunkText(limited.text);

    await sendChunks({
      chunks,
      responseType: options.responseType,
      respond,
      client,
      command
    });

    logger.info("slash_command_completed", {
      command: definition.command,
      provider: definition.provider,
      model: result.model,
      userId: command.user_id,
      channelId: command.channel_id,
      contextMessages,
      promptRedacted,
      responseChars: result.text.length,
      truncated: limited.truncated
    });
  } catch (error) {
    logger.error("slash_command_failed", {
      command: definition.command,
      provider: definition.provider,
      userId: command.user_id,
      channelId: command.channel_id,
      error: errorDetailsForLog(error)
    });
    await respond({
      response_type: "ephemeral",
      replace_original: true,
      text: safeErrorMessage(error)
    });
  }
}

/** @param {any} options */
export function registerCommands(options) {
  const {
    app,
    commandDefinitions,
    taskTracker = new TaskTracker(),
    requestDeduplicator = new RequestDeduplicator(),
    ...dependencies
  } = options;
  for (const definition of commandDefinitions) {
    app.command(definition.command, async ({ command, ack, respond, client, logger }) => {
      await ack();

      if (!taskTracker.accepting) {
        await respond({
          response_type: "ephemeral",
          text: "The app is restarting and is not accepting new commands yet."
        });
        return;
      }

      const retryId = command.trigger_id?.trim();
      if (retryId) {
        const retryKey = `${command.team_id || "unknown"}:${definition.command}:${retryId}`;
        if (!requestDeduplicator.accept(retryKey)) {
          await respond({
            response_type: "ephemeral",
            text: "This Slack command request was already accepted. Its original response will arrive separately."
          });
          return;
        }
      }

      const task = taskTracker.run(() =>
        handleSlashCommand({
          ...dependencies,
          definition,
          command,
          respond,
          client,
          logger
        })
      );

      if (!task) {
        await respond({
          response_type: "ephemeral",
          text: "The app is restarting and is not accepting new commands yet."
        });
        return;
      }

      void task.catch((error) => {
        logger.error("slash_command_unhandled_failure", {
          command: definition.command,
          userId: command.user_id,
          channelId: command.channel_id,
          error: errorDetailsForLog(error)
        });
      });
    });
  }
  return taskTracker;
}
