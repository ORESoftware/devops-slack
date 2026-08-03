# Credential-like command text

Before a slash-command prompt reaches OpenAI or Anthropic, the runtime replaces recognizable API
keys, Slack tokens, GitHub tokens, bearer values, and configured process secrets with bounded
redaction markers.

The command still runs, but the final Slack response includes a notice that credential-like text was
redacted before provider processing. Completion telemetry records only `promptRedacted: true|false`;
it never records the prompt or the matched value.

This is a containment control, not a substitute for credential rotation. Any real credential pasted
into Slack, chat, a terminal transcript, an issue, or a pull request must be revoked or rotated.
