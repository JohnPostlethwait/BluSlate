# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Responses & Communication With the User

* Use succinct output language
* Succinctly answer direct questions
* Do not take action on direct questions until prompted to do so

## Build & Development Commands

This project requires Node.js 22 via nvm. Shell state resets between commands, so always bootstrap nvm first:

```bash
# Bootstrap nvm (required before any pnpm command)
source ~/.nvm/nvm.sh && nvm use 22

# Install dependencies
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate install

# Build everything (core must build before cli/gui can use it)
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate run build

# Build only core (required when core changes before running gui/cli)
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/core run build

# Run all tests
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate run test

# Run a single test file
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate exec vitest run tests/unit/batch-matcher.test.ts

# Run tests in watch mode
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate run test:watch

# Type checking across all packages
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate run typecheck

# Launch GUI in dev mode (builds core first, then starts Electron with hot reload)
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/core run build && pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/gui run dev

# Package GUI for distribution
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate run package:gui

# Install GUI to /Applications (must kill running instances, remove old app, and clear xattr to avoid macOS caching stale bundles)
pkill -f BluSlate 2>/dev/null; sleep 1; rm -rf /Applications/BluSlate.app && cp -R /Users/johnpostlethwait/Documents/workspace/BluSlate/packages/gui/release/mac-arm64/BluSlate.app /Applications/BluSlate.app && /usr/bin/xattr -cr /Applications/BluSlate.app

# Git commands (cwd resets, so use -C)
git -C /Users/johnpostlethwait/Documents/workspace/BluSlate status

# Version bumps — ALL package.json files must be updated together (root + packages/core, cli, gui, web)
# Creating release tags — MUST use annotated tags (lightweight tags do NOT trigger GitHub Actions push:tags)
git tag -a v0.x.x <commit> -m "Release v0.x.x"
git push origin v0.x.x
```

## Project Architecture

### Monorepo Structure (pnpm workspaces)

Three packages under `packages/`:

- **`@bluslate/core`** — Pure business logic, zero UI dependencies. Built with tsup to ESM. All matching, scoring, parsing, TMDb API, and pipeline orchestration lives here.
- **`@bluslate/cli`** — CLI frontend using Commander.js, ora (spinners), @inquirer/prompts, chalk. Implements `UIAdapter` for terminal interaction.
- **`@bluslate/gui`** — Electron desktop app using electron-vite + Svelte 5 (runes). Implements `UIAdapter` via IPC bridge.

### UIAdapter Pattern (Core Architectural Concept)

The core package defines a `UIAdapter` interface (`packages/core/src/types/ui-adapter.ts`) composed of three sub-interfaces:

- `ProgressReporter` — spinner/progress updates (start, update, succeed, fail, stop)
- `UserPrompter` — user confirmations (confirmRenames, confirmShowIdentification)
- `DisplayAdapter` — results display (displayResults, displaySummary)

The pipeline (`core/pipeline.ts`) accepts a `UIAdapter` and is completely UI-agnostic. Both the CLI (`cli/src/ui/cli-adapter.ts`) and GUI (`gui/src/main/gui-adapter.ts`) implement this interface. The GUI adapter bridges to the renderer via Electron IPC using request/response patterns for prompts.

### Two Matching Pipelines

`runPipeline()` in `core/pipeline.ts` selects between:

1. **Per-file pipeline** — When filenames are informative (e.g., "Show.Name.S01E03.mkv"). Parses filename → probes with ffprobe → searches TMDb → matches individually.

2. **Batch pipeline** — Activated when >70% of files have generic filenames (MakeMKV disc rips like "title_t00.mkv"). The flow is:
   - `groupFilesBySeason()` — Groups files by directory structure using `parseDirectoryContext()` to extract season/disc from folder names
   - `identifyShow()` — TMDb search + user confirmation (cached per show name)
   - `classifyAndSortFiles()` — Sorts by disc*1000+track, classifies as episode/extra/unknown using runtime thresholds relative to expected episode length
   - `matchSeasonBatch()` — Sequential greedy matcher: walks files and TMDb episodes in order, assigns by runtime proximity, handles multi-episode files, reclassifies poor matches as extras
   - `matchSpecialsBatch()` — Second pass: unmatched files + extras matched against Season 0 (Specials) by best-fit runtime with dual threshold (absolute ≤15min AND relative ≤20%)

### Batch Matcher Rules (IMPORTANT)

These rules are critical invariants. Violating them causes incorrect matches and misclassified files.

1. **Sequential track order is the default.** Blu-ray/DVD discs virtually always store episodes in sequential track order (t00→E1, t01→E2, ...). The matcher MUST preserve this order unless there is strong evidence of reversal.

2. **Never reverse tracks based on runtime alone when runtimes are uniform.** Shows like sitcoms (Seinfeld ~22min) and procedurals (TNG ~46min without DVDCompare) have nearly identical episode runtimes. The coefficient of variation (CV) guard in `detectAndApplyTrackOrder` prevents reversal when CV < 0.10. Only DVDCompare correlation with strong signal (>1.5x) or a cross-season hint can override this.

