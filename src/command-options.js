const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function validateModel(model) {
  if (!modelPattern.test(model)) {
    throw new Error(
      "--model must be 1-128 characters using letters, numbers, dot, underscore, colon, slash, or hyphen"
    );
  }
  return model;
}

function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote;
  let escaped = false;
  let tokenStarted = false;

  const flush = () => {
    if (!tokenStarted) return;
    tokens.push(current);
    current = "";
    tokenStarted = false;
  };

  for (const character of input) {
    if (escaped) {
      current += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      tokenStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      flush();
      continue;
    }

    current += character;
    tokenStarted = true;
  }

  if (escaped) throw new Error("Trailing escape character");
  if (quote) throw new Error("Unterminated quoted string");
  flush();
  return tokens;
}

export function parseCommandText(text) {
  const tokens = tokenize(text.trim());
  const promptTokens = [];
  let responseType = "ephemeral";
  let model;
  let help = false;
  let parseOptions = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && (token === "--public" || token === "--in-channel")) {
      responseType = "in_channel";
      continue;
    }
    if (parseOptions && token === "--ephemeral") {
      responseType = "ephemeral";
      continue;
    }
    if (parseOptions && (token === "--help" || token === "-h")) {
      help = true;
      continue;
    }
    if (parseOptions && token === "--model") {
      const next = tokens[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--model requires a value");
      model = validateModel(next);
      index += 1;
      continue;
    }
    if (parseOptions && token.startsWith("--model=")) {
      model = token.slice("--model=".length);
      if (!model) throw new Error("--model requires a value");
      model = validateModel(model);
      continue;
    }
    if (parseOptions && token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    }
    promptTokens.push(token);
  }

  return {
    prompt: promptTokens.join(" ").trim(),
    responseType,
    model,
    help
  };
}
