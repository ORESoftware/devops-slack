import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateDependencyPins(packageJson) {
  const sections = ["dependencies", "devDependencies", "optionalDependencies"];
  const seen = new Map();

  for (const section of sections) {
    const dependencies = packageJson[section] ?? {};
    assert.equal(
      dependencies && typeof dependencies === "object" && !Array.isArray(dependencies),
      true,
      `${section} must be an object`
    );

    for (const [name, version] of Object.entries(dependencies)) {
      assert.equal(
        exactVersionPattern.test(String(version)),
        true,
        `${section}.${name} must use an exact semantic version, received ${version}`
      );
      assert.equal(
        seen.has(name),
        false,
        `${name} must not be declared in both ${seen.get(name)} and ${section}`
      );
      seen.set(name, section);
    }
  }

  assert.match(packageJson.engines?.node ?? "", /^>=22(?:\.0\.0)?$/);
  return { dependencyCount: seen.size };
}

async function main() {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const result = validateDependencyPins(packageJson);
  process.stdout.write(`Validated ${result.dependencyCount} exact dependency pins.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
