# <img src="packages/gui/resources/icon.png" width="30" /> BluSlate

Cross-platform tool to rename TV show files using [TMDb](https://www.themoviedb.org/) and [DVDCompare.net](https://www.dvdcompare.net/) metadata.

Available as a CLI app, a website, a website in a Docker container, or a local Desktop app on any platform (Electron) – run it however you want to!

## Why Another Media Scraping App?

This is the only app that allows initial batch file naming based on show runtime information. All other media scraping applications were created for already well strucuted files – _heavily_ relying on sequential file orders already being correct.
When ripping DVDs and BluRay disks the files are not always in such nice order. Sometimes they are reverse-chronological, sometimes, they are random. The file order is not enough when trying to organize show rips.

This application fills that gap. It helps you get those initial episode and special names correct so that the other tools such as tinyMediaManager can sanely identify and scrape the rest of the media information.

## Features

- **TMDb Episode Matching** — Search and match files against The Movie Database for accurate episode metadata
- **[DVDCompare.net](https://www.dvdcompare.net/) Integration** — Augments matching with sub-second disc runtime data from DVDCompare.net
- **Batch disc ripping support** — Handles generic MakeMKV filenames (`title_t00.mkv`) by matching runtimes against TMDb and DVDcompare episode data
- **ffprobe runtime detection** — Probes file durations for runtime-based matching (gracefully degrades if unavailable)
- **Confidence scoring** — Each match is scored (0-100) based on title similarity, runtime proximity, and positional alignment
- **Custom naming templates** — Configurable output format with placeholders for show name, season, episode, title, year, and extension
- **Dry-run mode** — Preview all renames before committing changes
- **Undo support** — Reverse renames using a saved manifest
- **Specials detection** — Unmatched files are automatically matched against TMDb Season 0 (Specials)
- **Cross-platform** — Docker, macOS, Windows, and Linux

## Prerequisites

- **Node.js** >= 22 (recommend using [nvm](https://github.com/nvm-sh/nvm))
- **pnpm** >= 10 ([installation](https://pnpm.io/installation))
- **ffprobe** (optional, strongly recommended) — Install via [ffmpeg](https://ffmpeg.org/download.html). The CLI bundles ffprobe automatically; the GUI includes it in packaged builds.
- **TMDb API key** — Free. Get a Read Access Token at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

## Installation

```bash
git clone https://github.com/JohnPostlethwait/BluSlate.git
cd BluSlate
pnpm install
pnpm run build
```

### CLI (global install)

```bash
pnpm --filter @bluslate/cli link --global
bluslate --version
```

### GUI (packaged app)

```bash
pnpm run package:gui
```

Built artifacts appear in `packages/gui/release/`. On macOS, copy the `.app` to `/Applications`.

## Usage

### CLI

```bash
bluslate <directory> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --dry-run` | Preview changes without renaming | `false` |
| `-k, --api-key <key>` | TMDb API Read Access Token | — |
| `--template <pattern>` | Custom naming template | — |
| `-r, --recursive` | Scan subdirectories | `false` |
| `-v, --verbose` | Increase log verbosity | `false` |
| `-y, --yes` | Auto-accept high-confidence matches | `false` |
| `--min-confidence <n>` | Minimum confidence to auto-accept (0-100) | `85` |
| `--lang <code>` | TMDb language code | `en-US` |

**Examples:**

```bash
# Rename TV episodes in a directory
bluslate /path/to/tv/shows

# Dry-run with recursive scan
bluslate -r -n /media/tv/show

# Provide API key inline
TMDB_API_KEY=your_token bluslate /media/tv

# Custom naming template
bluslate --template '{show_name} {season}x{episode}' /media/tv
```

**API key resolution order:**

1. `--api-key` flag
2. `TMDB_API_KEY` environment variable
3. Config file (set via `bluslate config`)

### Configure API key

```bash
bluslate config
```

Stores the key at `$XDG_CONFIG_HOME/bluslate/config.json` (Linux/macOS) or `%APPDATA%\bluslate\config.json` (Windows).

### GUI

Launch the desktop app from `packages/gui/release/` or your system's Applications folder. The GUI provides the same pipeline as the CLI with a visual interface for reviewing and confirming matches.

### Naming Templates

| Placeholder | Description |
|-------------|-------------|
| `{show_name}` | Show title |
| `{title}` | Alias for `{show_name}` |
| `{year}` | Release year |
| `{season}` | Season number (zero-padded) |
| `{episode}` | Episode number or range (e.g., `01` or `01-02`) |
| `{episode_title}` | Episode name |
| `{ext}` | Original file extension |

**Default:** `{show_name} - S{season}E{episode} - {episode_title}`

## Project Structure

```
BluSlate/
├── packages/
│   ├── core/    — Business logic (matching, scoring, TMDb/DVDCompare APIs, pipeline)
│   ├── cli/     — Terminal frontend (Commander.js, ora, inquirer)
│   └── gui/     — Electron desktop app (Svelte 5, electron-vite)
├── tests/
│   ├── unit/    — 18 test files
│   └── fixtures/
├── package.json
├── vitest.config.ts
└── tsconfig.json
```

### Architecture

The core package defines a **UIAdapter** interface composed of three sub-interfaces:

- **ProgressReporter** — spinner/progress updates
- **UserPrompter** — user confirmations (match review, show identification)
- **DisplayAdapter** — results display and summaries

Both the CLI and GUI implement this interface, keeping the core pipeline completely UI-agnostic.

## Development

```bash
# Build all packages (core must build before cli/gui)
pnpm run build

# Build core only
pnpm --filter @bluslate/core run build

# Run GUI in dev mode (hot reload)
pnpm --filter @bluslate/core run build && pnpm --filter @bluslate/gui run dev

# Type check all packages
pnpm run typecheck
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

## License

[ISC](https://opensource.org/licenses/ISC)
