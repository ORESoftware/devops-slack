import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadCommands(rootDir) {
  return JSON.parse(readFileSync(resolve(rootDir, "config/commands.json"), "utf8"));
}

export function buildManifest(commands) {
  return {
    _metadata: {
      major_version: 2,
      minor_version: 1
    },
    display_information: {
      name: "alex-main-agent",
      description: "ORES Slack slash commands for Claude and ChatGPT",
      background_color: "#1F2937"
    },
    features: {
      bot_user: {
        display_name: "alex-main-agent",
        always_online: true
      },
      slash_commands: commands.map((entry) => ({
        command: entry.command,
        description: entry.description,
        usage_hint: entry.usage_hint,
        should_escape: false
      }))
    },
    oauth_config: {
      scopes: {
        bot: [
          "commands",
          "chat:write",
          "channels:history",
          "groups:history",
          "im:history",
          "mpim:history"
        ]
      }
    },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false
    }
  };
}
