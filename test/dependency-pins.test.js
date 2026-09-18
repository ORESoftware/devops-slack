import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDependencyPins } from "../scripts/check-dependency-pins.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

test("all direct dependencies use exact versions", () => {
  const result = validateDependencyPins(packageJson);
  assert.ok(result.dependencyCount >= 10);
});

test("dependency pin validation rejects ranges and duplicate declarations", () => {
  assert.throws(
    () =>
      validateDependencyPins({
        engines: { node: ">=22" },
        dependencies: { example: "^1.2.3" }
      }),
    /exact semantic version/
  );

  assert.throws(
    () =>
      validateDependencyPins({
        engines: { node: ">=22" },
        dependencies: { example: "1.2.3" },
        devDependencies: { example: "1.2.3" }
      }),
    /must not be declared/
  );
});
