# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-28

### Fixed
- `node dist/cli.js` is no longer a silent no-op when invoked directly. The
  CLI now auto-runs when its module URL matches `process.argv[1]` (the bin
  shim continues to import and call `run()` itself).
- Keyword router now uses word-boundary matching, so `sql` no longer matches
  `MySQL`, `post` no longer matches `blog post`, and `get` no longer matches
  every English use of "get".
- Corrupt or unreadable `.session.json` no longer crashes the server; the
  session is logged once on stderr and reset.
- `appendLines` now deduplicates against existing bullets before writing,
  preventing the same fact from being appended twice on retry.

### Changed
- Default `api` keywords tightened: bare HTTP verbs (`get`, `post`, `delete`,
  `patch`) replaced with their `* request` forms; added `graphql`, `webhook`,
  `https`. Configure your own list via `ctx-flow.config.json` if you need the
  old behavior back.
- `startServer()` now emits a one-line stderr warning when the configured
  `contextDir` does not exist or has no `goals.md`/`domains/` — the previous
  behavior silently returned empty context.
- Added a `prepare` script so installs from a git URL build automatically.

### Added
- Direct unit tests for `handleInject`, `handleUpdate`, `handleReset`, and
  the corrupt-session recovery path.
- Tests for `loadConfig` env-var precedence and caching.
- Regression tests for word-boundary keyword matching and `appendLines` dedup.

## [1.1.0] - 2026-04-28

### Added
- `ctx-flow` CLI binary with `init`, `mcp`, `--version`, `--help` subcommands.
- `ctx-flow init` scaffolds a `context/` directory in any project.
- `ctx-flow.config.json` support for per-project configuration:
  - `contextDir` — relocate the context directory.
  - `tokenThreshold` — override the auto-compression trigger.
  - `keywordMap` — extend or replace the intent router keywords without editing source.
  - `haikuModel` — pin a specific Haiku model version.
- `CTX_FLOW_CONFIG` and `CTX_FLOW_CONTEXT_DIR` environment variables.
- Vitest test suite covering the intent router, compressor, file manager, and CLI.
- GitHub Actions CI workflow (build + typecheck + tests on Node 20 and 22).
- Prettier formatting config and `format` / `format:check` scripts.
- `prepublishOnly` script that gates `npm publish` on typecheck + tests + build.
- LICENSE file (MIT) and CHANGELOG.

### Changed
- `src/index.ts` no longer auto-starts the MCP server on import; consumers call
  the exported `startServer()` instead. The `ctx-flow` CLI is the new
  entry point for running the server.
- The session file (`.session.json`) now lives under the configured
  `contextDir` rather than alongside the build output.

### Fixed
- Hardcoded paths relative to `dist/` that broke when the package was installed
  from npm rather than cloned.

## [1.0.0] - 2026-04-26

### Added
- Initial release of ctx-flow MCP plugin.
- `ctx_inject`, `ctx_update`, `ctx_reset`, `ctx_write_fact` MCP tools.
- Two-tier intent router (keyword match + Haiku fallback).
- Structured conversation summarizer with incremental merge.
- Auto-extraction of facts into domain files via Haiku.
