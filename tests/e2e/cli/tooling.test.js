import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../..", import.meta.url));
const hooksBinary = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "slack-cli-get-hooks.cmd" : "slack-cli-get-hooks");

test("manifest check succeeds from a clean CLI process", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ["scripts/generate-manifest.mjs", "--check"], {
    cwd: root
  });
  assert.equal(stderr, "");
  assert.match(stdout, /manifest\.json is current/);
});

test("Slack CLI hooks expose start and manifest commands", { skip: !existsSync(hooksBinary) && process.env.REQUIRE_E2E_DEPENDENCIES !== "true" }, async () => {
  const { stdout, stderr } = await execFileAsync(hooksBinary, [], { cwd: root });
  assert.equal(stderr, "");
  const hooks = JSON.parse(stdout);
  assert.equal(typeof hooks.hooks?.start, "string");
  assert.equal(typeof hooks.hooks?.["get-manifest"], "string");
});

test("GitHub Actions use immutable action SHAs and isolated browser jobs", async () => {
  const workflow = await import("node:fs/promises").then(({ readFile }) =>
    readFile(resolve(root, ".github", "workflows", "ci.yml"), "utf8")
  );
  const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(
    (match) => match[1]
  );

  assert.ok(actionReferences.length >= 4);
  for (const reference of actionReferences) {
    assert.match(reference, /^[^@\s]+@[a-f0-9]{40}$/, `mutable action reference: ${reference}`);
  }
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /framework: \[playwright, puppeteer, selenium\]/);
  assert.match(workflow, /browser-e2e-\$\{\{ matrix\.framework \}\}/);
  assert.doesNotMatch(workflow, /browser-actions\/setup-chrome/);
  assert.match(workflow, /command -v google-chrome/);
  assert.match(workflow, /CHROMEWEBDRIVER/);
  assert.match(workflow, /npm_config_package_lock: "true"/);
  assert.match(workflow, /npm install --package-lock-only/);
});

test("browser launch keeps the Chromium sandbox enabled by default", async () => {
  const { browserLaunchArgs } = await import("../browser/browser-path.mjs");
  assert.equal(browserLaunchArgs.includes("--no-sandbox"), false);
});

test("browser harness rejects unknown fields and sends strict security headers", async () => {
  const { startHarnessServer } = await import("../browser/harness-server.mjs");
  const server = await startHarnessServer();
  try {
    const page = await fetch(server.url);
    const csp = page.headers.get("content-security-policy") || "";
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("permissions-policy") || "", /camera=\(\)/);

    const invalid = await fetch(`${server.url}/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandName: "/x-chatgpt", text: "hello", unexpected: true })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Unknown invocation field/);
  } finally {
    await server.close();
  }
});
