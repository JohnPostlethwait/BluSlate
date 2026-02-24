import { scanDirectory } from './scanner.js';
import { parseFilename } from './parser.js';
import { probeFile } from './prober.js';
import { findMatch } from './matcher.js';
import { executeRenames, writeRenameLog } from './renamer.js';
import { shouldUseBatchMode, groupFilesBySeason } from './directory-parser.js';
import { identifyShow, classifyAndSortFiles, matchSeasonBatch, matchSpecialsBatch } from './batch-matcher.js';
import { searchDvdCompare, fetchDiscEpisodeData } from '../api/dvdcompare-client.js';
import { TmdbClient } from '../api/tmdb-client.js';
import { logger } from '../utils/logger.js';
import { FatalError } from '../errors.js';
import { MediaType } from '../types/media.js';
import type { AppConfig } from '../types/config.js';
import type { MatchResult, ParsedFilename, MediaFile, ClassifiedFile, DirectoryContext } from '../types/media.js';
import type { UIAdapter } from '../types/ui-adapter.js';
import type { IdentifiedShow } from './batch-matcher.js';
import type { TmdbSeasonDetails } from '../types/tmdb.js';
import type { DvdCompareDisc } from '../api/dvdcompare-client.js';

/**
 * Detect potential "Play All" files — tracks that combine multiple episodes
 * into a single file. Identified by having runtime or size significantly
 * exceeding the median of other episode files in the group.
 *
 * Returns the set of file paths flagged as potential multi-episode concatenations.
 */
export function detectPlayAllFiles(
  classified: ClassifiedFile[],
): Set<string> {
  const flagged = new Set<string>();

  // Only consider files classified as episodes or unknown (extras are already excluded)
  const candidates = classified.filter(
    (f) => f.classification === 'episode' || f.classification === 'unknown',
  );

  if (candidates.length < 3) {
    // Need at least 3 files to compute a meaningful median
    return flagged;
  }

  // Compute median duration
  const durations = candidates
    .map((f) => f.durationMinutes)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);

  const medianDuration = durations.length >= 3
    ? durations[Math.floor(durations.length / 2)]
    : 0;

  // Compute median file size
  const sizes = candidates
    .map((f) => f.file.sizeBytes)
    .sort((a, b) => a - b);

  const medianSize = sizes[Math.floor(sizes.length / 2)];

  for (const cf of candidates) {
    const isRuntimeOutlier =
      cf.durationMinutes !== undefined && medianDuration > 0 &&
      cf.durationMinutes > medianDuration * 2.5;

    const isSizeOutlier =
      medianSize > 0 && cf.file.sizeBytes > medianSize * 3;

    if (isRuntimeOutlier || isSizeOutlier) {
      flagged.add(cf.file.filePath);
      logger.batch(
        `Potential "Play All" file detected: ${cf.file.fileName} ` +
        `(duration: ${cf.durationMinutes?.toFixed(0) ?? '?'}min vs median ${medianDuration.toFixed(0)}min, ` +
        `size: ${(cf.file.sizeBytes / 1e9).toFixed(1)}GB vs median ${(medianSize / 1e9).toFixed(1)}GB)`,
      );
    }
  }

  return flagged;
}

function progressText(current: number, total: number, fileName: string): string {
  return `[${current}/${total}] Processing: ${fileName}`;
}

