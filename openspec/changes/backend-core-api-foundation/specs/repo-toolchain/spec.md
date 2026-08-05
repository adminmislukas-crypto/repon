# repo-toolchain Specification

## Purpose

Monorepo toolchain that makes `core-api` and `@repon/types` buildable, lintable, and testable. First code-bearing infra in the repo; establishes the gate the other 6 capabilities run inside.

## Requirements

### Requirement: pnpm workspace at repo root

The repo MUST have a root `package.json` and `pnpm-workspace.yaml` covering `apps/*`, `services/*`, `packages/*`. No Turborepo/Nx (D1) — build orchestration stays pnpm-native for this change.

#### Scenario: Fresh clone installs in one command

- GIVEN a clean checkout with only `pnpm-lock.yaml` committed
- WHEN `pnpm install` runs at repo root
- THEN all workspace packages (`@repon/types`, `core-api`) resolve without a separate per-package install

### Requirement: Node 24.x pinned in two places

`.tool-versions` MUST gain a `nodejs 24.x` line and `.nvmrc` MUST be added at repo root (D4), both pinning the same major version.

#### Scenario: Pin mismatch is a review-catchable diff

- GIVEN `.tool-versions` and `.nvmrc`
- WHEN either is read
- THEN both resolve to the same Node 24.x version

### Requirement: Shared TypeScript base config

`tsconfig.base.json` MUST exist at repo root with `strict: true`; every workspace package's `tsconfig.json` MUST extend it.

#### Scenario: A workspace package cannot opt out of strict mode

- GIVEN `services/core-api/tsconfig.json`
- WHEN it is inspected
- THEN it extends `tsconfig.base.json` and does not override `strict`

### Requirement: Lint and format are enforced, not advisory

ESLint and Prettier MUST be configured at root and MUST run as a CI step that fails the build on violation.

#### Scenario: A lint violation fails CI

- GIVEN a PR introducing an unused import
- WHEN CI runs
- THEN the lint step exits non-zero and the PR shows as failing

### Requirement: Test runner is present and wired to CI

Jest (`@nestjs/testing`, `supertest`) MUST be configured for `core-api` and MUST run in CI.

#### Scenario: pnpm test is the single entrypoint

- GIVEN a developer or CI runner
- WHEN `pnpm test` runs at repo root
- THEN it executes every workspace package's test suite and exits non-zero on any failure

### Requirement: CI gate covers install through build

`.github/workflows/ci.yml` MUST run install → lint → typecheck → test → build on every PR, each step gating the next.

#### Scenario: A failing typecheck blocks a passing test suite from turning the PR green

- GIVEN a PR with a type error but passing tests
- WHEN CI runs
- THEN the typecheck step fails and the workflow reports failure regardless of the test step

### Requirement: strict_tdd flips only after the suite is green

Per D7, `openspec/config.yaml` MUST keep `strict_tdd: false` until `pnpm test` is verified green end-to-end; flipping to `strict_tdd: true` with real commands MUST be the last task of this change, not a precondition.

#### Scenario: Flip happens after, not before

- GIVEN slices 0-5 are merged and `pnpm test` passes locally and in CI
- WHEN the final task of this change runs
- THEN `openspec/config.yaml` is updated to `strict_tdd: true` with real `test_command`/`build_command`/`lint_command`/`typecheck_command`
