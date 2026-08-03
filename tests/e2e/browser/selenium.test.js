import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { artifactPath } from "./artifacts.mjs";
import { browserExecutablePath, browserLaunchArgs } from "./browser-path.mjs";
import { startHarnessServer } from "./harness-server.mjs";
import { importBrowserLibrary } from "./optional-import.mjs";

const selenium = await importBrowserLibrary("selenium-webdriver");
const chrome = await importBrowserLibrary("selenium-webdriver/chrome.js");
const paginatedContextMarker = "paginated Selenium context marker";

async function saveScreenshot(driver, name) {
  if (!driver) return;
  try {
    const png = await driver.takeScreenshot();
    await writeFile(await artifactPath(name), png, "base64");
  } catch {
    // Preserve the original test failure when diagnostics cannot be captured.
  }
}

test(
  "Selenium drives paginated context, model override, and public-policy errors",
  { skip: !selenium || !chrome, timeout: 60_000 },
  async () => {
    let server;
    let driver;

    try {
      server = await startHarnessServer({
        runtimeConfig: { allowPublicResponses: false },
        channelHistoryPages: [
          {
            messages: [{ user: "U_BOT", bot_id: "B1", text: "ignored bot message" }],
            has_more: true,
            response_metadata: { next_cursor: "selenium-page-2" }
          },
          {
            messages: [{ user: "U_HUMAN", text: paginatedContextMarker }],
            has_more: false,
            response_metadata: { next_cursor: "" }
          }
        ],
        channelContextOptions: { messageCount: 1, maxPages: 2 }
      });
      const options = new chrome.Options()
        .setChromeBinaryPath(browserExecutablePath())
        .addArguments("--headless=new", ...browserLaunchArgs);
      const builder = new selenium.Builder().forBrowser("chrome").setChromeOptions(options);
      if (process.env.E2E_CHROMEDRIVER_PATH) {
        builder.setChromeService(new chrome.ServiceBuilder(process.env.E2E_CHROMEDRIVER_PATH));
      }
      driver = await builder.build();
      await driver.manage().setTimeouts({ implicit: 0, pageLoad: 15_000, script: 15_000 });

      await driver.get(server.url);
      const csp = await driver.executeAsyncScript((done) => {
        fetch("/", { cache: "no-store" })
          .then((response) => done(response.headers.get("content-security-policy") || ""))
          .catch((error) => done(`error:${error.message}`));
      });
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/);

      const select = await driver.findElement(selenium.By.id("command"));
      await select.findElement(selenium.By.css('option[value="/ores-claude"]')).click();
      await driver.findElement(selenium.By.id("prompt")).sendKeys("inspect the release checklist");
      await driver.findElement(selenium.By.id("model")).sendKeys("claude-e2e-override");
      await driver.findElement(selenium.By.id("submit")).click();

      const result = await driver.findElement(selenium.By.id("result"));
      await driver.wait(selenium.until.elementTextContains(result, "E2E anthropic response"), 15_000);
      const privateResult = await result.getText();
      assert.match(privateResult, /ORES · Claude.*claude-e2e-override/s);
      assert.match(privateResult, new RegExp(paginatedContextMarker));

      await driver.findElement(selenium.By.id("public")).click();
      await driver.findElement(selenium.By.id("submit")).click();
      await driver.wait(selenium.until.elementTextContains(result, "Public responses are disabled"), 15_000);
      assert.match(await result.getText(), /Remove `--public`/);
      await saveScreenshot(driver, "selenium-success.png");
    } catch (error) {
      await saveScreenshot(driver, "selenium-failure.png");
      throw error;
    } finally {
      await driver?.quit().catch(() => {});
      await server?.close().catch(() => {});
    }
  }
);
