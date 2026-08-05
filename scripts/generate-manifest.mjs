import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, loadCommands } from "./manifest-lib.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDir, "manifest.json");
const generated = `${JSON.stringify(buildManifest(loadCommands(rootDir)), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(outputPath, "utf8");
  } catch {
    // handled below
  }
  if (existing !== generated) {
    console.error("manifest.json is out of date. Run: npm run manifest:generate");
    process.exit(1);
  }
  console.log("manifest.json is current");
} else {
  writeFileSync(outputPath, generated);
  console.log(`Wrote ${outputPath}`);
}
