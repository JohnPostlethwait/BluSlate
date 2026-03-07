# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Responses & Communication With the User

* Use succinct output language
* Succinctly answer direct questions
* Do not take action on direct questions until prompted to do so

## Background Tasks

* Only run commands in the background (`run_in_background`) when they are genuinely long-lived (e.g. a dev server that must stay running)
* Short-lived commands — git operations, builds, tests, one-off scripts — MUST run in the foreground so output is captured immediately

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

# Launch web server in dev mode (builds core first, then starts Fastify with file watching)
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/core run build && pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/web run dev

# Build web package for production/Docker
pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/core run build && pnpm --dir /Users/johnpostlethwait/Documents/workspace/BluSlate --filter @bluslate/web run build

# Git commands (cwd resets, so use -C)
git -C /Users/johnpostlethwait/Documents/workspace/BluSlate status

# Version bumps — ALL package.json files must be updated together (root + packages/core, cli, gui, web)
# Creating release tags — MUST use annotated tags (lightweight tags do NOT trigger GitHub Actions push:tags)
git tag -a v0.x.x <commit> -m "Release v0.x.x"
git push origin v0.x.x
```

## Project Architecture

### Monorepo Structure (pnpm workspaces)

Four packages under `packages/`:

- **`@bluslate/core`** — Pure business logic, zero UI dependencies. Built with tsup to ESM. All matching, scoring, parsing, TMDb API, and pipeline orchestration lives here.
- **`@bluslate/cli`** — CLI frontend using Commander.js, ora (spinners), @inquirer/prompts, chalk. Implements `UIAdapter` for terminal interaction.
- **`@bluslate/gui`** — Electron desktop app using electron-vite + Svelte 5 (runes). Implements `UIAdapter` via IPC bridge.
- **`@bluslate/web`** — Self-hosted web server using Fastify + Socket.IO + Svelte 5. Implements `UIAdapter` via WebSocket bridge. Deployable via Docker.

### UIAdapter Pattern (Core Architectural Concept)

The core package defines a `UIAdapter` interface (`packages/core/src/types/ui-adapter.ts`) composed of three sub-interfaces:

- `ProgressReporter` — spinner/progress updates (start, update, succeed, fail, stop)
- `UserPrompter` — user confirmations (confirmRenames, confirmShowIdentification)
- `DisplayAdapter` — results display (displayResults, displaySummary)

The pipeline (`core/pipeline.ts`) accepts a `UIAdapter` and is completely UI-agnostic. The CLI (`cli/src/ui/cli-adapter.ts`), GUI (`gui/src/main/gui-adapter.ts`), and Web (`web/src/server/web-adapter.ts`) each implement this interface. The GUI adapter bridges via Electron IPC; the Web adapter bridges via Socket.IO request/response patterns.

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

#### Physical Disc Invariants

1. **A disc contains only episodes from one season.** Discs never cross season boundaries. If more files are present than TMDb has episodes for the season, the excess are extras or playlist files — never assigned to a different season.

2. **Season assignment comes from the directory name only — never from DVDCompare.** `parseDirectoryContext()` determines which season a group of files belongs to. DVDCompare data is used ONLY to amend episode runtime precision (sub-second matching). DVDCompare MUST NOT influence season assignment.
   - `parseDirectoryContext()` MUST correctly parse all real-world directory naming conventions. If it fails to extract a season number, files default to season=1 and all seasons collapse into one group — a silent, catastrophic grouping failure that causes the matcher to produce completely wrong output.
   - Known required formats: numeric (`Season 1 Disc 2`, `S1D2`), word-form ordinals (`Season One`, `Season Two` … `Season Twelve`), parenthesized disc (`Season Two (Disc 1)`), and show-name prefixed variants of all the above (`Mr. Robot- Season Two (Disc 1)`).

3. **Episodes on a disc are always a contiguous subset of the season's episode list.** If Disc 1 covers episodes 1–5 and Disc 2 has 6 files, those 6 files fill the next available sequential slots (6–11). The disc-range constraint in `matchSeasonBatch` enforces this: each disc maps to a proportional episode window and cannot reach outside it.

4. **Episode sets on a disc are sequential (or reverse-sequential).** Files on a disc always cover a consecutive episode range relative to the other discs. Track order within a disc may be forward or reversed, but the combined set across all discs fills the season contiguously.

5. **Never skip files — prefer a lower-confidence match over no match.** If a file's runtime is within the acceptable threshold for any remaining episode slot, it must be matched (possibly with a lower confidence score). Skipping an episode-classified file when unmatched episode slots remain is a critical bug.

#### Track-Level Matching Invariants

6. **Sequential track order is the default.** Blu-ray/DVD discs virtually always store episodes in sequential track order (t00→E1, t01→E2, ...). The matcher MUST preserve this order unless there is strong evidence of reversal.

7. **Never reverse tracks based on runtime alone when runtimes are uniform.** Shows like sitcoms (Seinfeld ~22min) and procedurals (TNG ~46min without DVDCompare) have nearly identical episode runtimes. The coefficient of variation (CV) guard in `detectAndApplyTrackOrder` prevents reversal when CV < 0.10. Only DVDCompare correlation with strong signal (>1.5x) or a cross-season hint can override this.

8. **Positional order dominates when runtime costs are close.** The greedy matcher sort uses a 1.0-minute tiebreaker: when two candidates' costs differ by ≤1.0 min, the one with smaller positional difference wins. This prevents tiny runtime deltas from scrambling sequential order. Do NOT reduce this threshold below 1.0 min.

9. **Never reclassify mid-sequence tracks as extras.** If tracks t00-t04 all have episode-length runtimes, they should all match to episodes. A mid-sequence track (e.g., t03) being pushed to extras/specials is a critical bug indicating the sort or reversal logic is wrong.

10. **Track reversal is a global per-release decision.** A physical disc release is mastered one way (all forward or all reverse). `detectAndApplyTrackOrder` applies the same decision to all discs. Per-disc reversal is NOT supported — it's one direction for the whole release.

11. **Three reversal signals in priority order:**
    - Cross-season hint (from previously matched season on same release)
    - Absolute cost difference (when runtimes vary enough: CV ≥ 0.10)
    - DVDCompare correlation (sub-second runtime pattern matching)
    When none provide strong evidence, default to forward.

12. **Outlier tracks with large track-number gaps are demoted before reversal detection AND matching.** When more episode-classified files exist than TMDb episodes, the matcher looks for gaps in track numbers (e.g., t00-t04 then t10). Files on the far side of the largest gap are reclassified as extras. This MUST run before reversal detection (Step 4) because: (a) gap detection requires ascending track order which reversal destroys, and (b) outlier tracks pollute the reversal cost/correlation analysis.

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
