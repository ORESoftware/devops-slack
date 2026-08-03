import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const driver = fileURLToPath(new URL("./command-driver.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../..", import.meta.url));
const commands = [
  "/x-claude",
  "/x-chatgpt",
  "/ores-claude",
  "/ores-chatgpt",
  "/my-claude",
  "/my-chatgpt"
];
const fakeGitHubToken = `gh${"p"}_${"a".repeat(36)}`;

async function invoke(command, text, extraArgs = []) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [driver, "--command", command, "--text", text, ...extraArgs],
    { cwd: root }
  );
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

test("CLI driver executes every configured command through the real handler", async () => {
  for (const command of commands) {
    const result = await invoke(command, `hello from ${command}`);
    assert.equal(result.command, command);
    assert.match(result.finalResponse, new RegExp(`hello from ${command.replace("/", "\\/")}`));
    assert.equal(result.logs.at(-1)?.event, "slash_command_completed");
  }
});

test("CLI driver captures public channel messages and thread chunks", async () => {
  const result = await invoke("/ores-chatgpt", "--public --model gpt-cli-e2e [e2e:long] inspect this");
  assert.match(result.finalResponse, /Posted the \/ores-chatgpt response/);
  assert.ok(result.publicPosts.length > 1);
  assert.equal(result.publicPosts[0].thread_ts, undefined);
  assert.equal(result.publicPosts[1].thread_ts, "1700000000.1");
});

test("CLI driver enforces user, channel, model, public, and prompt restrictions", async () => {
  const userDenied = await invoke("/my-chatgpt", "hello", ["--allowed-users", "U_OTHER"]);
  assert.match(userDenied.finalResponse, /not allowed/);

  const modelDenied = await invoke("/ores-chatgpt", "--model gpt-denied hello", [
    "--openai-models",
    "gpt-approved"
  ]);
  assert.match(modelDenied.finalResponse, /not allowed for ChatGPT/);

  const publicDenied = await invoke("/ores-chatgpt", "--public hello", ["--disable-public"]);
  assert.match(publicDenied.finalResponse, /Public responses are disabled/);

  const promptDenied = await invoke("/ores-chatgpt", "123456", ["--max-prompt-chars", "5"]);
  assert.match(promptDenied.finalResponse, /Prompt is too long/);
});

test("CLI driver sanitizes provider failures", async () => {
  const result = await invoke("/x-claude", "[e2e:error]");
  assert.match(result.finalResponse, /command failed/);
  assert.doesNotMatch(result.finalResponse, /sk-test-never-expose/);
  assert.equal(result.logs.at(-1)?.event, "slash_command_failed");
  assert.doesNotMatch(JSON.stringify(result.logs), /sk-test-never-expose/);
});

test("CLI driver sends sanitized recent Slack messages as untrusted context", async () => {
  const result = await invoke("/ores-chatgpt", "summarize the release decision", [
    "--context-message",
    "The release moved to Friday.",
    "--context-message",
    `Ask <@U123456789> and never expose ${fakeGitHubToken}`
  ]);

  assert.match(result.finalResponse, /recentSlackMessages/);
  assert.match(result.finalResponse, /The release moved to Friday/);
  assert.match(result.finalResponse, /summarize the release decision/);
  assert.doesNotMatch(result.finalResponse, /U123456789|ghp_/);
  assert.equal(result.logs.at(-1)?.payload.contextMessages, 2);
});

test("CLI driver rejects unknown commands and arguments", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [driver, "--command", "/unknown", "--text", "hello"]),
    (error) => {
      const failure = /** @type {any} */ (error);
      assert.equal(failure.code, 1);
      assert.match(failure.stderr, /Unknown command/);
      return true;
    }
  );

  await assert.rejects(execFileAsync(process.execPath, [driver, "--wat"]), /Unknown argument/);
});
