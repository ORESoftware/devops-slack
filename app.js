import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { AgentRouter } from "./src/agent-router.js";
import { commandDefinitions, profiles, runtimeConfig } from "./src/config.js";
import { createProviders } from "./src/providers/index.js";
import { KeyedSemaphore } from "./src/keyed-semaphore.js";
import { registerCommands } from "./src/register-commands.js";
import { RequestDeduplicator } from "./src/request-deduplicator.js";
import { Semaphore } from "./src/semaphore.js";
import { SlackChannelContext } from "./src/slack/channel-context.js";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const appOptions = runtimeConfig.socketMode
  ? {
      token: requireEnv("SLACK_BOT_TOKEN"),
      appToken: requireEnv("SLACK_APP_TOKEN"),
      socketMode: true
    }
  : {
      token: requireEnv("SLACK_BOT_TOKEN"),
      signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
      socketMode: false
    };

const logLevels = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR
};

const app = new App({
  ...appOptions,
  logLevel: logLevels[runtimeConfig.logLevel]
});

const providers = createProviders(runtimeConfig);
const router = new AgentRouter({
  providers,
  profiles,
  includeSlackIdentifiers: runtimeConfig.includeSlackIdentifiersInPrompt
});
const semaphore = new Semaphore(runtimeConfig.maxConcurrentRequests, {
  maxQueue: runtimeConfig.maxQueuedRequests,
  queueTimeoutMs: runtimeConfig.maxQueueWaitMs
});
const userSemaphore = new KeyedSemaphore(runtimeConfig.maxConcurrentRequestsPerUser, {
  maxQueue: runtimeConfig.maxQueuedRequestsPerUser,
  queueTimeoutMs: runtimeConfig.maxQueueWaitMs
});
const requestDeduplicator = new RequestDeduplicator({
  ttlMs: runtimeConfig.requestDedupeTtlMs,
  maxEntries: runtimeConfig.requestDedupeMaxEntries
});
const channelContext = new SlackChannelContext({
  messageCount: runtimeConfig.slackContextMessageCount,
  cacheTtlMs: runtimeConfig.slackContextCacheTtlMs,
  maxChars: runtimeConfig.slackContextMaxChars,
  maxEntries: runtimeConfig.slackContextCacheMaxEntries,
  maxPages: runtimeConfig.slackContextMaxPages,
  fetchTimeoutMs: runtimeConfig.slackContextFetchTimeoutMs
});

const commandRuntime = registerCommands({
  app,
  commandDefinitions,
  profiles,
  router,
  semaphore,
  userSemaphore,
  channelContext,
  requestDeduplicator,
  runtimeConfig
});

if (runtimeConfig.socketMode) {
  await app.start();
} else {
  await app.start(runtimeConfig.port);
}
const startupMode = runtimeConfig.socketMode
  ? "Socket Mode"
  : `HTTP mode on port ${runtimeConfig.port}`;
app.logger.info(`alex-main-agent started in ${startupMode}`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    commandRuntime.stopAccepting();
    app.logger.info(
      `Received ${signal}; draining ${commandRuntime.active} in-flight Slack command(s)`
    );

    try {
      await commandRuntime.drain(runtimeConfig.shutdownGraceMs);
    } catch (error) {
      app.logger.warn("Command drain did not complete before shutdown", error);
    }

    try {
      await app.stop();
      process.exitCode = 0;
    } catch (error) {
      app.logger.error("Failed to stop Slack app cleanly", error);
      process.exitCode = 1;
    }
  });
}