3. **Positional order dominates when runtime costs are close.** The greedy matcher sort uses a 1.0-minute tiebreaker: when two candidates' costs differ by ≤1.0 min, the one with smaller positional difference wins. This prevents tiny runtime deltas from scrambling sequential order. Do NOT reduce this threshold below 1.0 min.

4. **Never reclassify mid-sequence tracks as extras.** If tracks t00-t04 all have episode-length runtimes, they should all match to episodes. A mid-sequence track (e.g., t03) being pushed to extras/specials is a critical bug indicating the sort or reversal logic is wrong.

5. **Track reversal is a global per-release decision.** A physical disc release is mastered one way (all forward or all reverse). `detectAndApplyTrackOrder` applies the same decision to all discs. Per-disc reversal is NOT supported — it's one direction for the whole release.

6. **Three reversal signals in priority order:**
   - Cross-season hint (from previously matched season on same release)
   - Absolute cost difference (when runtimes vary enough: CV ≥ 0.10)
   - DVDCompare correlation (sub-second runtime pattern matching)
   When none provide strong evidence, default to forward.

7. **Outlier tracks with large track-number gaps are demoted before reversal detection AND matching.** When more episode-classified files exist than TMDb episodes, the matcher looks for gaps in track numbers (e.g., t00-t04 then t10). Files on the far side of the largest gap are reclassified as extras. This MUST run before reversal detection (Step 4) because: (a) gap detection requires ascending track order which reversal destroys, and (b) outlier tracks pollute the reversal cost/correlation analysis.

### Confidence Scoring

Two scoring systems in `core/scorer.ts`:

- `computeConfidence()` — Per-file mode: title similarity (Levenshtein), year match, season/episode match, runtime, probe metadata, search rank. Max 100.
- `computeBatchConfidence()` / `computeBatchConfidenceBreakdown()` — Batch mode: sequential position (+40) + runtime match (0-60) - multi-episode penalty (-15) - relative runtime penalty (-5/-10). The breakdown variant returns itemized `ConfidenceBreakdownItem[]` stored on `MatchResult.confidenceBreakdown`.

### GUI Architecture (Electron + Svelte 5)

- **Main process** (`gui/src/main/index.ts`) — Window management, IPC handlers, input validation, runs core pipeline
- **Preload** (`gui/src/preload/index.ts`) — Exposes typed `api` object via contextBridge (sandbox: true, context isolation)
- **Renderer** (`gui/src/renderer/`) — Svelte 5 with runes ($state, $derived). View states: setup → running → results → confirm → summary
- **GUI adapter** (`gui/src/main/gui-adapter.ts`) — Implements UIAdapter, bridges pipeline events to renderer via IPC
- Preload scripts MUST be CommonJS (sandboxed Electron requirement)
- `@bluslate/core` is aliased to source in electron.vite.config.ts for dev, built for production
- `externalizeDepsPlugin` in `electron.vite.config.ts` must exclude `@bluslate/core` so the alias works and core is bundled from source (not loaded from dist at runtime)

### Determining if the GUI is Running

**IMPORTANT**: Do NOT rely on background Task agent completion, shell exit codes, or log file EOF to determine if the Electron app is running. The `pnpm dev` process and the Electron app are separate — the dev server may show as "completed" while the Electron window is still open.

To check if the Electron GUI is actually running:
```bash
pgrep -f "electron" | head -5
# or
ps aux | grep -i electron | grep -v grep
```

If no Electron processes appear, the app is closed. If processes appear, the app is running. **Always ask the user** if unsure — they can see the window on their screen. Never assume the app has closed just because a background task finished.

### Testing

- vitest at monorepo root, tests in `tests/unit/`
- Tests import directly from source: `../../packages/core/src/` or `../../packages/cli/src/`
- `@bluslate/core` aliased in vitest.config.ts to source for resolution
- TMDb API calls in tests use vitest mocks (`vi.mock`)

### Key External Dependencies

- `@ctrl/video-filename-parser` — Parses structured filenames (S01E03 format). Known limitation: drops first episode from 3+ multi-episode chains.
- `ffprobe` (system binary) — Runtime probing for duration and embedded metadata. Gracefully degrades if not installed.

### Directory Context Parsing

`parseDirectoryContext()` in `core/directory-parser.ts` extracts season/disc from directory paths using `SEASON_DISC_PATTERNS`. Handles formats like "S1D2", "Season 1 Disc 2", "SHOW_BR_S1D1", "STAR TREK TNG S1 D3". Files not matching any pattern currently default to season 1.

`groupFilesBySeason()` groups files by `"showName::season"` key and sorts within groups by `filePath.localeCompare()`.

### Template System

`{show_name}`, `{title}`, `{year}`, `{season}`, `{episode}`, `{episode_title}`, `{ext}` — defined in `core/config/templates.ts`. Default: `{show_name} - S{season}E{episode} - {episode_title}`.
