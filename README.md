# slack-ores-integrations

Config-driven Slack slash commands for the `alex-main-agent` Slack app (`A0BMBAMM5NJ`) in workspace `T01B3C83PMK`.

## Commands

| Command | Provider | Profile |
| --- | --- | --- |
| `/x-claude` | Anthropic | X |
| `/x-chatgpt` | OpenAI | X |
| `/ores-claude` | Anthropic | ORES engineering |
| `/ores-chatgpt` | OpenAI | ORES engineering |
| `/my-claude` | Anthropic | Personal |
| `/my-chatgpt` | OpenAI | Personal |

Every command accepts:

- `--public` to post the final answer in-channel; responses are ephemeral by default.
- `--model MODEL` to override the provider's configured model for one invocation.
- `--help` to show usage without calling a provider.
- `--` to stop parsing options when the prompt itself starts with `--`.

Example:

```text
/ores-chatgpt --public --model gpt-5.6 audit this deployment plan for failure modes
```

By default, the app also supplies up to five recent human-authored messages from the current Slack
conversation as background context. Authors, Slack IDs, bot messages, system events, and recognizable
credential formats are removed before this context is sent to a provider. The current slash-command
request is kept separate, and the history is explicitly marked as untrusted quoted data to reduce
prompt-injection risk. Retrieval follows at most `SLACK_CONTEXT_MAX_PAGES` cursors and applies
`SLACK_CONTEXT_FETCH_TIMEOUT_MS` to each page. Set `SLACK_CONTEXT_MESSAGE_COUNT=0` to disable this
behavior. See [bounded Slack context retrieval](docs/slack-context-retrieval.md) for the full contract.

The current command text is also scanned before provider processing. Recognizable provider, Slack,
GitHub, bearer, and configured environment credentials are replaced with redaction markers, and the
Slack response states when this occurred. See [credential-like command text](docs/prompt-secret-redaction.md).

## Local setup

The app uses Slack Socket Mode, so local development does not require a public request URL.

```bash
cd ~/codes/ores/slack-ores-integrations
cp .env.example .env
npm install
```

Set `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and at least one provider API key in `.env`.

Install and authenticate the Slack CLI if needed:

```bash
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
slack login
```

Link this project to the existing app and workspace, then run it:

```bash
slack app link --app A0BMBAMM5NJ --team T01B3C83PMK
slack manifest validate --app A0BMBAMM5NJ
slack run --app A0BMBAMM5NJ --team T01B3C83PMK
```

Review the manifest diff before allowing the CLI to update the existing app configuration.

## App tokens and scopes

The manifest requests these bot scopes:

- `commands`
- `chat:write`
- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`

Socket Mode also requires an app-level token with `connections:write`. Do not commit any token.
The history scopes are used only to load bounded context for conversations the bot can access. After
adding these scopes to an existing installation, reinstall the app in the workspace so Slack grants
the new permissions.

## Add another command

1. Add one entry to `config/commands.json`.
2. Reuse or add a profile in `config/profiles.json` and `agents/`.
3. Run `npm run manifest:generate`.
4. Run `npm run test:all`.
5. Run `slack manifest validate` and apply the manifest to the linked app.

The runtime registers every command from the same JSON file used to generate `manifest.json`, preventing drift between Slack configuration and code.

## HTTP mode

For a deployed HTTP receiver, set:

```dotenv
SLACK_SOCKET_MODE=false
SLACK_SIGNING_SECRET=...
PORT=3000
```

Then configure each slash command request URL in Slack. Socket Mode remains the default and is the expected path for `slack run`.

## Safety and operations

