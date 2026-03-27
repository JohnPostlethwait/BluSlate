# Contributing to BluSlate

## Prerequisites

- **Node.js** 22 via [nvm](https://github.com/nvm-sh/nvm)
- **pnpm** >= 10 ([installation](https://pnpm.io/installation))
- **ffprobe** (optional) — Install via [ffmpeg](https://ffmpeg.org/download.html)
- **TMDb API key** — Free Read Access Token at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

## Setup

```bash
git clone https://github.com/JohnPostlethwait/BluSlate.git
cd BluSlate
nvm use 22
pnpm install
pnpm run build
```

## Development

```bash
# Build all packages (core must build before cli/gui/web)
pnpm run build

# Build core only (required after core changes before running gui/cli)
pnpm --filter @bluslate/core run build

# Launch GUI in dev mode (hot reload)
pnpm --filter @bluslate/core run build && pnpm --filter @bluslate/gui run dev

# Run web server in dev mode (hot reload)
pnpm --filter @bluslate/core run build
TMDB_API_KEY=your-key MEDIA_ROOT=/path/to/media pnpm --filter @bluslate/web run dev

# Type check all packages
pnpm run typecheck
```

## Install CLI globally

```bash
pnpm --filter @bluslate/cli link --global
bluslate --version
```

## Package GUI for distribution

```bash
pnpm run package:gui
# Built artifacts appear in packages/gui/release/
```

## Testing

Tests use [vitest](https://vitest.dev/) with TMDb API calls mocked via `vi.mock`.

```bash
# Run all tests
pnpm run test

# Run a single test file
pnpm exec vitest run tests/unit/parser.test.ts

# Watch mode
pnpm run test:watch
```

### Test Conventions

- **Location:** all tests live in `tests/unit/`, one file per module
- **Imports:** import directly from source, not built output:
  ```ts
  import { foo } from '../../packages/core/src/core/foo.js';
  ```
- **Fixtures:** shared test data lives in `tests/fixtures/`. Add new fixture files there rather than inlining large data structures in test files.
- **Mocking:** TMDb and DVDCompare API calls must be mocked with `vi.mock`. Never make real network calls in tests.
- **Naming:** use plain English descriptions — `it('should match episodes sequentially by track order')` not `it('test1')`.
- **Invariants:** for batch matcher invariants (see CLAUDE.md), name the test after the invariant it enforces so failures are self-describing.

## Contributing

### Branching

Work on a feature branch off `master`. Keep PRs focused — one logical change per PR.

### Commit Messages

Use plain imperative sentences describing the *why*, not just the *what*:

```
Fix track reversal incorrectly triggering on uniform-runtime shows

Not: "Update batch-matcher.ts"
```

### Version Bumps

All four `package.json` files must be updated together (root + `packages/core`, `cli`, `gui`, `web`). Release tags must be annotated (lightweight tags do not trigger GitHub Actions):

```bash
git tag -a v0.x.x <commit> -m "Release v0.x.x"
git push origin v0.x.x
```

## Project Structure

```
BluSlate/
├── packages/
│   ├── core/    — Business logic (matching, scoring, TMDb/DVDCompare APIs, pipeline)
│   ├── cli/     — Terminal frontend (Commander.js, ora, inquirer)
│   ├── gui/     — Electron desktop app (Svelte 5, electron-vite)
│   └── web/     — Self-hosted web server (Fastify, Socket.IO, Svelte 5)
├── tests/
│   ├── unit/
│   └── fixtures/
├── package.json
├── vitest.config.ts
└── tsconfig.json
```

## Architecture

### Monorepo (pnpm workspaces)

- **`@bluslate/core`** — Pure business logic, zero UI dependencies. Built with tsup to ESM.
- **`@bluslate/cli`** — CLI frontend. Implements `UIAdapter` for terminal interaction.
- **`@bluslate/gui`** — Electron desktop app. Implements `UIAdapter` via IPC bridge.
- **`@bluslate/web`** — Self-hosted web server. Implements `UIAdapter` via Socket.IO.

### UIAdapter Pattern

The core pipeline (`core/pipeline.ts`) accepts a `UIAdapter` interface and is completely UI-agnostic. All frontends implement this interface:

- **`ProgressReporter`** — spinner/progress updates (start, update, succeed, fail, stop)
- **`UserPrompter`** — user confirmations (confirmRenames, confirmShowIdentification)
- **`DisplayAdapter`** — results display (displayResults, displaySummary)

### Matching Pipeline

`runPipeline()` always runs a single batch pipeline (`runBatchPipeline`). All inputs go through the same 7-phase flow regardless of filename structure:

1. **Group by season** — `groupFilesBySeason()` parses directory names to extract show, season, and disc.
2. **Identify shows** — `identifyShow()` searches TMDb; user confirms each unique show.
3. **DVDCompare lookup** — Searches DVDCompare for sub-second disc runtime data; user selects release.
4. **Probe files** — ffprobe on all files in parallel (concurrency 8). Gracefully skips on failure.
5. **Classify + match** — `classifyAndSortFiles()` then `matchSeasonBatch()` per season group, processed in season order so track-order detection from earlier seasons propagates forward.
6. **Match specials** — `matchSpecialsBatch()` matches leftover files against Season 0 (dual threshold: ≤15min AND ≤20%).
7. **Play All warnings** — Files whose runtime or size greatly exceeds the group median are flagged.

### Confidence Scoring

Batch scoring only (`core/scorer.ts`): sequential position (+40) + runtime match (0–60) − multi-episode penalty (−15) − relative runtime penalty (−5/−10). `computeBatchConfidenceBreakdown()` returns itemized `ConfidenceBreakdownItem[]` for display in the UI.

### GUI (Electron + Svelte 5)

- Main process: window management, IPC handlers, runs core pipeline
- Preload: exposes typed `api` via contextBridge (sandboxed, context isolation on)
- Renderer: Svelte 5 runes (`$state`, `$derived`). View states: setup → running → results → confirm → summary
- Preload scripts must be CommonJS (sandboxed Electron requirement)
- `@bluslate/core` is aliased to source in `electron.vite.config.ts` for dev, bundled for production
