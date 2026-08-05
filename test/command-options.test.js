import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandText } from "../src/command-options.js";

test("parses a default ephemeral prompt", () => {
  assert.deepEqual(parseCommandText("hello world"), {
    prompt: "hello world",
    responseType: "ephemeral",
    model: undefined,
    help: false
  });
});

test("parses public and model options with quoted content", () => {
  assert.deepEqual(parseCommandText('--public --model "gpt-5.2" "review this code"'), {
    prompt: "review this code",
    responseType: "in_channel",
    model: "gpt-5.2",
    help: false
  });
});

test("supports escaped spaces and an end-of-options delimiter", () => {
  assert.deepEqual(parseCommandText("-- model\\ name --public"), {
    prompt: "model name --public",
    responseType: "ephemeral",
    model: undefined,
    help: false
  });
});

test("supports explicit ephemeral mode, help aliases, and equals-form model overrides", () => {
  assert.deepEqual(parseCommandText("--public --ephemeral --model=gpt-5.6 hello"), {
    prompt: "hello",
    responseType: "ephemeral",
    model: "gpt-5.6",
    help: false
  });
  assert.deepEqual(parseCommandText("-h"), {
    prompt: "",
    responseType: "ephemeral",
    model: undefined,
    help: true
  });
});

test("rejects unknown options and malformed quoting", () => {
  assert.throws(() => parseCommandText("--wat hello"), /Unknown option/);
  assert.throws(() => parseCommandText('"unterminated'), /Unterminated quoted string/);
  assert.throws(() => parseCommandText("trailing\\"), /Trailing escape character/);
  assert.throws(() => parseCommandText("--model <!channel> hello"), /--model must be/);
  assert.throws(() => parseCommandText(`--model ${"x".repeat(129)} hello`), /--model must be/);
  assert.throws(() => parseCommandText("--model="), /--model requires a value/);
});
