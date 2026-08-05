import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  artifactStem,
  buildSourceArtifacts,
  normalizeCommit,
  sha256File
} from "../scripts/build-source-artifacts.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

function parseChecksums(value) {
  return new Map(
    value
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/);
        assert.ok(match, `invalid checksum line: ${line}`);
        return [match[2], match[1]];
      })
  );
}

test("artifact names are commit-addressed and reject invalid Git SHAs", () => {
  const commit = "a".repeat(40);
  assert.equal(normalizeCommit(commit.toUpperCase()), commit);
  assert.equal(
    artifactStem({ name: "Slack ORES Integrations", version: "0.1.0", commit }),
    `slack-ores-integrations-0.1.0-${"a".repeat(12)}`
  );
  assert.throws(() => normalizeCommit("main"), /40-character hexadecimal Git SHA/);
  assert.throws(
    () => artifactStem({ name: "***", version: "0.1.0", commit }),
    /non-empty slug/
  );
});

test("builds a tracked source archive, standalone Slack manifest, metadata, and checksums", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "slack-ores-artifacts-"));
  try {
    const result = await buildSourceArtifacts({ root, outputDir });
    assert.equal(result.files.length, 4);
    assert.match(result.stem, /^slack-ores-integrations-0\.1\.0-[a-f0-9]{12}$/);

    const archivePath = resolve(outputDir, `${result.stem}.tar.gz`);
    const manifestPath = resolve(outputDir, `${result.stem}-slack-manifest.json`);
    const metadataPath = resolve(outputDir, `${result.stem}-metadata.json`);
    const checksumsPath = resolve(outputDir, "SHA256SUMS");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const checksums = parseChecksums(await readFile(checksumsPath, "utf8"));

    assert.equal(metadata.commit, result.commit);
    assert.match(metadata.tree, /^[a-f0-9]{40}$/);
    assert.equal(metadata.artifact, "slack-ores-integrations");
    assert.equal(metadata.version, "0.1.0");
    assert.equal(manifest.display_information.name, "alex-main-agent");

    for (const path of [archivePath, manifestPath, metadataPath]) {
      assert.equal(checksums.get(path.split("/").at(-1)), await sha256File(path));
    }

    const { stdout: listing } = await execFileAsync("tar", ["-tzf", archivePath], {
      encoding: "utf8"
    });
    const entries = listing.trim().split("\n");
    assert.ok(entries.length > 20);
    assert.ok(entries.every((entry) => entry.startsWith(`${result.stem}/`)));
    assert.equal(entries.some((entry) => entry.includes("/.git/")), false);
    assert.equal(entries.some((entry) => entry.includes("/node_modules/")), false);
    assert.equal(entries.includes(`${result.stem}/.env`), false);
    assert.ok(entries.includes(`${result.stem}/manifest.json`));
    assert.ok(entries.includes(`${result.stem}/tests/e2e/browser/playwright.test.js`));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
