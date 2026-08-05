import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, loadCommands } from "../scripts/manifest-lib.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("manifest contains every configured command exactly once", () => {
  const commands = loadCommands(rootDir);
  const manifest = buildManifest(commands);
  const names = manifest.features.slash_commands.map((entry) => entry.command);
  assert.equal(new Set(names).size, commands.length);
  assert.deepEqual(names, commands.map((entry) => entry.command));
  assert.deepEqual(manifest.oauth_config.scopes.bot, [
    "commands",
    "chat:write",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history"
  ]);
  assert.equal(manifest.settings.socket_mode_enabled, true);
});
