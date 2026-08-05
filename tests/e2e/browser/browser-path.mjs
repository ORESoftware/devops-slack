import { existsSync } from "node:fs";

const systemCandidates = [
  process.env.E2E_BROWSER_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

export function browserExecutablePath(additionalCandidates = []) {
  const executable = [...additionalCandidates, ...systemCandidates].find(
    (candidate) => typeof candidate === "string" && existsSync(candidate)
  );
  if (!executable) {
    throw new Error("No Chromium/Chrome executable found. Set E2E_BROWSER_PATH or install Chromium.");
  }
  return executable;
}

export const browserLaunchArgs = [
  "--disable-dev-shm-usage",
  ...(process.env.E2E_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])
];
