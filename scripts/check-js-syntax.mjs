import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const supportedExtensions = new Set([".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([".git", "node_modules", "coverage", "artifacts"]);

/**
 * Returns JavaScript module paths under a repository without following symlinks or scanning
 * dependency/build-output directories.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectJavaScriptFiles(root) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolute);
        continue;
      }
      if (entry.isFile() && supportedExtensions.has(extname(entry.name))) files.push(absolute);
    }
  }

  await visit(resolve(root));
  return files.sort();
}

/**
 * Runs Node's parser against every supplied JavaScript module and returns bounded diagnostics.
 *
 * @param {string[]} files
 * @param {{ root?: string, timeoutMs?: number }} [options]
 */
export function validateJavaScriptSyntax(files, { root = process.cwd(), timeoutMs = 10_000 } = {}) {
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 512 * 1024
    });
    if (result.status === 0 && !result.error) continue;

    failures.push({
      file: relative(root, file) || file,
      status: result.status,
      message: String(result.error?.message || result.stderr || result.stdout || "syntax check failed")
        .trim()
        .slice(0, 4_000)
    });
  }
  return failures;
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = await collectJavaScriptFiles(root);
  if (files.length === 0) throw new Error("No JavaScript files were found to validate");

  const failures = validateJavaScriptSyntax(files, { root });
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Syntax validation failed for ${failure.file}:\n${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Validated JavaScript syntax in ${files.length} files.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
