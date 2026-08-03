import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectJavaScriptFiles,
  validateJavaScriptSyntax
} from "../scripts/check-js-syntax.mjs";

test("syntax validation finds source modules while ignoring dependencies and artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "slack-js-check-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await mkdir(join(root, "tests", "e2e", "artifacts"), { recursive: true });
    await writeFile(join(root, "src", "valid.js"), "export const value = 1;\n");
    await writeFile(join(root, "src", "invalid.mjs"), "export const = ;\n");
    await writeFile(join(root, "node_modules", "ignored", "broken.js"), "export const = ;\n");
    await writeFile(join(root, "tests", "e2e", "artifacts", "broken.js"), "export const = ;\n");

    const files = await collectJavaScriptFiles(root);
    assert.deepEqual(
      files.map((file) => file.slice(root.length + 1)),
      ["src/invalid.mjs", "src/valid.js"]
    );

    const validFailures = validateJavaScriptSyntax([join(root, "src", "valid.js")], { root });
    assert.deepEqual(validFailures, []);

    const invalidFailures = validateJavaScriptSyntax([join(root, "src", "invalid.mjs")], { root });
    assert.equal(invalidFailures.length, 1);
    assert.equal(invalidFailures[0].file, "src/invalid.mjs");
    assert.match(invalidFailures[0].message, /SyntaxError|Unexpected token/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
