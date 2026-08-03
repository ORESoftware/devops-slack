import assert from "node:assert/strict";
import test from "node:test";
import { artifactPath } from "./artifacts.mjs";
import { browserExecutablePath, browserLaunchArgs } from "./browser-path.mjs";
import { startHarnessServer } from "./harness-server.mjs";
import { importBrowserLibrary } from "./optional-import.mjs";

const playwright = await importBrowserLibrary("playwright");
const expectedCommands = [
  "/x-claude",
  "/x-chatgpt",
  "/ores-claude",
  "/ores-chatgpt",
  "/my-claude",
  "/my-chatgpt"
];
const paginatedContextMarker = "paginated Playwright context marker";

async function screenshotSafely(page, filename) {
  if (!page) return;
  try {
    await page.screenshot({ path: await artifactPath(filename), fullPage: true });
  } catch {
    // Preserve the original test failure when diagnostics cannot be captured.
  }
}

test(
  "Playwright drives private, public, paginated-context, and injection-safe command flows",
  { skip: !playwright, timeout: 60_000 },
  async () => {
    let server;
    let browser;
    let context;
    let page;
    let tracing = false;

    try {
      server = await startHarnessServer({
        channelHistoryPages: [
          {
            messages: [{ user: "U_BOT", bot_id: "B1", text: "ignored bot message" }],
            has_more: true,
            response_metadata: { next_cursor: "playwright-page-2" }
          },
          {
            messages: [{ user: "U_HUMAN", text: paginatedContextMarker }],
            has_more: false,
            response_metadata: { next_cursor: "" }
          }
        ],
        channelContextOptions: { messageCount: 1, maxPages: 2 }
      });
      const bundled = playwright.chromium.executablePath();
      browser = await playwright.chromium.launch({
        executablePath: browserExecutablePath([bundled]),
        args: browserLaunchArgs,
        headless: true
      });
      context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true });
      tracing = true;
      page = await context.newPage();
      page.setDefaultTimeout(15_000);

      const navigation = await page.goto(server.url, { waitUntil: "networkidle" });
      const csp = navigation?.headers()["content-security-policy"] || "";
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/);

      const options = await page.locator("#command option").allTextContents();
      assert.deepEqual(options, expectedCommands);

      await page.selectOption("#command", "/ores-chatgpt");
      await page.fill("#prompt", "audit the deployment plan");
      await page.fill("#model", "gpt-e2e-override");
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("E2E openai response")
      );
      const privateResult = await page.locator("#result").textContent();
      assert.match(privateResult, /ORES · ChatGPT.*gpt-e2e-override/s);
      assert.match(privateResult, new RegExp(paginatedContextMarker));

      await page.selectOption("#command", "/my-claude");
      await page.fill("#prompt", "summarize my next step");
      await page.fill("#model", "");
      await page.check("#public");
      await page.click("#submit");
      await page.waitForFunction(() =>
        document
          .querySelector("#public-transcript")
          ?.textContent?.includes("E2E anthropic response")
      );
      assert.match(await page.locator("#result").textContent(), /Posted the \/my-claude response/);
      assert.match(await page.locator("#public-transcript").textContent(), /My · Claude/);

      await page.uncheck("#public");
      await page.fill("#prompt", '<img src=x onerror="window.__e2eXss=true">');
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("E2E anthropic response")
      );
      assert.equal(await page.evaluate(() => Reflect.get(window, "__e2eXss")), undefined);
      assert.equal(await page.locator("#result img").count(), 0);

      const syntheticToken = "ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
      await page.fill("#prompt", `audit ${syntheticToken} safely`);
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("Credential-like text was redacted")
      );
      const redactedResult = await page.locator("#result").textContent();
      assert.doesNotMatch(redactedResult, new RegExp(syntheticToken));
      assert.match(redactedResult, /\[REDACTED_TOKEN\]/);
      await screenshotSafely(page, "playwright-success.png");
    } catch (error) {
      await screenshotSafely(page, "playwright-failure.png");
      throw error;
    } finally {
      if (tracing && context) {
        try {
          await context.tracing.stop({ path: await artifactPath("playwright-trace.zip") });
        } catch {
          // Preserve the test result if tracing cleanup fails.
        }
      }
      await browser?.close().catch(() => {});
      await server?.close().catch(() => {});
    }
  }
);
