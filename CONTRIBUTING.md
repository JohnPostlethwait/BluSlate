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

### Two Matching Pipelines

`runPipeline()` selects between:

1. **Per-file pipeline** — For informative filenames (e.g. `Show.Name.S01E03.mkv`). Parses filename → probes with ffprobe → searches TMDb → matches individually.

2. **Batch pipeline** — Activated when >70% of files have generic filenames (MakeMKV disc rips). Groups files by directory/season, identifies the show via TMDb, then matches by runtime and sequential position. A second pass matches unmatched files against Season 0 (Specials).

### Confidence Scoring

- **Per-file:** Title similarity (Levenshtein), year, season/episode match, runtime, probe metadata, search rank. Max 100.
- **Batch:** Sequential position (+40) + runtime match (0–60) − multi-episode penalty (−15) − relative runtime penalty (−5/−10).

### GUI (Electron + Svelte 5)

- Main process: window management, IPC handlers, runs core pipeline
- Preload: exposes typed `api` via contextBridge (sandboxed, context isolation on)
- Renderer: Svelte 5 runes (`$state`, `$derived`). View states: setup → running → results → confirm → summary
- Preload scripts must be CommonJS (sandboxed Electron requirement)
- `@bluslate/core` is aliased to source in `electron.vite.config.ts` for dev, bundled for production
