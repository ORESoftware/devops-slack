# Agent guidance

- Keep `config/commands.json` as the single source of truth for slash-command registration.
- Run `npm run manifest:generate` after changing commands.
- Never commit Slack, OpenAI, or Anthropic tokens.
- Acknowledge Slack commands before starting provider work.
- Keep provider-specific code behind `src/providers/` and cover reusable parsing/routing logic with unit tests.
- Keep deterministic browser E2E coverage in `tests/e2e/browser/` for Playwright, Puppeteer, and Selenium.
- Keep subprocess and Slack CLI coverage in `tests/e2e/cli/`.
- Keep direct npm dependency versions exact and keep every GitHub Action pinned to a full 40-character commit SHA.
- Preserve bounded global and per-user concurrency, bounded queueing, Slack retry deduplication, and graceful in-flight command draining during shutdown.
- Run `npm run test:all` before publishing changes; browser diagnostics belong only in ignored `tests/e2e/artifacts/`.
