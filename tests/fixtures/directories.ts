import type { MediaFile } from '../../packages/core/src/types/media.js';

/**
 * Simulates the Stargate Universe BluRay rip directory structure:
 * /Volumes/MakeMKV/shows/Stargate Universe/
 * ├── SGU_BR_S1D1/
 * │   ├── title_t00.mkv  (~43min episode)
 * │   ├── title_t01.mkv  (~43min episode)
 * │   ├── title_t02.mkv  (~4min extra)
 * │   └── title_t03.mkv  (~4min extra)
 * ├── SGU_BR_S1D2/
 * │   ├── title_t00.mkv
 * │   └── title_t01.mkv
 * ├── SGU_BR_S2D1/
 * │   ├── title_t00.mkv
 * │   └── title_t01.mkv
 */

export const SCAN_ROOT = '/Volumes/MakeMKV/shows/Stargate Universe';

function makeFile(subdir: string, name: string, sizeBytes: number = 1_000_000_000): MediaFile {
  const filePath = `${SCAN_ROOT}/${subdir}/${name}`;
  const extension = name.substring(name.lastIndexOf('.'));
  return { filePath, fileName: name, extension, sizeBytes };
}

export const sguSeason1Disc1Files: MediaFile[] = [
  makeFile('SGU_BR_S1D1', 'title_t00.mkv', 4_500_000_000),
  makeFile('SGU_BR_S1D1', 'title_t01.mkv', 4_200_000_000),
  makeFile('SGU_BR_S1D1', 'title_t02.mkv', 400_000_000),
  makeFile('SGU_BR_S1D1', 'title_t03.mkv', 350_000_000),
];

const sguSeason1Disc2Files: MediaFile[] = [
  makeFile('SGU_BR_S1D2', 'title_t00.mkv', 4_800_000_000),
  makeFile('SGU_BR_S1D2', 'title_t01.mkv', 4_100_000_000),
];

export const sguSeason2Disc1Files: MediaFile[] = [
  makeFile('SGU_BR_S2D1', 'title_t00.mkv', 5_000_000_000),
  makeFile('SGU_BR_S2D1', 'title_t01.mkv', 4_300_000_000),
];

export const allSguFiles: MediaFile[] = [
  ...sguSeason1Disc1Files,
  ...sguSeason1Disc2Files,
  ...sguSeason2Disc1Files,
];

// Alternative directory structure: "Season 1/Disc 1/"
export const alternateStructureFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Breaking Bad/Season 1/Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 3_000_000_000,
  },
  {
    filePath: '/media/shows/Breaking Bad/Season 1/Disc 1/title_t01.mkv',
    fileName: 'title_t01.mkv',
    extension: '.mkv',
    sizeBytes: 3_200_000_000,
  },
  {
    filePath: '/media/shows/Breaking Bad/Season 1/Disc 2/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 2_900_000_000,
  },
];

// ── Additional disc-rip directory structures ───────────────────────────

// DVD rip with ALL_CAPS disc volume label as directory name
export const dvdVolumeLabelFiles: MediaFile[] = [
  makeFile('MODERN_FAMILY_SEASON1_DISC1', 'title_t00.mkv', 3_000_000_000),
  makeFile('MODERN_FAMILY_SEASON1_DISC1', 'title_t01.mkv', 3_200_000_000),
  makeFile('MODERN_FAMILY_SEASON1_DISC2', 'title_t00.mkv', 3_100_000_000),
];

// BluRay m2ts files in BDMV/STREAM structure
export const blurayStreamFiles: MediaFile[] = [
  {
    filePath: '/media/shows/The Wire/Season 1/BDMV/STREAM/00001.m2ts',
    fileName: '00001.m2ts',
    extension: '.m2ts',
    sizeBytes: 20_000_000_000,
  },
  {
    filePath: '/media/shows/The Wire/Season 1/BDMV/STREAM/00002.m2ts',
    fileName: '00002.m2ts',
    extension: '.m2ts',
    sizeBytes: 18_000_000_000,
  },
];

// DVD structure with VTS files
export const dvdVtsFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Seinfeld/Season 1/VTS_01_1.mkv',
    fileName: 'VTS_01_1.mkv',
    extension: '.mkv',
    sizeBytes: 700_000_000,
  },
  {
    filePath: '/media/shows/Seinfeld/Season 1/VTS_02_1.mkv',
    fileName: 'VTS_02_1.mkv',
    extension: '.mkv',
    sizeBytes: 750_000_000,
  },
  {
    filePath: '/media/shows/Seinfeld/Season 1/VTS_03_1.mkv',
    fileName: 'VTS_03_1.mkv',
    extension: '.mkv',
    sizeBytes: 680_000_000,
  },
];

// Disc-only subdirectory (no season info)
export const discOnlyFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Firefly/Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_000_000_000,
  },
  {
    filePath: '/media/shows/Firefly/Disc 1/title_t01.mkv',
    fileName: 'title_t01.mkv',
    extension: '.mkv',
    sizeBytes: 3_800_000_000,
  },
  {
    filePath: '/media/shows/Firefly/Disc 2/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_100_000_000,
  },
];

// Nested "Season X/Disc Y" multi-season structure
export const nestedSeasonDiscFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Lost/Season 1/Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 5_000_000_000,
  },
  {
    filePath: '/media/shows/Lost/Season 1/Disc 2/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_800_000_000,
  },
  {
    filePath: '/media/shows/Lost/Season 2/Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 5_200_000_000,
  },
];

// Files directly in scan root (flat rip, no subdirs)
export const flatRipFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Firefly/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_000_000_000,
  },
  {
    filePath: '/media/shows/Firefly/title_t01.mkv',
    fileName: 'title_t01.mkv',
    extension: '.mkv',
    sizeBytes: 3_800_000_000,
  },
  {
    filePath: '/media/shows/Firefly/title_t02.mkv',
    fileName: 'title_t02.mkv',
    extension: '.mkv',
    sizeBytes: 4_100_000_000,
  },
];

// "Disk" spelling variant
export const diskSpellingFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Battlestar Galactica/Season 1/Disk 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_000_000_000,
  },
  {
    filePath: '/media/shows/Battlestar Galactica/Season 1/Disk 2/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 3_800_000_000,
  },
];

// Show-name prefixed Season/Disc directories (Star Trek TNG style)
export const showPrefixedSeasonDiscFiles: MediaFile[] = [
  {
    filePath: '/media/shows/Star Trek TNG/Star Trek- The Next Generation Season 5 Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_000_000_000,
  },
  {
    filePath: '/media/shows/Star Trek TNG/Star Trek- The Next Generation Season 5 Disc 1/title_t01.mkv',
    fileName: 'title_t01.mkv',
    extension: '.mkv',
    sizeBytes: 4_200_000_000,
  },
  {
    filePath: '/media/shows/Star Trek TNG/Star Trek- The Next Generation Season 5 Disc 2/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 3_800_000_000,
  },
  {
    filePath: '/media/shows/Star Trek TNG/Star Trek- The Next Generation Season 7 Disc 1/title_t00.mkv',
    fileName: 'title_t00.mkv',
    extension: '.mkv',
    sizeBytes: 4_100_000_000,
  },
];
