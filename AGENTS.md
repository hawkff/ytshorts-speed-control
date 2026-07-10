# Agent / contributor notes

This is an MV3 browser extension (Chrome + Firefox) that controls YouTube
playback speed. Plain JavaScript with JSDoc, Deno for all tooling, and
deliberately **no build step** — the files in the repo are the files that ship.
Read this before changing anything; several invariants here are invisible until
violated.

## Commands

| Task    | Command             | Notes                                                          |
| ------- | ------------------- | -------------------------------------------------------------- |
| Test    | `deno task test`    | Runs `deno test` over `tests/`                                 |
| Check   | `deno task check`   | `deno fmt --check` + `deno lint` + type-check + tests          |
| Package | `deno task package` | Builds Chrome + Firefox ZIPs into `dist/`; needs `zip` on PATH |

CI (`.github/workflows/ci.yml`) runs `deno task --frozen check` on Deno v2.9.2.
There is no Node, no `node_modules`, no bundler.

## Architecture invariants

- **No-build, classic-script libs**: `lib/speed.js` and `lib/settings.js` are
  IIFEs that attach their APIs to `globalThis` (`YTShortsSpeed`,
  `YTShortsSettings`). MV3 classic content scripts cannot use ES modules without
  a bundler, and the exact same files are side-effect-imported by the Deno
  tests. Any new shared code must follow the same pattern.
- **Two manifests, one definition**: `manifest.json` (Chrome) and
  `manifest.firefox.json` must be identical except for
  `browser_specific_settings` in the Firefox file. `tests/manifest_test.js`
  enforces this. Every manifest change goes in BOTH files.
- **Version bumps**: `version` must match across both manifests (enforced by
  tests and by `scripts/package.ts`, which refuses mismatched or non-`x.y.z`
  versions). Release artifacts come from `deno task package`.
- **Shipped-file list**: the `sharedFiles` array in `scripts/package.ts`
  enumerates every file that goes into the ZIPs. A new runtime file (a new
  `lib/` module, an icon, ...) MUST be added there or it silently does not ship.

## Test harness invariants

`tests/helpers/content_harness.js` and `tests/helpers/popup_harness.js`
re-import the real scripts via a fixed pool of literal
`import("...?content-harness=N")` / `import("...?popup-harness=N")` specifiers,
because Deno only grants permission-free dynamic import to statically visible
specifiers.

- Every test that calls `startContentScript()` or `startPopup()` consumes one
  pool entry.
- Current pool sizes: 32 (content), 24 (popup).
- Adding tests may require growing the pool by appending more literal entries.
  The failure mode is explicit: `content harness literal import pool exhausted`
  (or `popup harness literal import pool exhausted`).

## Conventions

- Plain JS + JSDoc; no TypeScript in runtime code (`scripts/package.ts` is the
  only TS file, run under Deno).
- Every source file carries the AGPL header comment: `Copyright (C) 2026 hawkff`
  plus `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Formatting is `deno fmt` house style; `fmt.include` in `deno.json` enumerates
  the formatted paths — add new top-level files there.
- Tests use `Deno.test` with `try`/`finally` and `await env?.restore()` to tear
  down harness state.

## Before you commit

- `deno task check` must exit 0 — it is the single gate (fmt, lint, type-check,
  tests).
- If you touched a manifest: update both `manifest.json` and
  `manifest.firefox.json` together.
- If you added a shipped file: add it to `sharedFiles` in `scripts/package.ts`.
- If you added tests that start the content script or popup: check the harness
  import pools have enough entries.

## Releasing

1. Bump `version` in BOTH `manifest.json` and `manifest.firefox.json`.
2. `deno task check`.
3. Commit, then tag: `git tag v<version> && git push origin v<version>`.
4. The Release workflow builds the ZIPs and publishes a GitHub Release. The tag
   must equal the manifest version or the workflow fails.
