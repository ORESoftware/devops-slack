import { once } from "node:events";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createCommandHarness } from "../support/command-harness.mjs";

const maxBodyBytes = 64 * 1024;
const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; "),
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slack ORES E2E Console</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <h1>Slack ORES command console</h1>
    <form id="command-form">
      <label for="command">Command</label>
      <select id="command" name="command" required></select>

      <label for="prompt">Prompt</label>
      <textarea id="prompt" name="prompt"></textarea>

      <label for="model">Model override</label>
      <input id="model" name="model" type="text" />

      <label class="inline"><input id="public" name="public" type="checkbox" /> Post publicly</label>
      <button id="submit" type="submit" disabled>Invoke command</button>
    </form>

    <h2>Slack response</h2>
    <pre id="result" aria-live="polite"></pre>
    <h2>Public channel transcript</h2>
    <pre id="public-transcript"></pre>

    <script type="module" src="/app.js"></script>
  </body>
</html>`;

const css = String.raw`body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 760px; }
label { display: block; margin-top: 1rem; font-weight: 600; }
select, textarea, input[type="text"] { box-sizing: border-box; width: 100%; padding: .7rem; }
textarea { min-height: 8rem; }
button { margin-top: 1rem; padding: .7rem 1.2rem; }
pre { white-space: pre-wrap; border: 1px solid #aaa; padding: 1rem; min-height: 3rem; }
.inline { display: flex; gap: .5rem; align-items: center; font-weight: 400; }`;

const clientScript = String.raw`const commandSelect = document.querySelector("#command");
const result = document.querySelector("#result");
const transcript = document.querySelector("#public-transcript");
const submit = document.querySelector("#submit");

try {
  const response = await fetch("/api/commands");
  if (!response.ok) throw new Error("HTTP " + response.status);
  const commands = await response.json();
  for (const command of commands) {
    const option = document.createElement("option");
    option.value = command;
    option.textContent = command;
    commandSelect.append(option);
  }
  submit.disabled = commands.length === 0;
} catch (error) {
  result.textContent = "Unable to load commands: " + error.message;
}

document.querySelector("#command-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  result.textContent = "Working…";
  transcript.textContent = "";
  const prompt = document.querySelector("#prompt").value.trim();
  const model = document.querySelector("#model").value.trim();
  const isPublic = document.querySelector("#public").checked;
  const flags = [isPublic ? "--public" : "", model ? "--model " + JSON.stringify(model) : ""]
    .filter(Boolean)
    .join(" ");
  const text = [flags, prompt].filter(Boolean).join(" ");
  try {
    const response = await fetch("/api/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandName: commandSelect.value, text })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "HTTP " + response.status);
    result.textContent = payload.finalResponse;
    transcript.textContent = payload.publicTranscript;
  } catch (error) {
    result.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});`;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
  }
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "Content-Type must be application/json");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw new RequestError(413, "Request body is too large");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new RequestError(400, "Request body must contain valid JSON");
  }
}

function validateInvocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "Invocation must be a JSON object");
  }

  const allowedKeys = new Set(["commandName", "text", "userId", "channelId"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new RequestError(400, `Unknown invocation field: ${key}`);
  }

  if (typeof value.commandName !== "string" || !/^\/[a-z0-9-]{1,63}$/.test(value.commandName)) {
    throw new RequestError(400, "commandName must be a slash command");
  }
  if (value.text !== undefined && (typeof value.text !== "string" || value.text.length > 64_000)) {
    throw new RequestError(400, "text must be a string no longer than 64000 characters");
  }
  for (const field of ["userId", "channelId"]) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" || !/^[A-Z0-9_-]{1,128}$/i.test(value[field]))
    ) {
      throw new RequestError(400, `${field} is invalid`);
    }
  }

  return value;
}

function writeHeaders(response, contentType) {
  response.writeHead(response.statusCode, {
    ...securityHeaders,
    "content-type": contentType
  });
}

function sendText(response, status, contentType, body) {
  response.statusCode = status;
  writeHeaders(response, contentType);
  response.end(body);
}

function sendJson(response, status, body) {
  sendText(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

export async function startHarnessServer(options = {}) {
  const harness = createCommandHarness(options);
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        sendText(response, 200, "text/html; charset=utf-8", html);
        return;
      }
      if (request.method === "GET" && request.url === "/app.css") {
        sendText(response, 200, "text/css; charset=utf-8", css);
        return;
      }
      if (request.method === "GET" && request.url === "/app.js") {
        sendText(response, 200, "text/javascript; charset=utf-8", clientScript);
        return;
      }
      if (request.method === "GET" && request.url === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && request.url === "/api/commands") {
        sendJson(response, 200, harness.commands);
        return;
      }
      if (request.method === "POST" && request.url === "/api/invoke") {
        const body = validateInvocation(await readJson(request));
        sendJson(response, 200, await harness.invoke(body));
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof RequestError ? error.statusCode : 400;
      sendJson(response, status, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Harness server did not bind to TCP");
  }

  let closed = false;
  return {
    harness,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      const closeEvent = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closeEvent;
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startHarnessServer();
  process.stdout.write(`${server.url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await server.close();
      process.exitCode = 0;
    });
  }
}
