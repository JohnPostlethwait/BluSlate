import { MediaType } from '../../packages/core/src/types/media.js';
import type { ParsedFilename } from '../../packages/core/src/types/media.js';

export interface FilenameTestCase {
  input: string;
  expected: Partial<ParsedFilename>;
}

export const tvShowCases: FilenameTestCase[] = [
  // Standard S01E02 format with dots
  {
    input: 'Breaking.Bad.S01E02.720p.BluRay.x264-DEMAND.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Breaking Bad',
      season: 1,
      episodeNumbers: [2],
    },
  },
  // S01E02 with spaces
  {
    input: 'Breaking Bad - S01E02 - Cats in the Bag.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Breaking Bad',
      season: 1,
      episodeNumbers: [2],
    },
  },
  // Multi-episode
  {
    input: 'Game.of.Thrones.S03E09E10.720p.BluRay.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Game of Thrones',
      season: 3,
      episodeNumbers: [9, 10],
    },
  },
  // Lowercase s and e
  {
    input: 'the.office.s02e05.hdtv.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'the office',
      season: 2,
      episodeNumbers: [5],
    },
  },
  // High episode number
  {
    input: 'The.Simpsons.S35E12.1080p.WEB.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'The Simpsons',
      season: 35,
      episodeNumbers: [12],
    },
  },
  // Scene release with quality info
  {
    input: 'Stranger.Things.S04E01.1080p.WEBRip.x265-RARBG.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Stranger Things',
      season: 4,
      episodeNumbers: [1],
    },
  },
  // Show with year in name
  {
    input: 'Doctor.Who.2005.S13E06.720p.HDTV.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Doctor Who 2005',
      season: 13,
      episodeNumbers: [6],
    },
  },
  // Single digit season format
  {
    input: 'Lost.S1E01.Pilot.Part.1.mkv',
    expected: {
      mediaType: MediaType.TV,
      season: 1,
      episodeNumbers: [1],
    },
  },
  // With underscores
  {
    input: 'The_Wire_S01E01_The_Target.avi',
    expected: {
      mediaType: MediaType.TV,
      season: 1,
      episodeNumbers: [1],
    },
  },
];

export const fallbackCases: FilenameTestCase[] = [
  // 1x02 format
  {
    input: 'Friends - 1x02 - The One with the Sonogram.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Friends',
      season: 1,
      episodeNumbers: [2],
    },
  },
  // 1x02 format with dots
  {
    input: 'Seinfeld.4x11.The.Contest.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Seinfeld',
      season: 4,
      episodeNumbers: [11],
    },
  },
  // High season crossFormat: 12x05
  {
    input: 'Its.Always.Sunny.In.Philadelphia.12x05.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Its Always Sunny In Philadelphia',
      season: 12,
      episodeNumbers: [5],
    },
  },
  // Air date format
  {
    input: 'The.Daily.Show.2024.01.15.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'The Daily Show',
      airDate: '2024-01-15',
    },
  },
];

/**
 * Disc-rip specific cases — filenames produced by ripping software (MakeMKV,
 * HandBrake, DVDFab, etc.) that contain embedded metadata or recognisable
 * patterns. These are NOT the generic "title_t00.mkv" filenames handled by
 * batch mode; rather, these are cases where the disc or ripping tool produced
 * a filename with useful metadata that the per-file parser should extract.
 */
export const discRipTvCases: FilenameTestCase[] = [
  // ── MakeMKV: disc name encodes show + season/disc ─────────────────────
  // When a disc has embedded metadata, MakeMKV uses it in the filename.
  // These are still handled per-file in some mixed-mode scenarios.

  // S01E02 from a named MakeMKV rip with quality tag
  {
    input: 'Breaking.Bad.S01E02.BluRay.Remux.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Breaking Bad',
      season: 1,
      episodeNumbers: [2],
    },
  },
  // Multi-episode range: S01E01-E03 (HandBrake chapter-split, some scene naming)
  {
    input: 'Game.of.Thrones.S03E09E10.BluRay.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Game of Thrones',
      season: 3,
      episodeNumbers: [9, 10],
    },
  },

  // ── HandBrake output ──────────────────────────────────────────────────
  // HandBrake default: "{source} - {title}" where source is the disc name
  {
    input: 'BREAKING_BAD_S1D2 - 1.mkv',
    expected: {
      mediaType: MediaType.Unknown, // No S##E## pattern — batch mode handles this
    },
  },
  // HandBrake with VIDEO_TS source fallback
  {
    input: 'VIDEO_TS - 1.m4v',
    expected: {
      mediaType: MediaType.Unknown, // Completely generic — batch mode
    },
  },

  // ── DVDFab output ─────────────────────────────────────────────────────
  {
    input: 'DARK_KNIGHT.theatrical.mp4',
    expected: {
      mediaType: MediaType.Unknown, // No year or episode info
    },
  },

  // TV BluRay remux
  {
    input: 'Band.of.Brothers.S01E04.1080p.BluRay.Remux.AVC.DTS-HD.MA.5.1-EPSiLON.mkv',
    expected: {
      mediaType: MediaType.TV,
      title: 'Band of Brothers',
      season: 1,
      episodeNumbers: [4],
    },
  },
  // COMPLETE season pack — no episode number, so parser returns Unknown.
  // This is correct: season packs are not individual episodes.
  // In practice, users rip individual episodes, not season pack files.
  {
    input: 'Stranger.Things.S04.COMPLETE.1080p.WEB.mkv',
    expected: {
      mediaType: MediaType.Unknown,
    },
  },
];

/**
 * Generic disc rip filenames — these have NO useful metadata for the per-file
 * parser. They should all parse as Unknown and be handled by batch mode.
 * The purpose of these tests is to ensure the parser does NOT misidentify them.
 */
export const genericDiscCases: FilenameTestCase[] = [
  // MakeMKV default (no disc metadata)
  { input: 'title_t00.mkv', expected: { mediaType: MediaType.Unknown } },
  { input: 'title_t01.mkv', expected: { mediaType: MediaType.Unknown } },
  { input: 'title_t15.mkv', expected: { mediaType: MediaType.Unknown } },
  // MakeMKV without underscore
  { input: 'title00.mkv', expected: { mediaType: MediaType.Unknown } },
  { input: 'title01.mkv', expected: { mediaType: MediaType.Unknown } },
  // MakeMKV with hyphen
  { input: 'title-t00.mkv', expected: { mediaType: MediaType.Unknown } },
  // BluRay stream files
  { input: '00001.m2ts', expected: { mediaType: MediaType.Unknown } },
  { input: '00100.m2ts', expected: { mediaType: MediaType.Unknown } },
  // DVD VOB structure
  { input: 'VTS_01_1.mkv', expected: { mediaType: MediaType.Unknown } },
  { input: 'VTS_02_1.mkv', expected: { mediaType: MediaType.Unknown } },
  // HandBrake fallback
  { input: 'VIDEO_TS - 1.m4v', expected: { mediaType: MediaType.Unknown } },
  // Numbered-only (bare track)
  { input: '00001.mkv', expected: { mediaType: MediaType.Unknown } },
  // MakeMKV A/B menu prefix
  { input: 'A1_t00.mkv', expected: { mediaType: MediaType.Unknown } },
  { input: 'B1_t01.mkv', expected: { mediaType: MediaType.Unknown } },
];