- Provider calls time out after `AGENT_TIMEOUT_MS`.
- Optional provider base URLs must be HTTP(S), cannot embed credentials, and are validated before startup.
- Prompt and response sizes are capped.
- Active and queued work are bounded by a fair global semaphore; saturated commands receive a retry response instead of growing memory without limit.
- Per-user concurrency and queue caps prevent one Slack user from monopolizing all global capacity.
- Queued commands expire after `MAX_QUEUE_WAIT_MS` so stale work cannot wait indefinitely.
- Slack retries are deduplicated by `trigger_id` with a bounded TTL map, preventing duplicate provider charges.
- Shutdown rejects new commands and drains in-flight work for `SHUTDOWN_GRACE_MS` before stopping Bolt.
- Optional Slack user/channel allowlists are supported.
- Optional per-provider model allowlists prevent arbitrary model overrides.
- Public channel responses can be disabled with `ALLOW_PUBLIC_RESPONSES=false`.
- Slack team, channel, and user IDs are excluded from provider prompts by default; opt in only with `INCLUDE_SLACK_IDENTIFIERS_IN_PROMPT=true`.
- Up to `SLACK_CONTEXT_MESSAGE_COUNT` recent human-authored messages are cached per enterprise/workspace/channel for `SLACK_CONTEXT_CACHE_TTL_MS`, redacted, stripped of author identifiers, bounded by `SLACK_CONTEXT_MAX_CHARS`, and supplied as untrusted context. Set the count to `0` to disable external sharing of channel history.
- Context retrieval follows at most `SLACK_CONTEXT_MAX_PAGES` cursors, applies `SLACK_CONTEXT_FETCH_TIMEOUT_MS` to each page, rejects cursor loops and malformed pagination, and never caches a successful prefix when a later page fails.
- Concurrent context lookups for the same enterprise/workspace/channel are coalesced, and the context cache is LRU-bounded by `SLACK_CONTEXT_CACHE_MAX_ENTRIES`.
- Missing history scopes, inaccessible conversations, history deadlines, and Slack history API failures degrade to a context-free provider request instead of failing the slash command.
- Credential-like values in the current command are redacted before provider processing; completion telemetry records only a boolean and the Slack response discloses that redaction occurred.
- API errors are sanitized before being shown to users, and structured logs redact known token formats and configured secrets.
- Generated Slack user, group, channel, and broadcast mention markup is neutralized before posting.
- Link and media unfurls are disabled on model-generated public channel messages so Slack does not crawl arbitrary generated URLs.
- OpenAI Responses requests set `store: false`.
- Configuration rejects duplicate commands, unknown fields, invalid values, unsupported log levels, and profile path traversal.
- Direct npm dependencies are exact-version pinned and CI enforces that policy. GitHub Actions are pinned to immutable commit SHAs.

## Tests

Unit tests live in `test/`.

CLI E2E tests live in `tests/e2e/cli/`. They execute all six commands as subprocesses through the real parser, access checks, router, semaphore, response chunking, Slack context retrieval, and Slack response handler with deterministic provider and Slack API doubles.

Browser E2E tests live in `tests/e2e/browser/` and drive a local command console through:

- Playwright
- Puppeteer
- Selenium WebDriver

The browser suites cover private and public command paths, multi-page Slack context, model overrides, help output, provider failures, credential redaction, output injection safety, strict browser security headers, and public-response policy enforcement. Each driver runs as an independent GitHub Actions job. Screenshots and Playwright traces are written to `tests/e2e/artifacts/`.

Run the suites with:

```bash
npm run test:unit
npm run test:e2e:cli
E2E_BROWSER_PATH=/usr/bin/chromium npm run test:e2e:browser
npm run test:all
```

The local E2E harness does not call live AI providers or modify the Slack workspace. Live Slack validation remains a separate smoke test using the linked app and real workspace credentials.

## GitHub Actions

CI runs:

- unit, CLI E2E, manifest, syntax, and lint checks on Node.js 22 and 24;
- independent Playwright, Puppeteer, and Selenium jobs against the Chrome and ChromeDriver preinstalled on GitHub-hosted runners;
- a high-severity production dependency audit;
- browser screenshots and traces as workflow artifacts.

Dependabot is configured for npm and GitHub Actions updates. Workflow policy tests reject mutable action tags.

A full transitive `package-lock.json` should be generated and committed from a trusted npm registry before production deployment; do not synthesize one without registry metadata.
