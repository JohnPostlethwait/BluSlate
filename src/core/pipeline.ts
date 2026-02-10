import { scanDirectory } from './scanner.js';
import { parseFilename } from './parser.js';
import { probeFile } from './prober.js';
import { findMatch } from './matcher.js';
import { executeRenames, writeRenameLog } from './renamer.js';
import { shouldUseBatchMode, groupFilesBySeason } from './directory-parser.js';
import { identifyShow, classifyAndSortFiles, matchSeasonBatch, matchSpecialsBatch } from './batch-matcher.js';
import { TmdbClient } from '../api/tmdb-client.js';
import { displayResults, displaySummary } from '../ui/display.js';
import { confirmRenames } from '../ui/prompts.js';
import { startSpinner, updateSpinner, succeedSpinner, stopSpinner, progressText } from '../ui/progress.js';
import { logger } from '../utils/logger.js';
import { FatalError } from '../errors.js';
import { MediaType } from '../types/media.js';
import type { AppConfig } from '../types/config.js';
import type { MatchResult, ParsedFilename, MediaFile, ClassifiedFile } from '../types/media.js';
import type { IdentifiedShow } from './batch-matcher.js';
import type { TmdbSeasonDetails } from '../types/tmdb.js';

export async function runPipeline(config: AppConfig): Promise<void> {
  // 1. Scan for media files
  startSpinner('Scanning for media files...');
  const mediaFiles = await scanDirectory(config.directory, config.recursive);
  succeedSpinner(`Found ${mediaFiles.length} media file(s)`);

  if (mediaFiles.length === 0) {
    logger.info('No media files found in the specified directory.');
    return;
  }

  // 2. Initialize TMDb client
  const client = new TmdbClient(config.apiKey, config.language);

  // 3. Decide: batch mode or per-file mode
  let matches: MatchResult[];

  if (shouldUseBatchMode(mediaFiles)) {
    logger.info('Batch mode activated — generic filenames detected.');
    matches = await runBatchPipeline(config, mediaFiles, client);
  } else {
    matches = await runPerFilePipeline(config, mediaFiles, client);
  }

  // 4. Display results
  displayResults(matches, config.directory);

  // 5. Nothing to rename?
  const renameable = matches.filter(
    (m) => m.status !== 'unmatched' && m.newFilename !== m.mediaFile.fileName,
  );

  if (renameable.length === 0) {
    logger.info('No files to rename.');
    return;
  }

  // 6. Dry run: just display and exit
  if (config.dryRun) {
    displaySummary(renameable.length, 0, 0, true);
    return;
  }

  // 7. Confirm with user (may include interactive editing)
  const confirmed = await confirmRenames(
    matches, config.autoAccept, config.minConfidence,
    config.template, config.directory, client,
  );

  if (confirmed.length === 0) {
    logger.info('No files selected for renaming.');
    return;
  }

  // 8. Execute renames
  startSpinner('Renaming files...');
  const renames = await executeRenames(confirmed, false);
  succeedSpinner('Renaming complete');

  // 9. Write rename log
  await writeRenameLog(config.directory, renames);

  // 10. Summary — recompute renameable since editing may have changed matches
  const finalRenameable = matches.filter(
    (m) => m.status !== 'unmatched' && m.newFilename !== m.mediaFile.fileName,
  );
  const skipped = finalRenameable.length - confirmed.length;
  const failed = confirmed.length - renames.length;
  displaySummary(renames.length, skipped, failed, false);
}

/**
 * Per-file pipeline — the original matching approach using filename parsing.
 */
async function runPerFilePipeline(
  config: AppConfig,
  mediaFiles: MediaFile[],
  client: TmdbClient,
): Promise<MatchResult[]> {
  const matches: MatchResult[] = [];
  const total = mediaFiles.length;
  startSpinner(progressText(1, total, mediaFiles[0].fileName));

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    updateSpinner(progressText(i + 1, total, file.fileName));

    try {
      // Parse the filename
      let parsed: ParsedFilename = parseFilename(file.fileName);

      // Override media type if forced
      if (config.mediaType !== 'auto') {
        parsed = { ...parsed, mediaType: config.mediaType as MediaType };
      }

      // Probe the file for embedded metadata
      const probeData = await probeFile(file.filePath);

      // Enrich parsed data with probe data
      if (probeData) {
        if (probeData.showName && !parsed.title) {
          parsed = { ...parsed, title: probeData.showName };
        }
        if (probeData.season !== undefined && parsed.season === undefined) {
          parsed = { ...parsed, season: probeData.season, mediaType: MediaType.TV };
        }
        if (probeData.episode !== undefined && !parsed.episodeNumbers) {
          parsed = { ...parsed, episodeNumbers: [probeData.episode], mediaType: MediaType.TV };
        }
      }

      // Find TMDb match
      const match = await findMatch(client, file, parsed, probeData, config.template);
      matches.push(match);

      if (match.status === 'unmatched') {
        updateSpinner(`[${i + 1}/${total}] No match: ${file.fileName}`);
      }
    } catch (err) {
      // Fatal errors (auth failure, etc.) must abort immediately
      if (err instanceof FatalError) {
        stopSpinner();
        throw err;
      }

      logger.error(`Error processing ${file.fileName}: ${err}`);
      matches.push({
        mediaFile: file,
        parsed: { mediaType: MediaType.Unknown, title: file.fileName },
        confidence: 0,
        newFilename: file.fileName,
        status: 'unmatched',
      });
    }
  }

  stopSpinner();
  return matches;
}

/**
 * Batch pipeline — groups files by directory structure, identifies shows,
 * classifies files by runtime, and matches episodes sequentially.
 */
