import * as path from 'node:path';
import { parseFilename } from './parser.js';
import { logger } from '../utils/logger.js';
import { MediaType } from '../types/media.js';
import type { MediaFile, DirectoryContext, SeasonGroup } from '../types/media.js';

// Patterns to detect generic filenames (MakeMKV output, disc rips, etc.)
const GENERIC_FILENAME_PATTERNS = [
  /^title[_-]?t?\d+$/i,         // title_t00, title_t01, title00
  /^title\d+$/i,                 // title00, title01
  /^VTS_\d+/i,                   // DVD VOB rips: VTS_01_1
  /^BDMV/i,                      // BluRay structure
  /^stream\d*/i,                 // stream, stream0, stream1
  /^chapter\d+/i,                // chapter01
  /^clip\d+/i,                   // clip001
  /^\d+$/,                       // Pure numeric: 00001, 00100 (BluRay streams ripped to .mkv)
  /^[A-B]\d[_-]t\d+$/i,         // MakeMKV A/B menu prefix: A1_t00, B1_t01
  /^VIDEO_TS/i,                  // HandBrake VIDEO_TS source fallback: "VIDEO_TS - 1"
];

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
];

function isGenericFilename(fileName: string): boolean {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  return GENERIC_FILENAME_PATTERNS.some((pattern) => pattern.test(nameWithoutExt));
}

/**
 * Determine if the file set should use batch mode instead of per-file matching.
 * Returns true if >70% of files have generic/uninformative filenames.
 */
export function shouldUseBatchMode(files: MediaFile[]): boolean {
  if (files.length === 0) return false;

  let genericCount = 0;

  for (const file of files) {
    // Check if filename is generic (MakeMKV output, etc.)
    if (isGenericFilename(file.fileName)) {
      genericCount++;
      continue;
    }

    // Check if the parser can't identify the media type
    const parsed = parseFilename(file.fileName);
    if (parsed.mediaType === MediaType.Unknown) {
      genericCount++;
    }
  }

  const ratio = genericCount / files.length;
  logger.batch(`Generic filename ratio: ${genericCount}/${files.length} (${(ratio * 100).toFixed(0)}%)`);

  return ratio > 0.7;
}

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
  // (the user pointed mediafetch at the show directory)
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

    const season = context.season ?? 1;
    const key = `${context.showName}::${season}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        directoryContext: { ...context, season },
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
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const match = nameWithoutExt.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : 0;
}
