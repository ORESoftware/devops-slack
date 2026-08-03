import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const artifactsDir = resolve(fileURLToPath(new URL("../artifacts", import.meta.url)));

export async function artifactPath(filename) {
  await mkdir(artifactsDir, { recursive: true });
  return resolve(artifactsDir, filename);
}