export async function runPipeline(config: AppConfig, ui: UIAdapter): Promise<void> {
  // 1. Scan for media files
  ui.progress.start('Scanning for media files...');
  const mediaFiles = await scanDirectory(config.directory, config.recursive);
  ui.progress.succeed(`Found ${mediaFiles.length} media file(s)`);

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
    matches = await runBatchPipeline(config, mediaFiles, client, ui);
  } else {
    matches = await runPerFilePipeline(config, mediaFiles, client, ui);
  }

  // 4. Display results
  ui.display.displayResults(matches, config.directory);

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
    ui.display.displaySummary(renameable.length, 0, 0, true);
    return;
  }

  // 7. Confirm with user (may include interactive editing)
  const confirmed = await ui.prompts.confirmRenames(
    matches, config.autoAccept, config.minConfidence,
    config.template, config.directory, client,
  );

  if (confirmed.length === 0) {
    logger.info('No files selected for renaming.');
    return;
  }

  // 8. Execute renames
  ui.progress.start('Renaming files...');
  const renames = await executeRenames(confirmed, false);
  ui.progress.succeed('Renaming complete');

  // 9. Write rename log
  await writeRenameLog(config.directory, renames);

  // 10. Summary — recompute renameable since editing may have changed matches
  const finalRenameable = matches.filter(
    (m) => m.status !== 'unmatched' && m.newFilename !== m.mediaFile.fileName,
  );
  const skipped = finalRenameable.length - confirmed.length;
  const failed = confirmed.length - renames.length;
  ui.display.displaySummary(renames.length, skipped, failed, false);
}

/**
 * Per-file pipeline — the original matching approach using filename parsing.
 */
