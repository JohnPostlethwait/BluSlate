import { Command } from 'commander';
import { createRequire } from 'node:module';
import { buildConfig, saveApiKey, setFfprobePath, isFfprobeAvailable, sanitizeErrorMessage, VALID_LANGUAGE_RE, MAX_TEMPLATE_LENGTH } from '@bluslate/core';
import { runPipeline } from '@bluslate/core';
import { setVerbose } from '@bluslate/core';
import chalk from 'chalk';
import { promptForApiKey } from './ui/prompts.js';
import { createCliAdapter } from './ui/cli-adapter.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name('bluslate')
    .description('Rename TV show files using TMDb metadata')
    .version(version)
    .argument('<directory>', 'Directory containing media files to rename')
    .option('-n, --dry-run', 'Preview changes without renaming', false)
    .option('-k, --api-key <key>', 'TMDb API Read Access Token')
    .option('--template <pattern>', 'Custom naming template')
    .option('-r, --recursive', 'Scan subdirectories', false)
    .option('-v, --verbose', 'Increase log verbosity', false)
    .option('-y, --yes', 'Skip review for matches above the confidence threshold', false)
    .option('--min-confidence <number>', 'Minimum confidence threshold for matching (0-100)', '85')
    .option('--lang <code>', 'TMDb language code', 'en-US')
    .addHelpText('after', `
Environment Variables:
  TMDB_API_KEY        TMDb API Read Access Token (overridden by --api-key flag)
                      Get a free token at: https://www.themoviedb.org/settings/api
  XDG_CONFIG_HOME     Config directory on Linux/macOS (default: ~/.config)
                      Config file stored at: $XDG_CONFIG_HOME/bluslate/config.json
  APPDATA             Config directory on Windows (default: %APPDATA%)
                      Config file stored at: %APPDATA%/bluslate/config.json

API Key Resolution Order:
  1. --api-key flag
  2. TMDB_API_KEY environment variable
  3. Config file (set via "bluslate config")

Examples:
  $ bluslate /path/to/tv/shows
  $ bluslate -r -n /media/tv/show
  $ TMDB_API_KEY=your_token bluslate /media/tv
  $ bluslate --template '{show_name} {season}x{episode}' /media/tv`)
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
        // Validate --min-confidence
        const rawConfidence = parseInt(options['minConfidence'] as string, 10);
        if (!Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 100) {
          throw new Error('--min-confidence must be a number between 0 and 100');
        }

        // Validate --lang
        const lang = options['lang'] as string;
        if (!VALID_LANGUAGE_RE.test(lang)) {
          throw new Error(`--lang must be a valid language code (e.g. en-US, ja), got: "${lang}"`);
        }

        // Validate --template length
        const template = options['template'] as string | undefined;
        if (template && template.length > MAX_TEMPLATE_LENGTH) {
          throw new Error(`--template too long (max ${MAX_TEMPLATE_LENGTH} characters)`);
        }

        const config = await buildConfig({
          directory,
          apiKey: options['apiKey'] as string | undefined,
          dryRun: options['dryRun'] as boolean,
          template,
          recursive: options['recursive'] as boolean,
          verbose: options['verbose'] as boolean,
          yes: options['yes'] as boolean,
          minConfidence: rawConfidence,
          lang,
        });

        const ui = createCliAdapter();
        await runPipeline(config, ui);
      } catch (err) {
        console.error(`\nError: ${sanitizeErrorMessage(err)}\n`);
        process.exit(1);
      }
    });

  // Subcommand: config
  program
    .command('config')
    .description('Interactively configure BluSlate settings')
    .action(async () => {
      try {
        const apiKey = await promptForApiKey();
        await saveApiKey(apiKey);
        console.log('\nConfiguration saved successfully.\n');
      } catch (err) {
        console.error(`\nError: ${sanitizeErrorMessage(err)}\n`);
        process.exit(1);
      }
    });

  return program;
}
