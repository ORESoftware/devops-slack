# SOPS dummy consumer pilot

This repository is an ORESoftware consumer-pilot for the organization SOPS dotenv contract.

## Scope

The pilot validates the application-facing behavior without committing any real secret material or durable pilot identity.

The canonical application ciphertext paths remain exactly:

- `env/enc/dev.env.enc`
- `env/enc/prod.env.enc`

Plaintext dotenv files are ignored at every depth. A selected local environment is exposed as a relative root symlink such as:

```text
.env -> env/dec/dev.env
```

## What CI proves

The `SOPS dummy consumer pilot` workflow:

1. checks out a pinned, audited `ORESoftware/ores-sops` commit;
2. generates a disposable age identity under the runner temporary directory, outside this repository;
3. creates runtime-only `.sops.yaml` rules and dummy dev/prod ciphertext;
4. removes plaintext, then activates dev through the managed relative root `.env` symlink;
5. runs `ores-sops verify` and checks the ignore/allowlist contract;
6. uses this application's actual `dotenv/config` loader to prove the root symlink is consumed correctly;
7. runs the existing unit and CLI end-to-end tests while the managed dummy environment is active;
8. builds the repository's normal `git archive`-based source artifact and rejects any archive containing root `.env` or `env/dec/**`;
9. removes managed plaintext and the temporary age identity in an always-run cleanup step.

Dummy values are deliberately non-sensitive. CI does not receive a development or production decryption identity.

## Not production adoption yet

This pilot intentionally does **not** commit:

- `.sops.yaml` with a real recipient policy;
- a private age identity;
- a real application credential;
- permanent dev/prod ciphertext.

Durable adoption comes only after the ORESoftware key-lifecycle work defines the real dev/prod recipient or KMS policies, protected CI identity, offboarding procedure, and recovery path.

The current application continues to read root `.env` through `dotenv/config`; the pilot changes how a safe local `.env` can be produced, not the runtime configuration precedence.

## Tracking

- ORESoftware SOPS parent: DEN-2636
- Platform / consumer pilot: DEN-2639
- Key lifecycle / recovery / rollout: DEN-2641
- Reference implementation: `ORESoftware/ores-sops`