async function runPerFilePipeline(
  config: AppConfig,
  mediaFiles: MediaFile[],
  client: TmdbClient,
  ui: UIAdapter,
): Promise<MatchResult[]> {
  const matches: MatchResult[] = [];
  const total = mediaFiles.length;
  ui.progress.start(progressText(1, total, mediaFiles[0].fileName));

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    ui.progress.update(progressText(i + 1, total, file.fileName));

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
        ui.progress.update(`[${i + 1}/${total}] No match: ${file.fileName}`);
      }
    } catch (err) {
      // Fatal errors (auth failure, etc.) must abort immediately
      if (err instanceof FatalError) {
        ui.progress.stop();
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

  ui.progress.stop();
  return matches;
}

/**
 * Batch pipeline — groups files by directory structure, identifies shows,
 * classifies files by runtime, and matches episodes sequentially.
 *
 * Processing is split into sequential phases so that all user-interactive
 * steps (show identification + DVDCompare selection) complete before the
 * potentially slow ffprobe scanning begins:
 *
 *   Phase 1: Group files by directory structure
 *   Phase 2: Identify shows via TMDb (user confirms each)
 *   Phase 3: DVDCompare lookup (user selects releases)
 *   Phase 4: Probe all files with ffprobe (single progress bar)
 *   Phase 5: Classify + match per season group
 *   Phase 6: Match specials (Season 0)
 *   Phase 7: Apply "Play All" warnings
 */
async function runBatchPipeline(
  config: AppConfig,
  mediaFiles: MediaFile[],
  client: TmdbClient,
  ui: UIAdapter,
): Promise<MatchResult[]> {
  const allMatches: MatchResult[] = [];

  // ── Phase 1: Group files by season using directory structure ──
  const seasonGroups = groupFilesBySeason(mediaFiles, config.directory);

  const showCache = new Map<string, IdentifiedShow | null>();
  const season0Cache = new Map<number, TmdbSeasonDetails | null>();
  const dvdCompareCache = new Map<string, DvdCompareDisc[] | null>();
  const specialsCandidates = new Map<string, { show: IdentifiedShow; candidates: ClassifiedFile[] }>();
  const allPlayAllFiles = new Set<string>();

  // Collect unique show names (with a representative DirectoryContext for each)
  const showContexts = new Map<string, DirectoryContext>();
  for (const [, group] of seasonGroups) {
    const showName = group.directoryContext.showName;
    if (!showContexts.has(showName)) {
      showContexts.set(showName, group.directoryContext);
    }
  }

  // ── Phase 2: Identify shows via TMDb (no probing needed) ──
  for (const [showName, context] of showContexts) {
    try {
      const show = await identifyShow(client, context, ui.prompts);
      showCache.set(showName, show);
    } catch (err) {
      if (err instanceof FatalError) {
        ui.progress.stop();
        throw err;
      }
      logger.error(`Error identifying show "${showName}": ${err}`);
      showCache.set(showName, null);
    }
  }

  // ── Phase 3: DVDCompare lookup for identified shows (no probing needed) ──
  for (const [showName] of showContexts) {
    const show = showCache.get(showName);
    if (!show) continue; // Show wasn't identified — skip DVDCompare

    try {
      ui.progress.start(`Searching DVDCompare for "${showName}"...`);
      const searchResults = await searchDvdCompare(showName);

      if (searchResults.length > 0) {
        ui.progress.succeed(
          `DVDCompare: found ${searchResults.length} result(s) (${searchResults.filter((r) => r.isBluray).length} Blu-ray)`,
        );

        // Let the user select one or more DVDCompare results
        const selectedResults = await ui.prompts.confirmDvdCompareSelection(showName, searchResults);

        if (selectedResults.length > 0) {
          // Fetch disc data from all selected results and merge
          const allDiscs: DvdCompareDisc[] = [];

          for (const selectedResult of selectedResults) {
            logger.batch(
              `DVDCompare: fetching "${selectedResult.title}" (fid=${selectedResult.fid}, ` +
              `${selectedResult.isBluray ? 'Blu-ray' : 'DVD'})`,
            );

            ui.progress.start(`Fetching DVDCompare disc data for "${selectedResult.title}"...`);
            const dvdData = await fetchDiscEpisodeData(selectedResult.fid);
            if (dvdData?.discs) {
              allDiscs.push(...dvdData.discs);
            }
          }

          const dvdCompareDiscs = allDiscs.length > 0 ? allDiscs : null;

          if (dvdCompareDiscs) {
            const totalEps = dvdCompareDiscs.reduce((sum, d) => sum + d.episodes.length, 0);
            ui.progress.succeed(
              `DVDCompare: ${selectedResults.length} release(s), ${dvdCompareDiscs.length} disc(s), ${totalEps} episode(s)`,
            );
          } else {
            ui.progress.succeed(`DVDCompare: no disc data found in selected results`);
          }

          dvdCompareCache.set(showName, dvdCompareDiscs);
        } else {
          dvdCompareCache.set(showName, null);
          ui.progress.succeed(`DVDCompare: skipped by user`);
        }
      } else {
        dvdCompareCache.set(showName, null);
        ui.progress.succeed(`DVDCompare: no results found`);
      }
    } catch (err) {
      logger.warn(`DVDCompare lookup failed for "${showName}": ${err}`);
      dvdCompareCache.set(showName, null);
      ui.progress.succeed(`DVDCompare: lookup failed (continuing without)`);
    }
  }

  // ── Phase 4: Probe all files with ffprobe (unified progress) ──
  const totalFiles = Array.from(seasonGroups.values()).reduce((sum, g) => sum + g.files.length, 0);
  let probed = 0;
  ui.progress.start(`[0/${totalFiles}] Probing files...`);

  for (const [, group] of seasonGroups) {
    for (const file of group.files) {
      probed++;
      ui.progress.update(`[${probed}/${totalFiles}] Probing: ${file.fileName}`);
      try {
        const probeData = await probeFile(file.filePath);
        if (probeData) {
          group.probeResults.set(file.filePath, probeData);
        }
      } catch (err) {
        logger.warn(`Failed to probe ${file.fileName}: ${err}`);
      }
    }
  }

  ui.progress.succeed(`Probed ${totalFiles} files`);

  // ── Phase 5: Classify + Match per season group ──
  for (const [groupKey, group] of seasonGroups) {
    const showName = group.directoryContext.showName;
    const season = group.directoryContext.season ?? 1;

    try {
      const show = showCache.get(showName);

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

      // Extras groups skip season matching — send straight to specials candidates
      if (group.directoryContext.isExtras) {
        logger.info(`${showName}: extras directory — ${group.files.length} file(s) → specials candidates`);

        const extrasClassified: ClassifiedFile[] = group.files.map((file) => {
          const probeData = group.probeResults.get(file.filePath);
          return {
            file,
            probeData,
            classification: 'extra' as const,
            durationMinutes: probeData?.durationMinutes,
            sortOrder: 0,
          };
        });

        const showSpecials = specialsCandidates.get(showName) ?? { show, candidates: [] };
        showSpecials.candidates.push(...extrasClassified);
        specialsCandidates.set(showName, showSpecials);
        continue;
      }

      // Classify files as episodes vs extras
      const expectedRuntime = show.episodeRunTime.length > 0
        ? show.episodeRunTime[0]
        : undefined;

      const classified = classifyAndSortFiles(group, expectedRuntime);

      const episodeFiles = classified.filter((f) => f.classification === 'episode' || f.classification === 'unknown');
      const extraFiles = classified.filter((f) => f.classification === 'extra');

      logger.info(
        `${showName} S${String(season).padStart(2, '0')}: ` +
        `${episodeFiles.length} episode(s), ${extraFiles.length} extra(s)`
      );

      // Detect potential "Play All" multi-episode concatenation files
      const playAllFiles = detectPlayAllFiles(classified);
      for (const fp of playAllFiles) {
        allPlayAllFiles.add(fp);
      }

      // Match episodes to TMDb season (pass DVDCompare data when available)
      const dvdCompareDiscs = dvdCompareCache.get(showName) ?? null;
      ui.progress.start(`Matching ${episodeFiles.length} episodes for ${showName} Season ${season}...`);
      const seasonResult = await matchSeasonBatch(
        client,
        show.showId,
        show.showName,
        show.showYear,
        season,
        episodeFiles,
        config.template,
        dvdCompareDiscs ?? undefined,
      );
      ui.progress.succeed(`Matched ${seasonResult.matched.filter(m => m.status === 'matched').length} episode(s)`);

      // Mark all batch results with dvdCompareUsed so the UI always shows the
      // DVDCompare column in batch mode.
      for (const match of seasonResult.matched) {
        match.dvdCompareUsed = true;
      }

      allMatches.push(...seasonResult.matched);

      // Collect all unmatched files as specials candidates:
      //    reclassifiedExtras (from season matching) + initial extraFiles
      const showSpecials = specialsCandidates.get(showName) ?? { show, candidates: [] };
      showSpecials.candidates.push(...seasonResult.reclassifiedExtras);
      showSpecials.candidates.push(...extraFiles);
      specialsCandidates.set(showName, showSpecials);
    } catch (err) {
      // Fatal errors must abort
      if (err instanceof FatalError) {
        ui.progress.stop();
        throw err;
      }

      ui.progress.stop();
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

  // ── Phase 6: Match specials (Season 0) ──
  for (const [showName, { show, candidates }] of specialsCandidates) {
    if (candidates.length === 0) continue;

    ui.progress.start(`Matching ${candidates.length} file(s) against ${showName} Specials (Season 0)...`);
    try {
      const specialsResult = await matchSpecialsBatch(
        client,
        show.showId,
        show.showName,
        show.showYear,
        candidates,
        config.template,
        season0Cache,
      );
      ui.progress.succeed(
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
        ui.progress.stop();
        throw err;
      }

      ui.progress.stop();
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

  // ── Phase 7: Apply "Play All" warnings ──
  if (allPlayAllFiles.size > 0) {
    for (const match of allMatches) {
      if (allPlayAllFiles.has(match.mediaFile.filePath)) {
        if (!match.warnings) match.warnings = [];
        match.warnings.push(
          'Potential multi-episode "Play All" file: runtime or file size significantly ' +
          'exceeds the median of other episode files in this season group.',
        );
      }
    }
  }

  return allMatches;
}
