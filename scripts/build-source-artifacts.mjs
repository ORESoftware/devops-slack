import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

function slug(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || normalized.length > 100) {
    throw new TypeError(`${field} must produce a non-empty slug of at most 100 characters`);
  }
  return normalized;
}

export function normalizeCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new TypeError("commit must be a 40-character hexadecimal Git SHA");
  }
  return commit;
}

export function artifactStem({ name, version, commit }) {
  return `${slug(name, "name")}-${slug(version, "version")}-${normalizeCommit(commit).slice(0, 12)}`;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim();
}

export async function buildSourceArtifacts({
  root = defaultRoot,
  outputDir = process.env.ARTIFACT_DIR || resolve(root, "dist")
} = {}) {
  root = resolve(root);
  outputDir = resolve(outputDir);
  if (outputDir === root) throw new Error("artifact output directory must not be the repository root");

  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const commit = normalizeCommit(await git(root, ["rev-parse", "HEAD"]));
  const tree = normalizeCommit(await git(root, ["rev-parse", "HEAD^{tree}"]));
  const committedAt = await git(root, ["show", "-s", "--format=%cI", "HEAD"]);
  const stem = artifactStem({ name: packageJson.name, version: packageJson.version, commit });

  await mkdir(outputDir, { recursive: true });
  const archivePath = resolve(outputDir, `${stem}.tar.gz`);
  const manifestPath = resolve(outputDir, `${stem}-slack-manifest.json`);
  const metadataPath = resolve(outputDir, `${stem}-metadata.json`);
  const checksumsPath = resolve(outputDir, "SHA256SUMS");

  await execFileAsync(
    "git",
    [
      "archive",
      "--format=tar.gz",
      `--prefix=${stem}/`,
      `--output=${archivePath}`,
      "HEAD"
    ],
    { cwd: root }
  );
  await copyFile(resolve(root, "manifest.json"), manifestPath);
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        artifact: packageJson.name,
        version: packageJson.version,
        commit,
        tree,
        committedAt,
        sourceRef: process.env.GITHUB_REF || null,
        repository: process.env.GITHUB_REPOSITORY || null
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const files = [archivePath, manifestPath, metadataPath];
  const checksumLines = [];
  for (const file of files) {
    checksumLines.push(`${await sha256File(file)}  ${basename(file)}`);
  }
  await writeFile(checksumsPath, `${checksumLines.sort().join("\n")}\n`, "utf8");

  return {
    stem,
    commit,
    outputDir,
    files: [...files, checksumsPath]
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const result = await buildSourceArtifacts();
  console.log(`Created ${result.files.length} source artifact files in ${result.outputDir}`);
}
