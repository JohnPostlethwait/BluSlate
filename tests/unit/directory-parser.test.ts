import { describe, it, expect } from 'vitest';
import {
  shouldUseBatchMode,
  parseDirectoryContext,
  groupFilesBySeason,
  extractTrackNumber,
} from '../../packages/core/src/core/directory-parser.js';
import {
  SCAN_ROOT,
  allSguFiles,
  sguSeason1Disc1Files,
  sguSeason2Disc1Files,
  alternateStructureFiles,
  normalFiles,
  mixedFiles,
  blurayStreamFiles,
  dvdVtsFiles,
  discOnlyFiles,
  nestedSeasonDiscFiles,
  flatRipFiles,
  diskSpellingFiles,
  dvdVolumeLabelFiles,
} from '../fixtures/directories.js';

describe('shouldUseBatchMode', () => {
  it('should return true for all generic filenames (MakeMKV output)', () => {
    expect(shouldUseBatchMode(allSguFiles)).toBe(true);
  });

  it('should return false for normal filenames with S##E## patterns', () => {
    expect(shouldUseBatchMode(normalFiles)).toBe(false);
  });

  it('should return false for mixed files below 70% threshold', () => {
    // 1 generic out of 4 = 25%
    expect(shouldUseBatchMode(mixedFiles)).toBe(false);
  });

  it('should return false for empty file list', () => {
    expect(shouldUseBatchMode([])).toBe(false);
  });

  it('should detect VTS and stream patterns as generic', () => {
    const vtsFiles = [
      { filePath: '/media/VTS_01_1.mkv', fileName: 'VTS_01_1.mkv', extension: '.mkv', sizeBytes: 1000 },
      { filePath: '/media/stream0.mkv', fileName: 'stream0.mkv', extension: '.mkv', sizeBytes: 1000 },
      { filePath: '/media/clip001.mkv', fileName: 'clip001.mkv', extension: '.mkv', sizeBytes: 1000 },
    ];
    expect(shouldUseBatchMode(vtsFiles)).toBe(true);
  });

  it('should detect BluRay .m2ts stream files as generic', () => {
    expect(shouldUseBatchMode(blurayStreamFiles)).toBe(true);
  });

  it('should detect DVD VTS files as generic', () => {
    expect(shouldUseBatchMode(dvdVtsFiles)).toBe(true);
  });

  it('should detect flat rip title_t## files as generic', () => {
    expect(shouldUseBatchMode(flatRipFiles)).toBe(true);
  });

  it('should detect title-t## (hyphen) variant as generic', () => {
    const files = [
      { filePath: '/media/title-t00.mkv', fileName: 'title-t00.mkv', extension: '.mkv', sizeBytes: 1000 },
      { filePath: '/media/title-t01.mkv', fileName: 'title-t01.mkv', extension: '.mkv', sizeBytes: 1000 },
    ];
    expect(shouldUseBatchMode(files)).toBe(true);
  });

  it('should detect chapter## pattern as generic', () => {
    const files = [
      { filePath: '/media/chapter01.mkv', fileName: 'chapter01.mkv', extension: '.mkv', sizeBytes: 1000 },
      { filePath: '/media/chapter02.mkv', fileName: 'chapter02.mkv', extension: '.mkv', sizeBytes: 1000 },
    ];
    expect(shouldUseBatchMode(files)).toBe(true);
  });

  it('should detect numbers-only filenames (BluRay streams ripped) as generic', () => {
    const files = [
      { filePath: '/media/00001.mkv', fileName: '00001.mkv', extension: '.mkv', sizeBytes: 1000 },
      { filePath: '/media/00002.mkv', fileName: '00002.mkv', extension: '.mkv', sizeBytes: 1000 },
    ];
    expect(shouldUseBatchMode(files)).toBe(true);
  });
});

