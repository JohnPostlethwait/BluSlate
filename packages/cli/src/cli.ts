import { Command } from 'commander';
import { buildConfig, saveApiKey, setFfprobePath, isFfprobeAvailable } from '@mediafetch/core';
import { runPipeline } from '@mediafetch/core';
import { setVerbose } from '@mediafetch/core';
import chalk from 'chalk';
import { promptForApiKey } from './ui/prompts.js';
import { createCliAdapter } from './ui/cli-adapter.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('mediafetch')
    .description('Rename TV show and movie files using TMDb metadata')
    .version('0.1.0')
    .argument('<directory>', 'Directory containing media files to rename')
    .option('-n, --dry-run', 'Preview changes without renaming', false)
    .option('-t, --type <type>', 'Force media type: tv, movie, or auto', 'auto')
    .option('-k, --api-key <key>', 'TMDb API Read Access Token')
    .option('--template <pattern>', 'Custom naming template')
    .option('-r, --recursive', 'Scan subdirectories', false)
    .option('-v, --verbose', 'Increase log verbosity', false)
    .option('-y, --yes', 'Auto-accept high-confidence matches', false)
    .option('--min-confidence <number>', 'Minimum confidence to auto-accept (0-100)', '85')
    .option('--lang <code>', 'TMDb language code', 'en-US')
    .addHelpText('after', `
Environment Variables:
  TMDB_API_KEY        TMDb API Read Access Token (overridden by --api-key flag)
                      Get a free token at: https://www.themoviedb.org/settings/api
  XDG_CONFIG_HOME     Config directory on Linux/macOS (default: ~/.config)
                      Config file stored at: $XDG_CONFIG_HOME/mediafetch/config.json
  APPDATA             Config directory on Windows (default: %APPDATA%)
                      Config file stored at: %APPDATA%/mediafetch/config.json

API Key Resolution Order:
  1. --api-key flag
  2. TMDB_API_KEY environment variable
  3. Config file (set via "mediafetch config")

Examples:
  $ mediafetch /path/to/tv/shows
  $ mediafetch -r -n /media/movies
  $ TMDB_API_KEY=your_token mediafetch /media/tv
  $ mediafetch --template '{show_name} {season}x{episode}' /media/tv`)
    .action(async (directory: string, options: Record<string, unknown>) => {
      if (options['verbose']) setVerbose(true);

      // Try to use bundled ffprobe from @ffprobe-installer/ffprobe
      try {
        const { path: ffprobeBinPath } = await import('@ffprobe-installer/ffprobe');
        if (ffprobeBinPath) {
          setFfprobePath(ffprobeBinPath);
        }
      } catch {
        // Package not available — will try system ffprobe via PATH
      }

      // Warn early if ffprobe is unavailable
      const ffprobeOk = await isFfprobeAvailable();
      if (!ffprobeOk) {
        console.error(
          chalk.yellow('\n  ⚠  ffprobe not found. File durations cannot be detected.') +
          chalk.yellow('\n     Batch matching (disc rips) will be severely degraded.') +
          chalk.yellow('\n     Install ffmpeg: https://ffmpeg.org/download.html\n'),
        );
      }

      try {
        const config = await buildConfig({
          directory,
          apiKey: options['apiKey'] as string | undefined,
          dryRun: options['dryRun'] as boolean,
          type: options['type'] as string,
          template: options['template'] as string | undefined,
          recursive: options['recursive'] as boolean,
          verbose: options['verbose'] as boolean,
          yes: options['yes'] as boolean,
          minConfidence: parseInt(options['minConfidence'] as string, 10),
          lang: options['lang'] as string,
        });

        const ui = createCliAdapter();
        await runPipeline(config, ui);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`\nError: ${err.message}\n`);
        } else {
          console.error('\nAn unexpected error occurred.\n');
        }
        process.exit(1);
      }
    });

  // Subcommand: config
  program
    .command('config')
    .description('Interactively configure MediaFetch settings')
    .action(async () => {
      try {
        const apiKey = await promptForApiKey();
        await saveApiKey(apiKey);
        console.log('\nConfiguration saved successfully.\n');
      } catch (err) {
        if (err instanceof Error) {
          console.error(`\nError: ${err.message}\n`);
        }
        process.exit(1);
      }
    });

  return program;
}
