import * as path from 'node:path';
import { parseFilename } from './parser.js';
import { logger } from '../utils/logger.js';
import { stripExtension } from '../utils/string.js';
import type { MediaFile, DirectoryContext, SeasonGroup } from '../types/media.js';

// Patterns to extract season/disc info from directory names
const SEASON_DISC_PATTERNS: Array<{
  regex: RegExp;
  extract: (m: RegExpMatchArray) => { season?: number; disc?: number; sourceHint?: string };
}> = [
  // SGU_BR_S1D1, SHOW_BD_S01D02
  {
    regex: /^[A-Z0-9]+[_-](?:BR|DVD|BD|BLURAY)[_-]S(\d{1,2})D(\d{1,2})$/i,
    extract: (m) => ({
      season: parseInt(m[1], 10),
      disc: parseInt(m[2], 10),
      sourceHint: m[0].match(/BR|DVD|BD|BLURAY/i)?.[0]?.toUpperCase(),
    }),
  },
  // Season 1 Disc 2, Season 01 Disk 3
  {
    regex: /^Season\s*(\d{1,2})\s*(?:Disc|Disk|D)\s*(\d{1,2})$/i,
    extract: (m) => ({ season: parseInt(m[1], 10), disc: parseInt(m[2], 10) }),
  },
  // S1D2, S01D02
  {
    regex: /^S(\d{1,2})D(\d{1,2})$/i,
    extract: (m) => ({ season: parseInt(m[1], 10), disc: parseInt(m[2], 10) }),
  },
  // S1, S01
  {
    regex: /^S(\d{1,2})$/i,
    extract: (m) => ({ season: parseInt(m[1], 10) }),
  },
  // Season 1, Season 01
  {
    regex: /^Season\s*(\d{1,2})$/i,
    extract: (m) => ({ season: parseInt(m[1], 10) }),
  },
  // Disc 1, Disk 2, D1 (disc only, no season)
  {
    regex: /^(?:Disc|Disk|D)\s*(\d{1,2})$/i,
    extract: (m) => ({ disc: parseInt(m[1], 10) }),
  },
  // SHOW_BR_S1D1 with any prefix — more permissive version
  {
    regex: /S(\d{1,2})D(\d{1,2})/i,
    extract: (m) => ({
      season: parseInt(m[1], 10),
      disc: parseInt(m[2], 10),
      sourceHint: m.input?.match(/BR|DVD|BD|BLURAY/i)?.[0]?.toUpperCase(),
    }),
  },

  // ── Permissive patterns (match anywhere in segment with flexible separators) ──

  // "Star Trek Season 5 Disc 1", "MODERN_FAMILY_SEASON1_DISC1"
  {
    regex: /Season[\s_-]*(\d{1,2})[\s_-]*(?:Disc|Disk|D)[\s_-]*(\d{1,2})/i,
    extract: (m) => ({ season: parseInt(m[1], 10), disc: parseInt(m[2], 10) }),
  },
  // "Star Trek Season 5", "SHOW_SEASON02"
  {
    regex: /Season[\s_-]*(\d{1,2})(?=[\s_-]|$)/i,
    extract: (m) => ({ season: parseInt(m[1], 10) }),
  },
  // "STAR TREK TNG S1 D3", "SHOW_S01_D02"
  {
    regex: /(?<![A-Za-z])S(\d{1,2})[\s_-]+D(\d{1,2})(?!\d)/i,
    extract: (m) => ({ season: parseInt(m[1], 10), disc: parseInt(m[2], 10) }),
  },
  // "STAR TREK TNG S1" — standalone S# avoiding false positives in words like NCIS, DISC
  {
    regex: /(?<![A-Za-z])S(\d{1,2})(?!\d)/i,
    extract: (m) => ({ season: parseInt(m[1], 10) }),
  },
];

/**
 * Directory names that indicate supplementary/bonus content.
 * Files inside these directories bypass season matching entirely
 * and go directly to the specials/extras candidate pool.
 */
const EXTRAS_DIRECTORY_PATTERNS: RegExp[] = [
  /^extras?$/i,
  /^bonus$/i,
  /^bonus[\s_-]*features?$/i,
  /^featurettes?$/i,
  /^behind[\s_-]*the[\s_-]*scenes?$/i,
  /^deleted[\s_-]*scenes?$/i,
  /^special[\s_-]*features?$/i,
  /^supplementa?l?s?$/i,
  /^interviews?$/i,
  /^trailers?$/i,
  /^outtakes?$/i,
  /^gag[\s_-]*reels?$/i,
  /^bloopers?$/i,
  /^making[\s_-]*of$/i,
];

