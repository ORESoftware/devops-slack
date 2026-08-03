import assert from "node:assert/strict";
import test from "node:test";
import { artifactPath } from "./artifacts.mjs";
import { browserExecutablePath, browserLaunchArgs } from "./browser-path.mjs";
import { startHarnessServer } from "./harness-server.mjs";
import { importBrowserLibrary } from "./optional-import.mjs";

const puppeteerModule = await importBrowserLibrary("puppeteer-core");
const puppeteer = puppeteerModule?.default;
const paginatedContextMarker = "paginated Puppeteer context marker";

async function screenshotSafely(page, filename) {
  if (!page) return;
  try {
    await page.screenshot({ path: await artifactPath(filename), fullPage: true });
  } catch {
    // Preserve the original test failure when diagnostics cannot be captured.
  }
}

test(
  "Puppeteer invokes a command with paginated context, renders help, and reports failures safely",
  { skip: !puppeteer, timeout: 60_000 },
  async () => {
    let server;
    let browser;
    let page;

    try {
      server = await startHarnessServer({
        channelHistoryPages: [
          {
            messages: [{ user: "U_BOT", bot_id: "B1", text: "ignored bot message" }],
            has_more: true,
            response_metadata: { next_cursor: "puppeteer-page-2" }
          },
          {
            messages: [{ user: "U_HUMAN", text: paginatedContextMarker }],
            has_more: false,
            response_metadata: { next_cursor: "" }
          }
        ],
        channelContextOptions: { messageCount: 1, maxPages: 2 }
      });
      browser = await puppeteer.launch({
        executablePath: browserExecutablePath(),
        args: browserLaunchArgs,
        headless: true
      });
      page = await browser.newPage();
      page.setDefaultTimeout(15_000);

      const response = await page.goto(server.url, { waitUntil: "networkidle0" });
      const csp = response?.headers()["content-security-policy"] || "";
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/);

      await page.select("#command", "/x-claude");
      await page.type("#prompt", "write a concise launch note");
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("E2E anthropic response")
      );
      const answer = await page.$eval("#result", (element) => element.textContent || "");
      assert.match(answer, /X · Claude/);
      assert.match(answer, /write a concise launch note/);
      assert.match(answer, new RegExp(paginatedContextMarker));

      await page.$eval("#prompt", (element) => {
        element.value = "";
      });
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("Usage:")
      );
      const help = await page.$eval("#result", (element) => element.textContent || "");
      assert.match(help, /\/x-claude/);
      assert.match(help, /--model MODEL/);

      await page.type("#prompt", "[e2e:error]");
      await page.click("#submit");
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("command failed")
      );
      const failure = await page.$eval("#result", (element) => element.textContent || "");
      assert.doesNotMatch(failure, /sk-test-never-expose/);
      await screenshotSafely(page, "puppeteer-success.png");
    } catch (error) {
      await screenshotSafely(page, "puppeteer-failure.png");
      throw error;
    } finally {
      await browser?.close().catch(() => {});
      await server?.close().catch(() => {});
    }
  }
);