async function runBatchPipeline(
  config: AppConfig,
  mediaFiles: MediaFile[],
  client: TmdbClient,
): Promise<MatchResult[]> {
  const allMatches: MatchResult[] = [];

  // Group files by season using directory structure
  const seasonGroups = groupFilesBySeason(mediaFiles, config.directory);

  // Cache identified shows to avoid re-confirming for each season
  const showCache = new Map<string, IdentifiedShow | null>();
  // Cache Season 0 fetches to avoid redundant requests per show
  const season0Cache = new Map<number, TmdbSeasonDetails | null>();
  // Collect specials candidates per show for the second pass
  const specialsCandidates = new Map<string, { show: IdentifiedShow; candidates: ClassifiedFile[] }>();

  for (const [groupKey, group] of seasonGroups) {
    const showName = group.directoryContext.showName;
    const season = group.directoryContext.season ?? 1;

    try {
      // 1. Probe all files in this group for duration
      startSpinner(`Probing ${group.files.length} files for ${showName} Season ${season}...`);
      let probed = 0;
      for (const file of group.files) {
        probed++;
        updateSpinner(`[${probed}/${group.files.length}] Probing: ${file.fileName}`);
        try {
          const probeData = await probeFile(file.filePath);
          if (probeData) {
            group.probeResults.set(file.filePath, probeData);
          }
        } catch (err) {
          logger.warn(`Failed to probe ${file.fileName}: ${err}`);
        }
      }
      succeedSpinner(`Probed ${group.files.length} files`);

      // 2. Identify the show (once per show name, cached)
      let show = showCache.get(showName);
      if (show === undefined) {
        // Not yet cached — identify
        show = await identifyShow(client, group.directoryContext);
        showCache.set(showName, show);
      }

      if (!show) {
        // User skipped or show not found — mark all as unmatched
        for (const file of group.files) {
          allMatches.push({
            mediaFile: file,
            parsed: { mediaType: MediaType.Unknown, title: file.fileName },
            probeData: group.probeResults.get(file.filePath),
            confidence: 0,
            newFilename: file.fileName,
            status: 'unmatched',
          });
        }
        continue;
      }

      // 3. Classify files as episodes vs extras
      const expectedRuntime = show.episodeRunTime.length > 0
        ? show.episodeRunTime[0]
        : undefined;

      const classified = classifyAndSortFiles(group, expectedRuntime);

      const episodeFiles = classified.filter((f) => f.classification === 'episode');
      const extraFiles = classified.filter((f) => f.classification !== 'episode');

      logger.info(
        `${showName} S${String(season).padStart(2, '0')}: ` +
        `${episodeFiles.length} episode(s), ${extraFiles.length} extra(s)`
      );

      // 4. Match episodes to TMDb season
      startSpinner(`Matching ${episodeFiles.length} episodes for ${showName} Season ${season}...`);
      const seasonResult = await matchSeasonBatch(
        client,
        show.showId,
        show.showName,
        show.showYear,
        season,
        episodeFiles,
        true, // user confirmed
        config.template,
      );
      succeedSpinner(`Matched ${seasonResult.matched.filter(m => m.status === 'matched').length} episode(s)`);

      allMatches.push(...seasonResult.matched);

      // 5. Collect all unmatched files as specials candidates:
      //    reclassifiedExtras (from season matching) + initial extraFiles
      const showSpecials = specialsCandidates.get(showName) ?? { show, candidates: [] };
      showSpecials.candidates.push(...seasonResult.reclassifiedExtras);
      showSpecials.candidates.push(...extraFiles);
      specialsCandidates.set(showName, showSpecials);
    } catch (err) {
      // Fatal errors must abort
      if (err instanceof FatalError) {
        stopSpinner();
        throw err;
      }

      stopSpinner();
      logger.error(`Error processing group ${groupKey}: ${err}`);

      // Mark all files in this group as unmatched
      for (const file of group.files) {
        allMatches.push({
          mediaFile: file,
          parsed: { mediaType: MediaType.Unknown, title: file.fileName },
          confidence: 0,
          newFilename: file.fileName,
          status: 'unmatched',
        });
      }
    }
  }

  // 6. Second pass: try all unmatched files against TMDb Season 0 (Specials)
  for (const [showName, { show, candidates }] of specialsCandidates) {
    if (candidates.length === 0) continue;

    startSpinner(`Matching ${candidates.length} file(s) against ${showName} Specials (Season 0)...`);
    try {
      const specialsResult = await matchSpecialsBatch(
        client,
        show.showId,
        show.showName,
        show.showYear,
        candidates,
        true, // user confirmed show
        config.template,
        season0Cache,
      );
      succeedSpinner(
        `Specials: ${specialsResult.matched.length} matched, ` +
        `${specialsResult.unmatched.length} unmatched`
      );

      allMatches.push(...specialsResult.matched);

      // Remaining unmatched files
      for (const unmatchedFile of specialsResult.unmatched) {
        allMatches.push({
          mediaFile: unmatchedFile.file,
          parsed: { mediaType: MediaType.TV, title: unmatchedFile.file.fileName },
          probeData: unmatchedFile.probeData,
          confidence: 0,
          newFilename: unmatchedFile.file.fileName,
          status: 'unmatched',
        });
      }
    } catch (err) {
      if (err instanceof FatalError) {
        stopSpinner();
        throw err;
      }

      stopSpinner();
      logger.warn(`Specials pass failed for ${showName}: ${err}`);

      // Mark all specials candidates as unmatched
      for (const candidate of candidates) {
        allMatches.push({
          mediaFile: candidate.file,
          parsed: { mediaType: MediaType.TV, title: candidate.file.fileName },
          probeData: candidate.probeData,
          confidence: 0,
          newFilename: candidate.file.fileName,
          status: 'unmatched',
        });
      }
    }
  }

  return allMatches;
}