/**
 * Extract show name, season, and disc info from a file's directory path.
 */
export function parseDirectoryContext(filePath: string, scanRoot: string): DirectoryContext | null {
  const absoluteFile = path.resolve(filePath);
  const absoluteRoot = path.resolve(scanRoot);

  // Get relative path from scan root to file's directory
  const fileDir = path.dirname(absoluteFile);
  const relativePath = path.relative(absoluteRoot, fileDir);

  // The show name comes from the scan root basename
  // (the user pointed bluslate at the show directory)
  const showName = path.basename(absoluteRoot);

  if (!showName) return null;

  const context: DirectoryContext = {
    showName,
    showNameSource: absoluteRoot,
  };

  // If the file is directly in the scan root, no subdirectory context
  if (relativePath === '' || relativePath === '.') {
    logger.batch(`Directory context: show="${showName}", no subdir`);
    return context;
  }

  // Walk directory segments looking for season/disc patterns.
  // Continue through all segments to accumulate context (e.g., "Season 1/Disc 1")
  const segments = relativePath.split(path.sep).filter(Boolean);

  // Check if any path segment is an extras/bonus content directory.
  // If so, flag it and do NOT assign a season — these files should
  // bypass the sequential season matcher entirely.
  for (const segment of segments) {
    if (EXTRAS_DIRECTORY_PATTERNS.some((p) => p.test(segment.trim()))) {
      logger.batch(`Directory context: show="${showName}", extras directory="${segment}"`);
      context.isExtras = true;
      return context;
    }
  }

  let matched = false;

  for (const segment of segments) {
    for (const pattern of SEASON_DISC_PATTERNS) {
      const match = segment.match(pattern.regex);
      if (match) {
        const extracted = pattern.extract(match);
        if (extracted.season !== undefined) context.season = extracted.season;
        if (extracted.disc !== undefined) context.disc = extracted.disc;
        if (extracted.sourceHint) context.sourceHint = extracted.sourceHint;
        context.seasonDiscSource = context.seasonDiscSource
          ? `${context.seasonDiscSource}/${segment}`
          : segment;
        matched = true;
        break; // Move to next segment
      }
    }
  }

  if (matched) {
    logger.batch(
      `Directory context: show="${showName}", ` +
      `season=${context.season ?? '?'}, disc=${context.disc ?? '?'} ` +
      `(from "${context.seasonDiscSource}")`
    );
    return context;
  }

  // No season/disc pattern found in subdirs — default season 1
  logger.batch(`Directory context: show="${showName}", defaulting season=1`);
  context.season = 1;
  return context;
}

/**
 * Group files by season, using directory context.
 * Returns a Map keyed by "showName::season".
 */
export function groupFilesBySeason(files: MediaFile[], scanRoot: string): Map<string, SeasonGroup> {
  const groups = new Map<string, SeasonGroup>();

  for (const file of files) {
    const context = parseDirectoryContext(file.filePath, scanRoot);
    if (!context) continue;

    let key: string;
    let season: number | undefined;

    if (context.isExtras) {
      // Extras files get their own group — they bypass season matching entirely
      key = `${context.showName}::extras`;
      season = undefined;
    } else {
      if (context.season !== undefined) {
        // Directory context provides a season — use it
        season = context.season;
      } else {
        // No season from directory structure — try to infer from filename
        // (handles already-renamed files like "Show - S02E01 - Title.mkv")
        const parsed = parseFilename(file.fileName);
        if (parsed.season !== undefined) {
          season = parsed.season;
          logger.batch(`Inferred season ${season} from filename: ${file.fileName}`);
        } else {
          season = 1;
        }
      }
      key = `${context.showName}::${season}`;
    }

    let group = groups.get(key);
    if (!group) {
      group = {
        directoryContext: { ...context, ...(season !== undefined ? { season } : {}) },
        files: [],
        probeResults: new Map(),
      };
      groups.set(key, group);
    }

    group.files.push(file);
  }

  // Sort files within each group by filePath (which preserves disc+track order)
  for (const group of groups.values()) {
    group.files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  logger.batch(`Grouped ${files.length} files into ${groups.size} season group(s)`);
  return groups;
}

/**
 * Extract a track/sort number from a generic filename like "title_t00.mkv"
 */
export function extractTrackNumber(fileName: string): number {
  const nameWithoutExt = stripExtension(fileName);
  // Strip trailing parenthetical numbers — these are title indicators
  // like "Henry IV (2)", not MakeMKV track numbers like "title_t00"
  const cleaned = nameWithoutExt.replace(/\s*\(\d+\)\s*$/, '');
  const match = cleaned.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : 0;
}
