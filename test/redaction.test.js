import assert from "node:assert/strict";
import test from "node:test";
import { errorDetailsForLog, redactSensitiveText } from "../src/security/redaction.js";

const fakeClassicGitHubToken = `gh${"p"}_${"a".repeat(36)}`;
const fakeFineGrainedGitHubToken = `github_${"pat"}_${"b".repeat(40)}`;

test("redacts provider, Slack, GitHub, bearer, and configured environment credentials", () => {
  const previous = process.env.TEST_SECRET;
  process.env.TEST_SECRET = "configured-secret-value";
  try {
    const redacted = redactSensitiveText(
      "sk-provider-secret xoxb-slack-secret-value " +
        `${fakeClassicGitHubToken} ` +
        `${fakeFineGrainedGitHubToken} ` +
        "Bearer bearer-secret configured-secret-value"
    );
    assert.doesNotMatch(
      redacted,
      /provider-secret|slack-secret|ghp_|github_pat_|bearer-secret|configured-secret-value/
    );
    assert.match(redacted, /REDACTED/);
  } finally {
    if (previous === undefined) delete process.env.TEST_SECRET;
    else process.env.TEST_SECRET = previous;
  }
});

test("structured error details are bounded and safe for non-Error values", () => {
  assert.deepEqual(errorDetailsForLog("plain failure"), { message: "plain failure" });
  const details = errorDetailsForLog(
    Object.assign(new Error(`failed with ${"x".repeat(5_000)}`), {
      code: "E_TEST",
      status: 500
    })
  );
  assert.equal(details.code, "E_TEST");
  assert.equal(details.status, "500");
  assert.ok(details.message.length <= 500);
  assert.ok(details.stack.length <= 4_000);
});
