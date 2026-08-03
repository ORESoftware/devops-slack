import assert from "node:assert/strict";
import test from "node:test";
import { createCommandHarness } from "../support/command-harness.mjs";

const syntheticToken = "ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

test("CLI flow never forwards credential-like prompt text to the provider", async () => {
  const harness = createCommandHarness();
  const result = await harness.invoke({
    commandName: "/ores-chatgpt",
    text: `audit ${syntheticToken} safely`
  });

  assert.doesNotMatch(result.finalResponse, new RegExp(syntheticToken));
  assert.match(result.finalResponse, /\[REDACTED_TOKEN\]/);
  assert.match(result.finalResponse, /Credential-like text was redacted/);
  const completion = result.logs.find((entry) => entry.event === "slash_command_completed");
  assert.equal(completion?.payload?.promptRedacted, true);
});