describe('parseDirectoryContext', () => {
  it('should extract show name from scan root and season/disc from SGU_BR_S1D1', () => {
    const file = sguSeason1Disc1Files[0];
    const context = parseDirectoryContext(file.filePath, SCAN_ROOT);

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Stargate Universe');
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
    expect(context!.sourceHint).toBe('BR');
    expect(context!.seasonDiscSource).toBe('SGU_BR_S1D1');
  });

  it('should parse season 2 disc 1 correctly', () => {
    const file = sguSeason2Disc1Files[0];
    const context = parseDirectoryContext(file.filePath, SCAN_ROOT);

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Stargate Universe');
    expect(context!.season).toBe(2);
    expect(context!.disc).toBe(1);
  });

  it('should handle "Season 1/Disc 1" directory structure', () => {
    const file = alternateStructureFiles[0];
    const scanRoot = '/media/shows/Breaking Bad';
    const context = parseDirectoryContext(file.filePath, scanRoot);

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Breaking Bad');
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
  });

  it('should default to season 1 when no season/disc info in subdir', () => {
    const file = {
      filePath: '/media/shows/MyShow/random_subdir/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/MyShow');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('MyShow');
    expect(context!.season).toBe(1);
  });

  it('should handle file directly in scan root', () => {
    const file = {
      filePath: '/media/shows/MyShow/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/MyShow');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('MyShow');
    expect(context!.season).toBeUndefined();
    expect(context!.disc).toBeUndefined();
  });

  it('should handle S1D2 shorthand directory name', () => {
    const file = {
      filePath: '/media/shows/TheExpanse/S1D2/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/TheExpanse');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('TheExpanse');
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(2);
  });

  it('should handle "Season 2" directory name without disc', () => {
    const file = {
      filePath: '/media/shows/Firefly/Season 2/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/Firefly');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Firefly');
    expect(context!.season).toBe(2);
    expect(context!.disc).toBeUndefined();
  });

  // ── Disc-rip-specific directory patterns ─────────────────────────────

  it('should handle "Disc 1" directory without season (defaults season 1)', () => {
    const file = discOnlyFiles[0];
    const context = parseDirectoryContext(file.filePath, '/media/shows/Firefly');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Firefly');
    expect(context!.disc).toBe(1);
  });

  it('should handle "Disk" spelling variant', () => {
    const file = diskSpellingFiles[0];
    const context = parseDirectoryContext(file.filePath, '/media/shows/Battlestar Galactica');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Battlestar Galactica');
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
  });

  it('should handle nested "Season 1/Disc 1" accumulating both', () => {
    const file = nestedSeasonDiscFiles[0];
    const context = parseDirectoryContext(file.filePath, '/media/shows/Lost');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Lost');
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
  });

  it('should handle nested "Season 2/Disc 1"', () => {
    const file = nestedSeasonDiscFiles[2];
    const context = parseDirectoryContext(file.filePath, '/media/shows/Lost');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('Lost');
    expect(context!.season).toBe(2);
    expect(context!.disc).toBe(1);
  });

  it('should handle BDMV/STREAM nested directory (default season from parent)', () => {
    const file = blurayStreamFiles[0];
    const context = parseDirectoryContext(file.filePath, '/media/shows/The Wire');

    expect(context).not.toBeNull();
    expect(context!.showName).toBe('The Wire');
    expect(context!.season).toBe(1);
  });

  it('should handle DVD-labeled S01D02 directory name', () => {
    const file = {
      filePath: '/media/shows/Friends/FRIENDS_DVD_S01D02/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/Friends');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(2);
  });

  it('should handle Season01 without space', () => {
    const file = {
      filePath: '/media/shows/House/Season01/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/House');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(1);
  });

  it('should handle D1 shorthand disc directory', () => {
    const file = {
      filePath: '/media/shows/Dexter/Season 1/D1/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/Dexter');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
  });

  it('should handle S01 season-only shorthand', () => {
    const file = {
      filePath: '/media/shows/GoT/S01/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/GoT');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(1);
    expect(context!.disc).toBeUndefined();
  });

  it('should handle BD sourceHint in SHOW_BD_S01D01 pattern', () => {
    const file = {
      filePath: '/media/shows/ShowName/SHOW_BD_S01D01/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/ShowName');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(1);
    expect(context!.disc).toBe(1);
    expect(context!.sourceHint).toBe('BD');
  });

  it('should handle BLURAY sourceHint in directory name', () => {
    const file = {
      filePath: '/media/shows/ShowName/SHOW_BLURAY_S02D03/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/ShowName');

    expect(context).not.toBeNull();
    expect(context!.season).toBe(2);
    expect(context!.disc).toBe(3);
    expect(context!.sourceHint).toBe('BLURAY');
  });

  it('should handle DVD sourceHint', () => {
    const file = {
      filePath: '/media/shows/ShowName/SHOW_DVD_S01D01/title_t00.mkv',
      fileName: 'title_t00.mkv',
      extension: '.mkv',
      sizeBytes: 1000,
    };
    const context = parseDirectoryContext(file.filePath, '/media/shows/ShowName');

    expect(context).not.toBeNull();
    expect(context!.sourceHint).toBe('DVD');
  });
});

