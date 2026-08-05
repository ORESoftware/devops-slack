# Source artifact publication

The CI workflow publishes commit-addressed source artifacts for every pull request, every push to the
repository's real default branch (`master`), matching `v*` tags, and manual workflow dispatches.

## Artifact contents

The `source artifacts` job produces:

- `slack-ores-integrations-<version>-<short-sha>.tar.gz` — a `git archive` of tracked files at the
  exact workflow commit;
- `slack-ores-integrations-<version>-<short-sha>-slack-manifest.json` — the generated Slack app
  manifest as a standalone deployment input;
- `slack-ores-integrations-<version>-<short-sha>-metadata.json` — full commit/tree SHAs, commit
  timestamp, GitHub ref, and source repository metadata; and
- `SHA256SUMS` — SHA-256 digests for the three files above.

The archive is built from tracked files only. It excludes the Git database, `node_modules`, local
`.env` files, and any other untracked workstation state. A full-history Git bundle is intentionally
not published because historical commits have a wider secret-exposure surface than the reviewed
source tree at one commit.

## Local generation

```bash
npm run artifacts:build
sha256sum -c dist/SHA256SUMS
```

Set `ARTIFACT_DIR` to write somewhere other than `dist/`.

## Verification

Before deployment:

1. verify `SHA256SUMS`;
2. compare the metadata commit to the reviewed and merged GitHub commit;
3. validate the standalone manifest with the Slack CLI;
4. unpack the source archive into a clean directory; and
5. run the normal dependency, manifest, syntax, lint, unit, CLI E2E, and browser checks.

GitHub retains each uploaded artifact set for 30 days. Release tags trigger the same artifact job,
but creating a permanent GitHub Release remains a separate, explicit publishing decision.
