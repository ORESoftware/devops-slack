# Bounded Slack context retrieval

The slash-command runtime can include recent human-authored Slack messages as untrusted background
context. Retrieval is intentionally bounded before any text reaches an external model provider.

## Retrieval contract

For each enterprise/workspace/channel key, the runtime:

1. checks the TTL/LRU cache and coalesces concurrent reads;
2. calls `conversations.history` with a bounded page size;
3. follows at most `SLACK_CONTEXT_MAX_PAGES` cursors;
4. gives each history page at most `SLACK_CONTEXT_FETCH_TIMEOUT_MS` milliseconds;
5. rejects malformed metadata, missing cursors, and repeated cursor loops;
6. removes bots, system events, author identifiers, Slack IDs, and recognizable credentials;
7. deduplicates overlapping pages by Slack message timestamp;
8. caches only after the bounded retrieval finishes successfully; and
9. degrades to a context-free provider request when Slack history is unavailable.

The defaults cap retrieval at three pages with a ten-second deadline per page. Set
`SLACK_CONTEXT_MESSAGE_COUNT=0` to disable Slack history sharing entirely.

## Failure behavior

A timeout or pagination error does not fail the slash command. The runtime logs a sanitized
`slack_context_unavailable` event and invokes the provider with only the current command. Successful
messages from an earlier page are not cached when a later page fails, so a subsequent command can
retry cleanly.

The timeout releases the admitted command path; it does not persist or expose the Slack request body,
channel text, API tokens, or cursors.

## Test coverage

- Unit tests cover multi-page collection, chronological ordering, duplicate timestamps, page caps,
  malformed metadata, cursor loops, page failures, deadlines, retry recovery, and no partial cache.
- CLI E2E tests prove paginated context reaches the real command/router path and deadline failures
  remain fail-open.
- Playwright, Puppeteer, and Selenium each exercise a bot-only first page followed by human context on
  a second page in GitHub Actions.