describe('groupFilesBySeason', () => {
  it('should group SGU files into 2 season groups', () => {
    const groups = groupFilesBySeason(allSguFiles, SCAN_ROOT);

    expect(groups.size).toBe(2);
    expect(groups.has('Stargate Universe::1')).toBe(true);
    expect(groups.has('Stargate Universe::2')).toBe(true);
  });

  it('should include all season 1 files across discs in one group', () => {
    const groups = groupFilesBySeason(allSguFiles, SCAN_ROOT);
    const s1 = groups.get('Stargate Universe::1');

    expect(s1).toBeDefined();
    // 4 from disc 1 + 2 from disc 2 = 6
    expect(s1!.files.length).toBe(6);
  });

  it('should have season 2 files in their own group', () => {
    const groups = groupFilesBySeason(allSguFiles, SCAN_ROOT);
    const s2 = groups.get('Stargate Universe::2');

    expect(s2).toBeDefined();
    expect(s2!.files.length).toBe(2);
  });

  it('should sort files within groups by filePath', () => {
    const groups = groupFilesBySeason(allSguFiles, SCAN_ROOT);
    const s1 = groups.get('Stargate Universe::1');

    expect(s1).toBeDefined();
    // First disc files should come before second disc files
    expect(s1!.files[0].filePath).toContain('SGU_BR_S1D1');
    expect(s1!.files[s1!.files.length - 1].filePath).toContain('SGU_BR_S1D2');
  });

  it('should initialize empty probeResults map', () => {
    const groups = groupFilesBySeason(allSguFiles, SCAN_ROOT);
    const s1 = groups.get('Stargate Universe::1');

    expect(s1!.probeResults).toBeInstanceOf(Map);
    expect(s1!.probeResults.size).toBe(0);
  });

  // ── Disc-rip grouping scenarios ──────────────────────────────────────

  it('should group nested Season/Disc files into season groups', () => {
    const groups = groupFilesBySeason(nestedSeasonDiscFiles, '/media/shows/Lost');

    expect(groups.size).toBe(2);
    expect(groups.has('Lost::1')).toBe(true);
    expect(groups.has('Lost::2')).toBe(true);
    // Season 1 has files from Disc 1 and Disc 2
    expect(groups.get('Lost::1')!.files.length).toBe(2);
    expect(groups.get('Lost::2')!.files.length).toBe(1);
  });

  it('should group disc-only files into default season 1', () => {
    const groups = groupFilesBySeason(discOnlyFiles, '/media/shows/Firefly');

    // All disc-only files share disc info but no season info → all default to season 1
    expect(groups.size).toBe(1);
    expect(groups.has('Firefly::1')).toBe(true);
    expect(groups.get('Firefly::1')!.files.length).toBe(3);
  });

  it('should group flat rip files (in scan root) into default season 1', () => {
    const groups = groupFilesBySeason(flatRipFiles, '/media/shows/Firefly');

    // Files directly in scan root have no season/disc → default season 1
    expect(groups.size).toBe(1);
    expect(groups.has('Firefly::1')).toBe(true);
    expect(groups.get('Firefly::1')!.files.length).toBe(3);
  });
});

describe('extractTrackNumber', () => {
  it('should extract track number from title_t00.mkv', () => {
    expect(extractTrackNumber('title_t00.mkv')).toBe(0);
  });

  it('should extract track number from title_t15.mkv', () => {
    expect(extractTrackNumber('title_t15.mkv')).toBe(15);
  });

  it('should extract track number from VTS_01_1.mkv', () => {
    expect(extractTrackNumber('VTS_01_1.mkv')).toBe(1);
  });

  it('should return 0 for filenames without numbers', () => {
    expect(extractTrackNumber('movie.mkv')).toBe(0);
  });

  // ── Disc-rip track extraction ────────────────────────────────────────

  it('should extract track from title-t03.mkv (hyphen variant)', () => {
    expect(extractTrackNumber('title-t03.mkv')).toBe(3);
  });

  it('should extract track from BluRay stream 00001.m2ts', () => {
    expect(extractTrackNumber('00001.m2ts')).toBe(1);
  });

  it('should extract track from BluRay stream 00100.m2ts', () => {
    expect(extractTrackNumber('00100.m2ts')).toBe(100);
  });

  it('should extract track from clip001.mkv', () => {
    expect(extractTrackNumber('clip001.mkv')).toBe(1);
  });

  it('should extract track from chapter05.mkv', () => {
    expect(extractTrackNumber('chapter05.mkv')).toBe(5);
  });

  it('should extract from named disc rip Arrow_Season_3_Disc_4_t05.mkv', () => {
    expect(extractTrackNumber('Arrow_Season_3_Disc_4_t05.mkv')).toBe(5);
  });

  it('should extract from VTS_02_1.mkv', () => {
    expect(extractTrackNumber('VTS_02_1.mkv')).toBe(1);
  });

  it('should extract from stream0.mkv', () => {
    expect(extractTrackNumber('stream0.mkv')).toBe(0);
  });
});
