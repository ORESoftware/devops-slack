import assert from "node:assert/strict";
import test from "node:test";
import { chunkText, truncateText } from "../src/slack/chunk-text.js";

test("chunks without dropping content", () => {
  const input = `${"a".repeat(120)} ${"b".repeat(120)} ${"c".repeat(120)}`;
  const chunks = chunkText(input, 150);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), input.replace(/\s+/g, " "));
  assert.ok(chunks.every((chunk) => chunk.length <= 150));
});

test("truncates with an explicit marker", () => {
  const result = truncateText("x".repeat(1000), 200);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 200);
  assert.match(result.text, /truncated/);
});
