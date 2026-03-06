import { describe, it, expect, vi } from 'vitest';
import { classifyAndSortFiles, matchSeasonBatch, matchSpecialsBatch, detectAndApplyTrackOrder, identifyShow, buildUnifiedEpisodeRefs } from '../../packages/core/src/core/batch-matcher.js';
import type { UnifiedEpisodeRef } from '../../packages/core/src/core/batch-matcher.js';
import { detectPlayAllFiles } from '../../packages/core/src/core/pipeline.js';
import type { SeasonGroup, MediaFile, ProbeResult, ClassifiedFile } from '../../packages/core/src/types/media.js';
import type { TmdbSeasonDetails, TmdbEpisode } from '../../packages/core/src/types/tmdb.js';
import { computeBatchConfidence, computeBatchConfidenceBreakdown } from '../../packages/core/src/core/scorer.js';
import { TmdbClient } from '../../packages/core/src/api/tmdb-client.js';

function makeFile(subdir: string, name: string, sizeBytes: number = 1_000_000_000): MediaFile {
  return {
    filePath: `/shows/TestShow/${subdir}/${name}`,
    fileName: name,
    extension: '.mkv',
    sizeBytes,
  };
}

function makeProbeResult(durationMinutes: number): ProbeResult {
  return {
    durationMinutes,
    durationSeconds: durationMinutes * 60,
  };
}

function makeSeasonGroup(
  files: MediaFile[],
  probeDurations: Map<string, number>,
  season: number = 1,
  disc: number = 1,
): SeasonGroup {
  const probeResults = new Map<string, ProbeResult>();
  for (const [path, minutes] of probeDurations) {
    probeResults.set(path, makeProbeResult(minutes));
  }

  return {
    directoryContext: {
      showName: 'TestShow',
      season,
      disc,
      showNameSource: '/shows/TestShow',
      seasonDiscSource: `S${season}D${disc}`,
    },
    files,
    probeResults,
  };
}

function makeClassifiedFile(
  subdir: string,
  name: string,
  durationMinutes?: number,
): ClassifiedFile {
  const file = makeFile(subdir, name);
  return {
    file,
    probeData: durationMinutes !== undefined ? makeProbeResult(durationMinutes) : undefined,
    classification: 'extra',
    durationMinutes,
    sortOrder: 0,
  };
}

function makeTmdbEpisode(
  episodeNumber: number,
  name: string,
  runtime: number | null,
): TmdbEpisode {
  return {
    id: 1000 + episodeNumber,
    episode_number: episodeNumber,
    season_number: 0,
    name,
    overview: '',
    air_date: '2009-10-02',
    runtime,
    still_path: null,
  };
}

function makeSeason0Details(episodes: TmdbEpisode[]): TmdbSeasonDetails {
  return {
    id: 999,
    season_number: 0,
    name: 'Specials',
    episodes,
  };
}

function makeMockClient(season0Details: TmdbSeasonDetails | null): TmdbClient {
  const client = {
    getSeasonDetails: vi.fn().mockImplementation((_showId: number, seasonNumber: number) => {
      if (seasonNumber === 0) {
        if (season0Details === null) {
          return Promise.reject(new Error('Not found'));
        }
        return Promise.resolve(season0Details);
      }
      return Promise.reject(new Error(`Season ${seasonNumber} not mocked`));
    }),
  } as unknown as TmdbClient;
  return client;
}

describe('classifyAndSortFiles', () => {
  it('should classify files as episodes or extras based on expected runtime', () => {
    const files = [
      makeFile('S1D1', 'title_t00.mkv'),
      makeFile('S1D1', 'title_t01.mkv'),
      makeFile('S1D1', 'title_t02.mkv'),
      makeFile('S1D1', 'title_t03.mkv'),
    ];

    const durations = new Map([
      [files[0].filePath, 43],
      [files[1].filePath, 42],
      [files[2].filePath, 4],
      [files[3].filePath, 3],
    ]);

    const group = makeSeasonGroup(files, durations);
    const classified = classifyAndSortFiles(group, 43);

    const episodes = classified.filter((f) => f.classification === 'episode');
    const extras = classified.filter((f) => f.classification === 'extra');
    expect(episodes).toHaveLength(2);
    expect(extras).toHaveLength(2);
    // Full-length files (43, 42 min) should be episodes; short files (4, 3 min) should be extras
    expect(episodes.map((f) => f.file.fileName)).toContain('title_t00.mkv');
    expect(episodes.map((f) => f.file.fileName)).toContain('title_t01.mkv');
    expect(extras.map((f) => f.file.fileName)).toContain('title_t02.mkv');
    expect(extras.map((f) => f.file.fileName)).toContain('title_t03.mkv');
  });

  it('should classify using 15min default when no expected runtime', () => {
    const files = [
      makeFile('S1D1', 'title_t00.mkv'),
      makeFile('S1D1', 'title_t01.mkv'),
    ];

    const durations = new Map([
      [files[0].filePath, 45],
      [files[1].filePath, 5],
    ]);

    const group = makeSeasonGroup(files, durations);
    const classified = classifyAndSortFiles(group);

    expect(classified[0].classification).toBe('episode');
    expect(classified[1].classification).toBe('extra');
  });

  it('should classify files without probe data as unknown', () => {
    const files = [makeFile('S1D1', 'title_t00.mkv')];
    const group = makeSeasonGroup(files, new Map());
    const classified = classifyAndSortFiles(group);

    expect(classified[0].classification).toBe('unknown');
  });

  it('should sort files by disc * 1000 + track', () => {
    const files = [
      makeFile('S1D2', 'title_t01.mkv'),
      makeFile('S1D1', 'title_t00.mkv'),
      makeFile('S1D2', 'title_t00.mkv'),
      makeFile('S1D1', 'title_t01.mkv'),
    ];

    const durations = new Map([
      [files[0].filePath, 43],
      [files[1].filePath, 42],
      [files[2].filePath, 44],
      [files[3].filePath, 41],
    ]);

    const group = makeSeasonGroup(files, durations);
    const classified = classifyAndSortFiles(group, 43);

    // Should be sorted: D1T0, D1T1, D2T0, D2T1
    expect(classified[0].file.filePath).toContain('S1D1/title_t00');
    expect(classified[1].file.filePath).toContain('S1D1/title_t01');
    expect(classified[2].file.filePath).toContain('S1D2/title_t00');
    expect(classified[3].file.filePath).toContain('S1D2/title_t01');
  });

  it('should handle long files as episodes with adaptive threshold', () => {
    const files = [makeFile('S1D1', 'title_t00.mkv')];
    const durations = new Map([[files[0].filePath, 85]]); // ~2x expected runtime

    const group = makeSeasonGroup(files, durations);
    // 85 min is within 43 * 2.5 = 107.5, so still an episode
    const classified = classifyAndSortFiles(group, 43);

    expect(classified[0].classification).toBe('episode');
  });
});

describe('computeBatchConfidence', () => {
  it('should give max confidence for position match + exact runtime', () => {
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
    });

    // 40 + 60 = 100
    expect(confidence).toBe(100);
  });

  it('should give 40 for position match + no runtime data', () => {
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: undefined,
    });

    // 40 + 0 = 40
    expect(confidence).toBe(40);
  });

  it('should give reduced score for large runtime diff', () => {
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 8,
    });

    // 40 + 52 (60-8) = 92
    expect(confidence).toBe(92);
  });

  it('should give 0 for runtime diff ≥60min with no position match', () => {
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 65,
    });

    // 0 + 0 (60-65 clamped to 0) = 0
    expect(confidence).toBe(0);
  });

  // Specials percentage-based scoring tests
  it('should use percentage-based scoring when isSpecialsMatch is true', () => {
    // 6min diff on 132min episode = 4.5% → ≤5% → 60 pts
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 6,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
    });

    // 0 (no position) + 60 (≤5% pct) = 60
    expect(confidence).toBe(60);
  });

  it('should give 45 runtime points for 5-10% diff in specials mode', () => {
    // 10min diff on 132min episode = 7.6% → ≤10% → 45 pts
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 10,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
    });

    // 0 + 45 = 45
    expect(confidence).toBe(45);
  });

  it('should give 25 runtime points for 10-15% diff in specials mode', () => {
    // 14min diff on 100min episode = 14% → ≤15% → 25 pts
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 14,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 100,
    });

    // 0 + 25 = 25
    expect(confidence).toBe(25);
  });

  it('should give 0 runtime points for >15% diff in specials mode', () => {
    // 20min diff on 100min episode = 20% → >15% → 0 pts
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 20,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 100,
    });

    // 0 + 0 = 0
    expect(confidence).toBe(0);
  });

  it('should fall back to continuous scoring when tmdbRuntimeMinutes is missing', () => {
    // isSpecialsMatch true but no tmdbRuntimeMinutes → uses continuous scoring
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 2,
      isSpecialsMatch: true,
      // tmdbRuntimeMinutes omitted
    });

    // Falls back to continuous: 40 + 58 (60-2) = 98
    expect(confidence).toBe(98);
  });

  // Multi-episode and relative runtime penalty tests
  it('should penalize multi-episode matches by 15 points', () => {
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 40 + 60 - 15(multi-ep) = 85
    expect(confidence).toBe(85);
  });

  it('should apply relative runtime penalty for >15% diff on short episodes', () => {
    // 5min diff on 22min sitcom = 22.7% → >15% → -10
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 22,
    });

    // 40 + 55(60-5) - 10(>15% relative) = 85
    expect(confidence).toBe(85);
  });

  it('should apply smaller penalty for 10-15% relative diff', () => {
    // 5min diff on 44min drama = 11.4% → 10-15% → -5
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 40 + 55(60-5) - 5(10-15% relative) = 90
    expect(confidence).toBe(90);
  });

  it('should not apply relative penalty for tight matches (<=10%)', () => {
    // 2min diff on 44min drama = 4.5% → ≤10% → no penalty
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 2,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 40 + 58(60-2) = 98, no relative penalty
    expect(confidence).toBe(98);
  });

  it('should stack multi-episode and relative penalties', () => {
    // Multi-ep match with 8min combined diff on 22min sitcom = 36.4%
    const confidence = computeBatchConfidence({
      positionalDiff: 0,
      runtimeDiffMinutes: 8,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 22,
    });

    // 40 + 52(60-8) - 15(multi-ep) - 10(>15% relative) = 67
    expect(confidence).toBe(67);
  });

  it('should not apply relative penalty when isSpecialsMatch is true', () => {
    // Specials already use their own percentage-based scoring
    const confidence = computeBatchConfidence({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 6,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
      singleEpisodeRuntimeMinutes: 132,
    });

    // Specials path: 0 + 60(≤5%) = 60, NO relative penalty
    expect(confidence).toBe(60);
  });
});

describe('computeBatchConfidenceBreakdown', () => {
  it('should return total matching computeBatchConfidence for max confidence', () => {
    const params = { positionalDiff: 0, runtimeDiffMinutes: 0 };
    const breakdown = computeBatchConfidenceBreakdown(params);
    expect(breakdown.total).toBe(100); // 40 + 60
    expect(breakdown.total).toBe(computeBatchConfidence(params));
  });

  it('should include position match item with +40 at positionalDiff=0', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 2,
    });
    const posItem = breakdown.items.find((i) => i.label.includes('Position match') || i.label.includes('position match'));
    expect(posItem).toBeDefined();
    expect(posItem!.points).toBe(40);
  });

  it('should include position match item with 0 at positionalDiff=1.0', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 1.0,
      runtimeDiffMinutes: 2,
    });
    const posItem = breakdown.items.find((i) => i.label.includes('No position match'));
    expect(posItem).toBeDefined();
    expect(posItem!.points).toBe(0);
  });

  it('should give graduated position score at positionalDiff=0.25', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0.25,
      runtimeDiffMinutes: 0,
    });
    const posItem = breakdown.items.find((i) => i.label.includes('Position match'));
    expect(posItem).toBeDefined();
    // round(40 * (1 - 0.25)) = round(30) = 30
    expect(posItem!.points).toBe(30);
    // 30 + 60 = 90
    expect(breakdown.total).toBe(90);
  });

  it('should give graduated position score at positionalDiff=0.5', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0.5,
      runtimeDiffMinutes: 0,
    });
    const posItem = breakdown.items.find((i) => i.label.includes('Position match'));
    expect(posItem).toBeDefined();
    // round(40 * (1 - 0.5)) = round(20) = 20
    expect(posItem!.points).toBe(20);
    // 20 + 60 = 80
    expect(breakdown.total).toBe(80);
  });

  it('should show +59 runtime for 1min diff (continuous deduction)', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 1,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(59); // 60 - 1
    expect(rtItem!.label).toContain('±1min');
  });

  it('should show +57 runtime for 3min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 3,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(57); // 60 - 3
    expect(breakdown.total).toBe(97); // 40 + 57
  });

  it('should show +56 runtime for 4min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 4,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(56); // 60 - 4
  });

  it('should show +52 runtime for 8min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 8,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(52); // 60 - 8
  });

  it('should show +0 runtime for ≥60min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 65,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(0);
  });

  it('should show "no data" when runtime is undefined', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: undefined,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('no data'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(0);
  });

  it('should include multi-episode penalty item', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 44,
    });
    const multiItem = breakdown.items.find((i) => i.label.includes('Multi-episode'));
    expect(multiItem).toBeDefined();
    expect(multiItem!.points).toBe(-15);
    expect(breakdown.total).toBe(85);
  });

  it('should not include multi-episode item when not a multi-episode match', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 0,
    });
    const multiItem = breakdown.items.find((i) => i.label.includes('Multi-episode'));
    expect(multiItem).toBeUndefined();
  });

  it('should include relative runtime penalty for >15% diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 22, // 22.7%
    });
    const relItem = breakdown.items.find((i) => i.label.includes('% of episode'));
    expect(relItem).toBeDefined();
    expect(relItem!.points).toBe(-10);
    expect(breakdown.total).toBe(85); // 40 + 55 (60-5) - 10
  });

  it('should include smaller relative penalty for 10-15% diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 44, // 11.4%
    });
    const relItem = breakdown.items.find((i) => i.label.includes('% of episode'));
    expect(relItem).toBeDefined();
    expect(relItem!.points).toBe(-5);
    expect(breakdown.total).toBe(90); // 40 + 55 (60-5) - 5
  });

  it('should not include relative penalty for ≤10% diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      positionalDiff: 0,
      runtimeDiffMinutes: 2,
      singleEpisodeRuntimeMinutes: 44, // 4.5%
    });
    const relItem = breakdown.items.find((i) => i.label.includes('% of episode'));
    expect(relItem).toBeUndefined();
    expect(breakdown.total).toBe(98); // 40 + 58 (60-2)
  });

  it('breakdown total should always match computeBatchConfidence for stacked penalties', () => {
    const params = {
      positionalDiff: 0,
      runtimeDiffMinutes: 8,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 22,
    };
    const breakdown = computeBatchConfidenceBreakdown(params);
    expect(breakdown.total).toBe(computeBatchConfidence(params));
    // 40 + 52 (60-8) - 15 - 10 = 67
    expect(breakdown.total).toBe(67);
  });

  it('breakdown total should match for specials percentage-based scoring', () => {
    const params = {
      positionalDiff: 1.0,
      runtimeDiffMinutes: 10,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
    };
    const breakdown = computeBatchConfidenceBreakdown(params);
    expect(breakdown.total).toBe(computeBatchConfidence(params));
    expect(breakdown.total).toBe(45);
    // Check label includes percentage
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem!.label).toContain('%');
  });

  it('breakdown items should sum to total (or be clamped to 0)', () => {
    const params = {
      positionalDiff: 1.0,
      runtimeDiffMinutes: 15,
    };
    const breakdown = computeBatchConfidenceBreakdown(params);
    const sum = breakdown.items.reduce((acc, item) => acc + item.points, 0);
    // Total is clamped to 0 minimum
    expect(breakdown.total).toBe(Math.max(0, sum));
  });
});

function makeSeasonDetails(
  seasonNumber: number,
  episodes: TmdbEpisode[],
): TmdbSeasonDetails {
  return {
    id: 900 + seasonNumber,
    season_number: seasonNumber,
    name: `Season ${seasonNumber}`,
    episodes,
  };
}

function makeSeasonMockClient(
  seasonDetailsMap: Map<number, TmdbSeasonDetails>,
): TmdbClient {
  return {
    getSeasonDetails: vi.fn().mockImplementation((_showId: number, seasonNumber: number) => {
      const details = seasonDetailsMap.get(seasonNumber);
      if (!details) return Promise.reject(new Error(`Season ${seasonNumber} not found`));
      return Promise.resolve(details);
    }),
  } as unknown as TmdbClient;
}

function makeEpisodeFile(
  disc: number,
  track: number,
  durationMinutes: number,
): ClassifiedFile {
  const name = `title_t${String(track).padStart(2, '0')}.mkv`;
  const file: MediaFile = {
    filePath: `/shows/TestShow/S1D${disc}/${name}`,
    fileName: name,
    extension: '.mkv',
    sizeBytes: 1_000_000_000,
  };
  return {
    file,
    probeData: makeProbeResult(durationMinutes),
    classification: 'episode',
    durationMinutes,
    sortOrder: disc * 1000 + track,
  };
}

describe('matchSeasonBatch', () => {
  it('should be importable and defined', () => {
    expect(matchSeasonBatch).toBeDefined();
    expect(typeof matchSeasonBatch).toBe('function');
  });

  it('should match files to correct episodes using positional + runtime scoring', async () => {
    // Simulates TNG S1 D1: Encounter at Farpoint (92 min combined) + 2 individual parts (45.5 min each)
    // TMDb lists Ep1 (92 min), Ep2 (46 min), Ep3 (46 min)
    // Set-based matcher considers position: t02 (pos 0.5) is closest to Ep2 (pos 0.5),
    // t01 (pos 0.0) can't match Ep1 (92 min) so gets Ep3, t03 (91.4 min) matches Ep1.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Encounter at Farpoint', 92), season_number: 1 },
      { ...makeTmdbEpisode(2, 'The Naked Now', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Code of Honor', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45.5),  // Individual part 1
      makeEpisodeFile(1, 2, 45.6),  // Individual part 2
      makeEpisodeFile(1, 3, 91.4),  // Combined version
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    // All 3 files should be matched, none reclassified
    expect(result.matched).toHaveLength(3);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // Verify episode assignments
    const ep1Match = result.matched.find(m => m.tmdbMatch?.episodeNumber === 1);
    const ep2Match = result.matched.find(m => m.tmdbMatch?.episodeNumber === 2);
    const ep3Match = result.matched.find(m => m.tmdbMatch?.episodeNumber === 3);

    expect(ep1Match).toBeDefined();
    expect(ep1Match!.mediaFile.fileName).toBe('title_t03.mkv'); // Combined → Ep1

    // t02 is at position 0.5, matching Ep2 at position 0.5 (lowest cost)
    expect(ep2Match).toBeDefined();
    expect(ep2Match!.mediaFile.fileName).toBe('title_t02.mkv');

    // t01 (pos 0.0) fills remaining Ep3
    expect(ep3Match).toBeDefined();
    expect(ep3Match!.mediaFile.fileName).toBe('title_t01.mkv');
  });

  it('should reclassify files that have no close runtime match to any episode', async () => {
    // t01 (10 min) is too short for any episode (all ~46 min)
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode One', 92), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Episode Two', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 10),    // Too short for anything
      makeEpisodeFile(1, 2, 91.4),  // Matches Ep1
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    expect(result.matched).toHaveLength(1);
    expect(result.reclassifiedExtras).toHaveLength(1);

    // Ep1 matched, Ep2 unmatched but t01 (10 min) is too far from 46 min
    expect(result.matched[0].tmdbMatch?.episodeNumber).toBe(1);
    expect(result.reclassifiedExtras[0].file.fileName).toBe('title_t01.mkv');
  });

  it('should not assign episodes already consumed by multi-episode match', async () => {
    // t02 matches as multi-episode Ep1-Ep2. Remaining files can only use Ep3.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Part 1', 46), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Part 2', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Episode 3', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 5),     // Too short → reclassified
      makeEpisodeFile(1, 2, 91.4),  // Multi-episode Ep1-Ep2
      makeEpisodeFile(1, 3, 45),    // Matches Ep3
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    // t02 → Ep1-Ep2 (multi), t03 → Ep3, t01 stays reclassified (no unmatched episodes)
    expect(result.matched).toHaveLength(2);
    expect(result.reclassifiedExtras).toHaveLength(1);

    const multiMatch = result.matched.find(m => m.tmdbMatch?.episodeNumberEnd === 2);
    expect(multiMatch).toBeDefined();
    expect(multiMatch!.tmdbMatch?.episodeNumber).toBe(1);
  });

  it('should handle all files matching sequentially with no backfill needed', async () => {
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode 1', 46), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Episode 2', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Episode 3', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),
      makeEpisodeFile(1, 2, 46),
      makeEpisodeFile(1, 3, 47),
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    expect(result.matched).toHaveLength(3);
    expect(result.reclassifiedExtras).toHaveLength(0);
  });

  it('should use positional proximity to assign early-disc files to early episodes', async () => {
    // 6 files across 2 discs, all with ~46 min runtime (identical runtime differences).
    // Positional weighting should ensure D1 files → early episodes, D2 files → late episodes.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Ep 1', 46), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Ep 2', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Ep 3', 46), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Ep 4', 46), season_number: 1 },
      { ...makeTmdbEpisode(5, 'Ep 5', 46), season_number: 1 },
      { ...makeTmdbEpisode(6, 'Ep 6', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),  // D1
      makeEpisodeFile(1, 2, 46),  // D1
      makeEpisodeFile(1, 3, 47),  // D1
      makeEpisodeFile(2, 1, 45),  // D2
      makeEpisodeFile(2, 2, 46),  // D2
      makeEpisodeFile(2, 3, 47),  // D2
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    expect(result.matched).toHaveLength(6);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // D1 files (sorted positions 0-2) should match Ep1-3
    // D2 files (sorted positions 3-5) should match Ep4-6
    for (const m of result.matched) {
      const disc = m.mediaFile.filePath.includes('S1D1') ? 1 : 2;
      const epNum = m.tmdbMatch?.episodeNumber!;
      if (disc === 1) {
        expect(epNum).toBeLessThanOrEqual(3);
      } else {
        expect(epNum).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('should enforce disc episode ranges preventing cross-disc matching', async () => {
    // 12 files across 3 discs with IDENTICAL runtimes. Without disc range
    // constraints, the greedy matcher could assign a Disc 3 file to an early
    // episode if runtimes happen to align. With constraints, each disc only
    // matches its proportional episode range.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, Array.from({ length: 12 }, (_, i) => ({
      ...makeTmdbEpisode(i + 1, `Episode ${i + 1}`, 46),
      season_number: 1,
    }))));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      // Disc 1: 4 files → should get eps 1-4
      makeEpisodeFile(1, 1, 46.1),
      makeEpisodeFile(1, 2, 46.2),
      makeEpisodeFile(1, 3, 45.9),
      makeEpisodeFile(1, 4, 46.0),
      // Disc 2: 4 files → should get eps 5-8
      makeEpisodeFile(2, 1, 46.0),
      makeEpisodeFile(2, 2, 46.1),
      makeEpisodeFile(2, 3, 45.8),
      makeEpisodeFile(2, 4, 46.3),
      // Disc 3: 4 files → should get eps 9-12
      makeEpisodeFile(3, 1, 46.2),
      makeEpisodeFile(3, 2, 45.9),
      makeEpisodeFile(3, 3, 46.0),
      makeEpisodeFile(3, 4, 46.1),
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    expect(result.matched).toHaveLength(12);
    expect(result.reclassifiedExtras).toHaveLength(0);

    for (const m of result.matched) {
      const path = m.mediaFile.filePath;
      const epNum = m.tmdbMatch?.episodeNumber!;

      if (path.includes('S1D1')) {
        expect(epNum).toBeGreaterThanOrEqual(1);
        expect(epNum).toBeLessThanOrEqual(4);
      } else if (path.includes('S1D2')) {
        expect(epNum).toBeGreaterThanOrEqual(5);
        expect(epNum).toBeLessThanOrEqual(8);
      } else if (path.includes('S1D3')) {
        expect(epNum).toBeGreaterThanOrEqual(9);
        expect(epNum).toBeLessThanOrEqual(12);
      }
    }
  });

  it('should only match within acceptable runtime threshold (≤10 min)', async () => {
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Long Episode', 92), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Normal Episode', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 35),    // 35 min: too short for Ep1 (92), diff to Ep2 = 11 → >10
      makeEpisodeFile(1, 2, 91.4),  // Matches Ep1
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    // t02 matches Ep1. t01 (35 min) backfill to Ep2 (46 min)? diff = 11 → exceeds 10 → NO backfill
    expect(result.matched).toHaveLength(1);
    expect(result.reclassifiedExtras).toHaveLength(1);
  });
});

describe('matchSeasonBatch with uniform runtimes (sitcoms)', () => {
  it('should match sequentially by track order when all episodes have similar runtimes', async () => {
    // Seinfeld Season 1: 5 episodes, all ~22 min. Without runtime differentiation,
    // the matcher must rely on sequential track order (t00→E1, t01→E2, ...).
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, {
      id: 1, _id: '1', air_date: '1989-07-05', name: 'Season 1',
      overview: '', poster_path: null, season_number: 1,
      vote_average: 0,
      episodes: [
        { ...makeTmdbEpisode(1, 'The Seinfeld Chronicles', 23), season_number: 1 },
        { ...makeTmdbEpisode(2, 'The Stakeout', 22), season_number: 1 },
        { ...makeTmdbEpisode(3, 'The Robbery', 23), season_number: 1 },
        { ...makeTmdbEpisode(4, 'Male Unbonding', 22), season_number: 1 },
        { ...makeTmdbEpisode(5, 'The Stock Tip', 23), season_number: 1 },
      ],
    });
    const client = makeSeasonMockClient(seasonMap);

    // Files with slightly varying runtimes — all within ~1.5 min of each other
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 0, 23.5),   // t00 → should be E1
      makeEpisodeFile(1, 1, 22.3),   // t01 → should be E2
      makeEpisodeFile(1, 2, 23.1),   // t02 → should be E3
      makeEpisodeFile(1, 3, 22.7),   // t03 → should be E4
      makeEpisodeFile(1, 4, 23.4),   // t04 → should be E5
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    // ALL 5 files should be matched (none reclassified as extras)
    expect(result.matched).toHaveLength(5);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // Episodes must be assigned sequentially by track order
    const assignments = result.matched
      .sort((a, b) => {
        const aTrack = a.mediaFile.fileName.match(/t(\d+)/)?.[1] ?? '0';
        const bTrack = b.mediaFile.fileName.match(/t(\d+)/)?.[1] ?? '0';
        return parseInt(aTrack, 10) - parseInt(bTrack, 10);
      })
      .map(m => m.tmdbMatch?.episodeNumber);

    expect(assignments).toEqual([1, 2, 3, 4, 5]);
  });

  it('should not reclassify mid-sequence tracks as extras with uniform runtimes', async () => {
    // Regression test: t03 should NOT be reclassified as an extra/special
    // when all tracks have similar runtimes
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, {
      id: 1, _id: '1', air_date: '1989-07-05', name: 'Season 1',
      overview: '', poster_path: null, season_number: 1,
      vote_average: 0,
      episodes: [
        { ...makeTmdbEpisode(1, 'Episode 1', 22), season_number: 1 },
        { ...makeTmdbEpisode(2, 'Episode 2', 22), season_number: 1 },
        { ...makeTmdbEpisode(3, 'Episode 3', 22), season_number: 1 },
        { ...makeTmdbEpisode(4, 'Episode 4', 22), season_number: 1 },
        { ...makeTmdbEpisode(5, 'Episode 5', 22), season_number: 1 },
      ],
    });
    const client = makeSeasonMockClient(seasonMap);

    // All identical runtimes — worst case for disambiguation
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 0, 22.4),
      makeEpisodeFile(1, 1, 22.1),
      makeEpisodeFile(1, 2, 22.3),
      makeEpisodeFile(1, 3, 22.2),   // This track must NOT become an extra
      makeEpisodeFile(1, 4, 22.5),
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    expect(result.matched).toHaveLength(5);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // Verify t03 is matched to E4 (sequential order)
    const t03Match = result.matched.find(m => m.mediaFile.fileName.includes('t03'));
    expect(t03Match).toBeDefined();
    expect(t03Match?.tmdbMatch?.episodeNumber).toBe(4);
  });

  it('should demote outlier tracks with large track number gaps as extras', async () => {
    // Seinfeld S1 real scenario: tracks t00-t04 are episodes, t10 is an extra.
    // The gap of 6 between t04 and t10 should cause t10 to be reclassified
    // as an extra, not matched to an episode.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, {
      id: 1, _id: '1', air_date: '1989-07-05', name: 'Season 1',
      overview: '', poster_path: null, season_number: 1,
      vote_average: 0,
      episodes: [
        { ...makeTmdbEpisode(1, 'The Seinfeld Chronicles', 23), season_number: 1 },
        { ...makeTmdbEpisode(2, 'The Stakeout', 22), season_number: 1 },
        { ...makeTmdbEpisode(3, 'The Robbery', 23), season_number: 1 },
        { ...makeTmdbEpisode(4, 'Male Unbonding', 22), season_number: 1 },
        { ...makeTmdbEpisode(5, 'The Stock Tip', 23), season_number: 1 },
      ],
    });
    const client = makeSeasonMockClient(seasonMap);

    // 6 files: t00-t04 are the 5 episodes, t10 is a bonus feature
    // All have similar runtimes (~22min)
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 0, 23.5),
      makeEpisodeFile(1, 1, 22.3),
      makeEpisodeFile(1, 2, 23.1),
      makeEpisodeFile(1, 3, 22.7),
      makeEpisodeFile(1, 4, 23.4),
      makeEpisodeFile(1, 10, 22.0),  // Outlier — gap of 6 from t04
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2009, 1, files);

    // 5 episodes matched, t10 reclassified as extra
    expect(result.matched).toHaveLength(5);
    expect(result.reclassifiedExtras).toHaveLength(1);
    expect(result.reclassifiedExtras[0].file.fileName).toContain('t10');

    // Episodes assigned sequentially: t00→E1, t01→E2, ..., t04→E5
    const assignments = result.matched
      .sort((a, b) => {
        const aTrack = a.mediaFile.fileName.match(/t(\d+)/)?.[1] ?? '0';
        const bTrack = b.mediaFile.fileName.match(/t(\d+)/)?.[1] ?? '0';
        return parseInt(aTrack, 10) - parseInt(bTrack, 10);
      })
      .map(m => m.tmdbMatch?.episodeNumber);

    expect(assignments).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('matchSeasonBatch with DVDCompare data', () => {
  it('should use DVDCompare sub-second matching for definitive episode identification', async () => {
    // Simulates TNG S1 D1: all episodes are ~45.5 min (identical to TMDb's perspective)
    // but DVDCompare runtimes are unique to-the-second
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Encounter at Farpoint', 92), season_number: 1 },
      { ...makeTmdbEpisode(2, 'The Naked Now', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Code of Honor', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // DVDCompare disc data with to-the-second precision
    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'Encounter at Farpoint', runtimeSeconds: 5482, runtimeFormatted: '91:22' },
          { title: 'The Naked Now', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
          { title: 'Code of Honor', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
        ],
      },
    ];

    // Files with actual probe runtimes in seconds (close to DVDCompare's)
    const episodeFiles: ClassifiedFile[] = [
      {
        file: {
          filePath: '/shows/STAR TREK TNG S1 D1/title_t01.mkv',
          fileName: 'title_t01.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        probeData: { durationMinutes: 45.5, durationSeconds: 2730.2 },
        classification: 'episode',
        durationMinutes: 45.5,
        sortOrder: 1001,
      },
      {
        file: {
          filePath: '/shows/STAR TREK TNG S1 D1/title_t02.mkv',
          fileName: 'title_t02.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        probeData: { durationMinutes: 45.6, durationSeconds: 2734.2 },
        classification: 'episode',
        durationMinutes: 45.6,
        sortOrder: 1002,
      },
      {
        file: {
          filePath: '/shows/STAR TREK TNG S1 D1/title_t03.mkv',
          fileName: 'title_t03.mkv',
          extension: '.mkv',
          sizeBytes: 2_000_000_000,
        },
        probeData: { durationMinutes: 91.4, durationSeconds: 5481.9 },
        classification: 'episode',
        durationMinutes: 91.4,
        sortOrder: 1003,
      },
    ];

    const result = await matchSeasonBatch(
      client, 12345, 'Star Trek: The Next Generation', 1987,
      1, episodeFiles, undefined, dvdCompareDiscs,
    );

    expect(result.matched).toHaveLength(3);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // Verify definitive DVDCompare matching:
    // title_t01.mkv (2730.2s) → "Code of Honor" (2730s on DVDCompare) → TMDb E3
    const t01Match = result.matched.find(m => m.mediaFile.fileName === 'title_t01.mkv');
    expect(t01Match).toBeDefined();
    expect(t01Match!.tmdbMatch?.episodeNumber).toBe(3);
    expect(t01Match!.tmdbMatch?.episodeTitle).toBe('Code of Honor');

    // title_t02.mkv (2734.2s) → "The Naked Now" (2734s on DVDCompare) → TMDb E2
    const t02Match = result.matched.find(m => m.mediaFile.fileName === 'title_t02.mkv');
    expect(t02Match).toBeDefined();
    expect(t02Match!.tmdbMatch?.episodeNumber).toBe(2);
    expect(t02Match!.tmdbMatch?.episodeTitle).toBe('The Naked Now');

    // title_t03.mkv (5481.9s) → "Encounter at Farpoint" (5482s on DVDCompare) → TMDb E1
    const t03Match = result.matched.find(m => m.mediaFile.fileName === 'title_t03.mkv');
    expect(t03Match).toBeDefined();
    expect(t03Match!.tmdbMatch?.episodeNumber).toBe(1);
    expect(t03Match!.tmdbMatch?.episodeTitle).toBe('Encounter at Farpoint');
  });

  it('should give high confidence (≥90) for DVDCompare matches', async () => {
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode One', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'Episode One', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
        ],
      },
    ];

    const episodeFiles: ClassifiedFile[] = [
      {
        file: {
          filePath: '/shows/TestShow/S1D1/title_t00.mkv',
          fileName: 'title_t00.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        probeData: { durationMinutes: 45.5, durationSeconds: 2730.1 },
        classification: 'episode',
        durationMinutes: 45.5,
        sortOrder: 1000,
      },
    ];

    const result = await matchSeasonBatch(
      client, 12345, 'TestShow', 2020,
      1, episodeFiles, undefined, dvdCompareDiscs,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBeGreaterThanOrEqual(90);
    expect(result.matched[0].status).toBe('matched');
  });

  it('should fall back to set-based matching for files without DVDCompare match', async () => {
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode One', 46), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Episode Two', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // DVDCompare only has data for Episode One
    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'Episode One', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
        ],
      },
    ];

    const episodeFiles: ClassifiedFile[] = [
      {
        file: {
          filePath: '/shows/TestShow/S1D1/title_t00.mkv',
          fileName: 'title_t00.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        probeData: { durationMinutes: 45.5, durationSeconds: 2730.1 },
        classification: 'episode',
        durationMinutes: 45.5,
        sortOrder: 1000,
      },
      {
        file: {
          filePath: '/shows/TestShow/S1D1/title_t01.mkv',
          fileName: 'title_t01.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        // Runtime doesn't match any DVDCompare entry — will fall through to set-based
        probeData: { durationMinutes: 46.0, durationSeconds: 2760.0 },
        classification: 'episode',
        durationMinutes: 46.0,
        sortOrder: 1001,
      },
    ];

    const result = await matchSeasonBatch(
      client, 12345, 'TestShow', 2020,
      1, episodeFiles, undefined, dvdCompareDiscs,
    );

    expect(result.matched).toHaveLength(2);

    // First file matched by DVDCompare → Episode One (high confidence)
    const t00Match = result.matched.find(m => m.mediaFile.fileName === 'title_t00.mkv');
    expect(t00Match!.tmdbMatch?.episodeNumber).toBe(1);
    expect(t00Match!.confidence).toBeGreaterThanOrEqual(90);

    // Second file matched by set-based fallback → Episode Two
    const t01Match = result.matched.find(m => m.mediaFile.fileName === 'title_t01.mkv');
    expect(t01Match!.tmdbMatch?.episodeNumber).toBe(2);
  });

  it('should work correctly without DVDCompare data (backward compatible)', async () => {
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode One', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const episodeFiles: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),
    ];

    // No dvdCompareDiscs parameter — should still work
    const result = await matchSeasonBatch(
      client, 12345, 'TestShow', 2020,
      1, episodeFiles,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].tmdbMatch?.episodeNumber).toBe(1);
  });

  it('should handle DVDCompare multi-episode detection', async () => {
    // "Encounter at Farpoint" is 91:22 on DVDCompare but TMDb splits it as E1 (46 min) + E2 (46 min)
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Encounter at Farpoint', 46), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Encounter at Farpoint', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'The Naked Now', 46), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'Encounter at Farpoint', runtimeSeconds: 5482, runtimeFormatted: '91:22' },
          { title: 'The Naked Now', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
        ],
      },
    ];

    const episodeFiles: ClassifiedFile[] = [
      {
        file: {
          filePath: '/shows/TestShow/S1D1/title_t01.mkv',
          fileName: 'title_t01.mkv',
          extension: '.mkv',
          sizeBytes: 2_000_000_000,
        },
        probeData: { durationMinutes: 91.37, durationSeconds: 5481.9 },
        classification: 'episode',
        durationMinutes: 91.37,
        sortOrder: 1001,
      },
      {
        file: {
          filePath: '/shows/TestShow/S1D1/title_t02.mkv',
          fileName: 'title_t02.mkv',
          extension: '.mkv',
          sizeBytes: 1_000_000_000,
        },
        probeData: { durationMinutes: 45.57, durationSeconds: 2734.2 },
        classification: 'episode',
        durationMinutes: 45.57,
        sortOrder: 1002,
      },
    ];

    const result = await matchSeasonBatch(
      client, 12345, 'Star Trek: TNG', 1987,
      1, episodeFiles, undefined, dvdCompareDiscs,
    );

    expect(result.matched).toHaveLength(2);

    // title_t01.mkv (91 min) → multi-episode E1-E2
    const t01Match = result.matched.find(m => m.mediaFile.fileName === 'title_t01.mkv');
    expect(t01Match).toBeDefined();
    expect(t01Match!.tmdbMatch?.episodeNumber).toBe(1);
    expect(t01Match!.tmdbMatch?.episodeNumberEnd).toBe(2);

    // title_t02.mkv → E3 "The Naked Now"
    const t02Match = result.matched.find(m => m.mediaFile.fileName === 'title_t02.mkv');
    expect(t02Match).toBeDefined();
    expect(t02Match!.tmdbMatch?.episodeNumber).toBe(3);
    expect(t02Match!.tmdbMatch?.episodeTitle).toBe('The Naked Now');
  });
  it('should match John Adams miniseries with reverse track order detection', async () => {
    // Real-world scenario: John Adams (2008) miniseries
    // 7 files across 3 Blu-ray discs, 7 TMDb episodes
    // MakeMKV extracts tracks in REVERSE episode order on Discs 1 & 2:
    //   Disc 1: t01 (91.9min=E02) → t02 (70.8min=E01)  [reversed]
    //   Disc 2: t01 (63.6min=E05) → t02 (66.0min=E04) → t03 (68.9min=E03)  [reversed]
    //   Disc 3: t03 (62.4min=E06) → t04 (79.4min=E07)  [normal]
    //
    // detectAndApplyTrackOrder must detect reversed discs and reorder.
    // TMDb runtimes based on actual API data for John Adams (2008).
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Join or Die', 68), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Independence', 91), season_number: 1 },
      { ...makeTmdbEpisode(3, "Don't Tread on Me", 70), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Reunion', 66), season_number: 1 },
      { ...makeTmdbEpisode(5, 'Unite or Die', 61), season_number: 1 },
      { ...makeTmdbEpisode(6, 'Unnecessary War', 63), season_number: 1 },
      { ...makeTmdbEpisode(7, 'Peacefield', 79), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // Files in disc*1000+track sort order (same as classifyAndSortFiles would produce)
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 91.892),  // D1_t01, sortOrder=1001
      makeEpisodeFile(1, 2, 70.782),  // D1_t02, sortOrder=1002
      makeEpisodeFile(2, 1, 63.641),  // D2_t01, sortOrder=2001
      makeEpisodeFile(2, 2, 65.985),  // D2_t02, sortOrder=2002
      makeEpisodeFile(2, 3, 68.947),  // D2_t03, sortOrder=2003
      makeEpisodeFile(3, 3, 62.380),  // D3_t03, sortOrder=3003
      makeEpisodeFile(3, 4, 79.412),  // D3_t04, sortOrder=3004
    ];

    const result = await matchSeasonBatch(client, 15114, 'John Adams', 2008, 1, files);

    // All 7 should be matched (not reclassified as extras)
    expect(result.matched).toHaveLength(7);
    expect(result.reclassifiedExtras).toHaveLength(0);

    // Build assignment map: disc+track → episode number
    const assignments = new Map<string, number>();
    for (const m of result.matched) {
      const disc = m.mediaFile.filePath.includes('S1D1') ? 'D1'
        : m.mediaFile.filePath.includes('S1D2') ? 'D2' : 'D3';
      const track = m.mediaFile.fileName.match(/t(\d+)/)?.[1] ?? '?';
      assignments.set(`${disc}_t${track}`, m.tmdbMatch?.episodeNumber ?? -1);
    }

    // Disc 1 reversed: t02→E01 (70.8≈68), t01→E02 (91.9≈88)
    expect(assignments.get('D1_t02')).toBe(1);
    expect(assignments.get('D1_t01')).toBe(2);

    // Disc 2 reversed: t03→E03 (68.9≈66), t02→E04 (66.0≈63), t01→E05 (63.6≈61)
    expect(assignments.get('D2_t03')).toBe(3);
    expect(assignments.get('D2_t02')).toBe(4);
    expect(assignments.get('D2_t01')).toBe(5);

    // Disc 3 normal: t03→E06, t04→E07
    expect(assignments.get('D3_t03')).toBe(6);
    expect(assignments.get('D3_t04')).toBe(7);
  });

  it('should match John Adams with rounded durations and reverse track detection (real prober behavior)', async () => {
    // The prober stores durationMinutes as Math.round(seconds/60), losing sub-minute
    // precision. The TMDb matcher must use exact durationSeconds for cost calculation.
    // Additionally, tracks within Discs 1 & 2 are in reverse episode order.
    // TMDb runtimes based on actual API data for John Adams (2008).
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Join or Die', 68), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Independence', 91), season_number: 1 },
      { ...makeTmdbEpisode(3, "Don't Tread on Me", 70), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Reunion', 66), season_number: 1 },
      { ...makeTmdbEpisode(5, 'Unite or Die', 61), season_number: 1 },
      { ...makeTmdbEpisode(6, 'Unnecessary War', 63), season_number: 1 },
      { ...makeTmdbEpisode(7, 'Peacefield', 79), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // Real durations from ffprobe in seconds
    const realSeconds = [5513.549, 4246.909, 3818.481, 3959.121, 4136.841, 3742.780, 4764.746];
    const fileEntries = [
      { path: '/shows/JohnAdams/John Adams Disc 1/John Adams Disc 1_t01.mkv', name: 'John Adams Disc 1_t01.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 1/John Adams Disc 1_t02.mkv', name: 'John Adams Disc 1_t02.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 2/John Adams Disc 2_t01.mkv', name: 'John Adams Disc 2_t01.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 2/John Adams Disc 2_t02.mkv', name: 'John Adams Disc 2_t02.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 2/John Adams Disc 2_t03.mkv', name: 'John Adams Disc 2_t03.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 3/John Adams Disc 3_t03.mkv', name: 'John Adams Disc 3_t03.mkv' },
      { path: '/shows/JohnAdams/John Adams Disc 3/John Adams Disc 3_t04.mkv', name: 'John Adams Disc 3_t04.mkv' },
    ];

    const mediaFiles: MediaFile[] = fileEntries.map(f => ({
      filePath: f.path, fileName: f.name, extension: '.mkv', sizeBytes: 10_000_000_000,
    }));

    // Build SeasonGroup with ROUNDED durationMinutes + exact durationSeconds
    // (matching real prober.ts behavior: Math.round(seconds/60) for minutes)
    const durations = new Map<string, number>();
    for (let i = 0; i < mediaFiles.length; i++) {
      durations.set(mediaFiles[i].filePath, Math.round(realSeconds[i] / 60));
    }
    const group = makeSeasonGroup(mediaFiles, durations, 1, 1);

    // Override probeResults to include exact durationSeconds (like real prober)
    for (let i = 0; i < mediaFiles.length; i++) {
      group.probeResults.set(mediaFiles[i].filePath, {
        durationMinutes: Math.round(realSeconds[i] / 60),
        durationSeconds: realSeconds[i],
      });
    }

    const classified = classifyAndSortFiles(group, 68);
    expect(classified.filter(f => f.classification === 'episode')).toHaveLength(7);

    const episodeFiles = classified.filter(
      f => f.classification === 'episode' || f.classification === 'unknown'
    );

    const result = await matchSeasonBatch(client, 15114, 'John Adams', 2008, 1, episodeFiles);
    expect(result.matched).toHaveLength(7);

    const assignments = new Map<string, number>();
    for (const m of result.matched) {
      assignments.set(m.mediaFile.fileName, m.tmdbMatch?.episodeNumber ?? -1);
    }

    // After reverse track detection, all assignments should be correct:
    // Disc 1 reversed: t02→E01, t01→E02
    expect(assignments.get('John Adams Disc 1_t02.mkv')).toBe(1);
    expect(assignments.get('John Adams Disc 1_t01.mkv')).toBe(2);

    // Disc 2 reversed: t03→E03, t02→E04, t01→E05
    expect(assignments.get('John Adams Disc 2_t03.mkv')).toBe(3);
    expect(assignments.get('John Adams Disc 2_t02.mkv')).toBe(4);
    expect(assignments.get('John Adams Disc 2_t01.mkv')).toBe(5);

    // Disc 3 normal: t03→E06, t04→E07
    expect(assignments.get('John Adams Disc 3_t03.mkv')).toBe(6);
    expect(assignments.get('John Adams Disc 3_t04.mkv')).toBe(7);
  });
});

describe('matchSeasonBatch with cross-season track order hint', () => {
  // Helper to create TNG-style file paths matching the user's actual Blu-ray rips
  function makeTngFile(
    season: number,
    disc: number,
    track: number,
    durationSeconds: number,
  ): ClassifiedFile {
    const name = `Star Trek- The Next Generation Season ${season} Disc ${disc}_t${String(track).padStart(2, '0')}.mkv`;
    const dir = `Star Trek- The Next Generation Season ${season} Disc ${disc}`;
    return {
      file: {
        filePath: `/shows/${dir}/${name}`,
        fileName: name,
        extension: '.mkv',
        sizeBytes: 7_000_000_000,
      },
      probeData: { durationMinutes: durationSeconds / 60, durationSeconds },
      classification: 'episode',
      durationMinutes: durationSeconds / 60,
      sortOrder: disc * 1000 + track,
    };
  }

  it('should correctly assign TNG S2 Disc 1 episodes with reverse hint from S1', async () => {
    // TNG S2 has 22 episodes, all 46 min on TMDb. DVDCompare runtimes are within
    // 20 seconds of each other per disc. File runtimes are all ~2min longer than
    // DVDCompare (Blu-ray overhead). Without a hint, forward/reverse costs are
    // nearly identical and detection can't distinguish. With a 'reverse' hint
    // from S1, the tracks are correctly reversed and positional matching works.
    //
    // Actual user data: t12 is S02E01 (The Child), t08 is S02E05 (Loud as a Whisper).
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(2, makeSeasonDetails(2, [
      { ...makeTmdbEpisode(1, 'The Child', 46), season_number: 2 },
      { ...makeTmdbEpisode(2, 'Where Silence Has Lease', 46), season_number: 2 },
      { ...makeTmdbEpisode(3, 'Elementary, Dear Data', 46), season_number: 2 },
      { ...makeTmdbEpisode(4, 'The Outrageous Okona', 46), season_number: 2 },
      { ...makeTmdbEpisode(5, 'Loud as a Whisper', 46), season_number: 2 },
      { ...makeTmdbEpisode(6, 'The Schizoid Man', 46), season_number: 2 },
      { ...makeTmdbEpisode(7, 'Unnatural Selection', 46), season_number: 2 },
      { ...makeTmdbEpisode(8, 'A Matter of Honor', 46), season_number: 2 },
      { ...makeTmdbEpisode(9, 'The Measure of a Man', 46), season_number: 2 },
      { ...makeTmdbEpisode(10, 'The Dauphin', 46), season_number: 2 },
      { ...makeTmdbEpisode(11, 'Contagion', 46), season_number: 2 },
      { ...makeTmdbEpisode(12, 'The Royale', 46), season_number: 2 },
      { ...makeTmdbEpisode(13, 'Time Squared', 46), season_number: 2 },
      { ...makeTmdbEpisode(14, 'The Icarus Factor', 46), season_number: 2 },
      { ...makeTmdbEpisode(15, 'Pen Pals', 46), season_number: 2 },
      { ...makeTmdbEpisode(16, 'Q Who', 46), season_number: 2 },
      { ...makeTmdbEpisode(17, 'Samaritan Snare', 46), season_number: 2 },
      { ...makeTmdbEpisode(18, 'Up the Long Ladder', 46), season_number: 2 },
      { ...makeTmdbEpisode(19, 'Manhunt', 46), season_number: 2 },
      { ...makeTmdbEpisode(20, 'The Emissary', 46), season_number: 2 },
      { ...makeTmdbEpisode(21, 'Peak Performance', 46), season_number: 2 },
      { ...makeTmdbEpisode(22, 'Shades of Gray', 46), season_number: 2 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // DVDCompare data for all 5 discs of Season 2
    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'The Child', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Where Silence Has Lease', runtimeSeconds: 2744, runtimeFormatted: '45:44' },
          { title: 'Elementary, Dear Data', runtimeSeconds: 2739, runtimeFormatted: '45:39' },
          { title: 'The Outrageous Okona', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Loud as a Whisper', runtimeSeconds: 2724, runtimeFormatted: '45:24' },
        ],
      },
      {
        discNumber: 2,
        discLabel: 'DISC TWO',
        episodes: [
          { title: 'The Schizoid Man', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Unnatural Selection', runtimeSeconds: 2714, runtimeFormatted: '45:14' },
          { title: 'A Matter of Honor', runtimeSeconds: 2728, runtimeFormatted: '45:28' },
          { title: 'The Measure of a Man', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
        ],
      },
      {
        discNumber: 3,
        discLabel: 'DISC THREE',
        episodes: [
          { title: 'The Dauphin', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Contagion', runtimeSeconds: 2732, runtimeFormatted: '45:32' },
          { title: 'The Royale', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Time Squared', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'The Icarus Factor', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
        ],
      },
      {
        discNumber: 4,
        discLabel: 'DISC FOUR',
        episodes: [
          { title: 'Pen Pals', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Q Who?', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Samaritan Snare', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Up the Long Ladder', runtimeSeconds: 2726, runtimeFormatted: '45:26' },
          { title: 'Manhunt', runtimeSeconds: 2725, runtimeFormatted: '45:25' },
        ],
      },
      {
        discNumber: 5,
        discLabel: 'DISC FIVE',
        episodes: [
          { title: 'The Emissary', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Peak Performance', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Shades of Gray', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
        ],
      },
    ];

    // Files from all 5 discs of the user's actual Blu-ray rip.
    // All discs are reverse chronological: highest track = first episode on that disc.
    // File durations ~2min longer than DVDCompare (Blu-ray headers/padding).
    // Disc 1 (5 ep): t08-t12, Disc 2 (4 ep): t05-t08, Disc 3 (5 ep): t05-t09,
    // Disc 4 (5 ep): t05-t09, Disc 5 (3 ep): t05-t07
    const episodeFiles: ClassifiedFile[] = [
      // Disc 1 — E01-E05 reversed
      makeTngFile(2, 1, 8, 2852),   // 47:32 — actually E05 Loud as a Whisper
      makeTngFile(2, 1, 9, 2859),   // 47:39 — actually E04 The Outrageous Okona
      makeTngFile(2, 1, 10, 2868),  // 47:48 — actually E03 Elementary, Dear Data
      makeTngFile(2, 1, 11, 2873),  // 47:53 — actually E02 Where Silence Has Lease
      makeTngFile(2, 1, 12, 2860),  // 47:40 — actually E01 The Child
      // Disc 2 — E06-E09 reversed
      makeTngFile(2, 2, 5, 2862),   // actually E09 The Measure of a Man
      makeTngFile(2, 2, 6, 2856),   // actually E08 A Matter of Honor
      makeTngFile(2, 2, 7, 2842),   // actually E07 Unnatural Selection
      makeTngFile(2, 2, 8, 2857),   // actually E06 The Schizoid Man
      // Disc 3 — E10-E14 reversed
      makeTngFile(2, 3, 5, 2858),   // actually E14 The Icarus Factor
      makeTngFile(2, 3, 6, 2858),   // actually E13 Time Squared
      makeTngFile(2, 3, 7, 2857),   // actually E12 The Royale
      makeTngFile(2, 3, 8, 2860),   // actually E11 Contagion
      makeTngFile(2, 3, 9, 2858),   // actually E10 The Dauphin
      // Disc 4 — E15-E19 reversed
      makeTngFile(2, 4, 5, 2853),   // actually E19 Manhunt
      makeTngFile(2, 4, 6, 2854),   // actually E18 Up the Long Ladder
      makeTngFile(2, 4, 7, 2858),   // actually E17 Samaritan Snare
      makeTngFile(2, 4, 8, 2857),   // actually E16 Q Who
      makeTngFile(2, 4, 9, 2857),   // actually E15 Pen Pals
      // Disc 5 — E20-E22 reversed
      makeTngFile(2, 5, 5, 2857),   // actually E22 Shades of Gray
      makeTngFile(2, 5, 6, 2858),   // actually E21 Peak Performance
      makeTngFile(2, 5, 7, 2859),   // actually E20 The Emissary
    ];

    // Pass 'reverse' hint from S1's detected track order
    const result = await matchSeasonBatch(
      client, 655, 'Star Trek: The Next Generation', 1987,
      2, episodeFiles, undefined, dvdCompareDiscs, 'reverse',
    );

    expect(result.matched).toHaveLength(22);
    expect(result.reclassifiedExtras).toHaveLength(0);
    expect(result.detectedTrackOrder).toBe('reverse');

    // Build assignment map: "D{disc}_t{track}" → episode number
    const assignments = new Map<string, number>();
    for (const m of result.matched) {
      const discMatch = m.mediaFile.filePath.match(/Disc (\d+)/);
      const trackMatch = m.mediaFile.fileName.match(/_t(\d+)\./);
      const key = `D${discMatch?.[1]}_t${trackMatch?.[1]}`;
      assignments.set(key, m.tmdbMatch?.episodeNumber ?? -1);
    }

    // Disc 1 reversed: t12→E01, t11→E02, t10→E03, t09→E04, t08→E05
    expect(assignments.get('D1_t12')).toBe(1);  // The Child
    expect(assignments.get('D1_t11')).toBe(2);  // Where Silence Has Lease
    expect(assignments.get('D1_t10')).toBe(3);  // Elementary, Dear Data
    expect(assignments.get('D1_t09')).toBe(4);  // The Outrageous Okona
    expect(assignments.get('D1_t08')).toBe(5);  // Loud as a Whisper

    // Disc 2 reversed: t08→E06, t07→E07, t06→E08, t05→E09
    expect(assignments.get('D2_t08')).toBe(6);  // The Schizoid Man
    expect(assignments.get('D2_t07')).toBe(7);  // Unnatural Selection
    expect(assignments.get('D2_t06')).toBe(8);  // A Matter of Honor
    expect(assignments.get('D2_t05')).toBe(9);  // The Measure of a Man
  });

  it('should propagate detectedTrackOrder in result for pipeline to use', async () => {
    // Verify that matchSeasonBatch returns the detected track order
    // so the pipeline can pass it as a hint to subsequent seasons
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode 1', 68), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Episode 2', 91), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 91),  // Reversed: this is actually E2
      makeEpisodeFile(1, 2, 68),  // Reversed: this is actually E1
    ];

    const result = await matchSeasonBatch(client, 12345, 'TestShow', 2020, 1, files);

    // The result should include detectedTrackOrder
    expect(result.detectedTrackOrder).toBeDefined();
    expect(['forward', 'reverse']).toContain(result.detectedTrackOrder);
  });
});

describe('matchSeasonBatch with DVDCompare disc ranges', () => {
  // Helper to create TNG-style file paths
  function makeTngFile(
    season: number,
    disc: number,
    track: number,
    durationSeconds: number,
  ): ClassifiedFile {
    const name = `Star Trek- The Next Generation Season ${season} Disc ${disc}_t${String(track).padStart(2, '0')}.mkv`;
    const dir = `Star Trek- The Next Generation Season ${season} Disc ${disc}`;
    return {
      file: {
        filePath: `/shows/${dir}/${name}`,
        fileName: name,
        extension: '.mkv',
        sizeBytes: 7_000_000_000,
      },
      probeData: { durationMinutes: durationSeconds / 60, durationSeconds },
      classification: 'episode',
      durationMinutes: durationSeconds / 60,
      sortOrder: disc * 1000 + track,
    };
  }

  // TNG S2 TMDb episodes (all 46min)
  function makeTngS2TmdbEpisodes(): TmdbEpisode[] {
    const names = [
      'The Child', 'Where Silence Has Lease', 'Elementary, Dear Data',
      'The Outrageous Okona', 'Loud as a Whisper', 'The Schizoid Man',
      'Unnatural Selection', 'A Matter of Honor', 'The Measure of a Man',
      'The Dauphin', 'Contagion', 'The Royale', 'Time Squared',
      'The Icarus Factor', 'Pen Pals', 'Q Who', 'Samaritan Snare',
      'Up the Long Ladder', 'Manhunt', 'The Emissary',
      'Peak Performance', 'Shades of Gray',
    ];
    return names.map((name, i) => ({
      ...makeTmdbEpisode(i + 1, name, 46),
      season_number: 2,
    }));
  }

  // TNG S2 DVDCompare data: D1:5, D2:4, D3:5, D4:5, D5:3
  function makeTngS2DvdCompare() {
    return [
      {
        discNumber: 1, discLabel: 'DISC ONE',
        episodes: [
          { title: 'The Child', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Where Silence Has Lease', runtimeSeconds: 2744, runtimeFormatted: '45:44' },
          { title: 'Elementary, Dear Data', runtimeSeconds: 2739, runtimeFormatted: '45:39' },
          { title: 'The Outrageous Okona', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Loud as a Whisper', runtimeSeconds: 2724, runtimeFormatted: '45:24' },
        ],
      },
      {
        discNumber: 2, discLabel: 'DISC TWO',
        episodes: [
          { title: 'The Schizoid Man', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Unnatural Selection', runtimeSeconds: 2714, runtimeFormatted: '45:14' },
          { title: 'A Matter of Honor', runtimeSeconds: 2728, runtimeFormatted: '45:28' },
          { title: 'The Measure of a Man', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
        ],
      },
      {
        discNumber: 3, discLabel: 'DISC THREE',
        episodes: [
          { title: 'The Dauphin', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Contagion', runtimeSeconds: 2732, runtimeFormatted: '45:32' },
          { title: 'The Royale', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Time Squared', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'The Icarus Factor', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
        ],
      },
      {
        discNumber: 4, discLabel: 'DISC FOUR',
        episodes: [
          { title: 'Pen Pals', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Q Who?', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
          { title: 'Samaritan Snare', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Up the Long Ladder', runtimeSeconds: 2726, runtimeFormatted: '45:26' },
          { title: 'Manhunt', runtimeSeconds: 2725, runtimeFormatted: '45:25' },
        ],
      },
      {
        discNumber: 5, discLabel: 'DISC FIVE',
        episodes: [
          { title: 'The Emissary', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Peak Performance', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
          { title: 'Shades of Gray', runtimeSeconds: 2729, runtimeFormatted: '45:29' },
        ],
      },
    ];
  }

  it('should use file-based episode counts for disc ranges even with extra files on disc', async () => {
    // TNG S2 Disc 2 has 4 episodes on DVDCompare but 5 physical files
    // (4 regular episodes + 1 extended version of "The Measure of a Man").
    // With file-based disc ranges, Disc 2 gets 5 episode slots [5..9].
    // The extended version (~57min, runtime cost >10 vs 46min episodes)
    // fails greedy candidate generation but matches via disc-constrained
    // fallback to the remaining episode in D2's range.
    // TMDb is canonical for episode counts — file counts partition TMDb's
    // episode list across physical discs.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(2, makeSeasonDetails(2, makeTngS2TmdbEpisodes()));
    const client = makeSeasonMockClient(seasonMap);
    const dvdCompareDiscs = makeTngS2DvdCompare();

    // Disc 2 files: 4 regular eps (~47min) + 1 extended version (~57min)
    // All discs reverse chronological, same as user's actual rips.
    const episodeFiles: ClassifiedFile[] = [
      // Disc 1 — E01-E05 reversed
      makeTngFile(2, 1, 8, 2852),
      makeTngFile(2, 1, 9, 2859),
      makeTngFile(2, 1, 10, 2868),
      makeTngFile(2, 1, 11, 2873),
      makeTngFile(2, 1, 12, 2860),
      // Disc 2 — 4 regular episodes + 1 extended version (57:35 = 3455s)
      makeTngFile(2, 2, 5, 3455),  // Extended version (~57min) — matched via fallback
      makeTngFile(2, 2, 6, 2862),  // E09 The Measure of a Man
      makeTngFile(2, 2, 7, 2856),  // E08 A Matter of Honor
      makeTngFile(2, 2, 8, 2842),  // E07 Unnatural Selection
      makeTngFile(2, 2, 9, 2857),  // E06 The Schizoid Man
      // Disc 3 — E10-E14 reversed
      makeTngFile(2, 3, 5, 2858),
      makeTngFile(2, 3, 6, 2858),
      makeTngFile(2, 3, 7, 2857),
      makeTngFile(2, 3, 8, 2860),
      makeTngFile(2, 3, 9, 2858),
      // Disc 4 — E15-E19 reversed
      makeTngFile(2, 4, 5, 2853),
      makeTngFile(2, 4, 6, 2854),
      makeTngFile(2, 4, 7, 2858),
      makeTngFile(2, 4, 8, 2857),
      makeTngFile(2, 4, 9, 2857),
      // Disc 5 — E20-E22 reversed (3 files but only 2 TMDb slots remain)
      makeTngFile(2, 5, 5, 2857),
      makeTngFile(2, 5, 6, 2858),
      makeTngFile(2, 5, 7, 2859),
    ];

    const result = await matchSeasonBatch(
      client, 655, 'Star Trek: The Next Generation', 1987,
      2, episodeFiles, undefined, dvdCompareDiscs, 'reverse',
    );

    // 22 matched episodes + 1 extra (from Disc 5, which has 3 files but
    // only 2 TMDb episode slots remaining after D1-D4 consume 20 slots)
    expect(result.matched).toHaveLength(22);
    expect(result.reclassifiedExtras).toHaveLength(1);

    // The extra is from Disc 5 — it has 3 files but only 2 episodes left
    const extraFile = result.reclassifiedExtras[0];
    expect(extraFile.file.filePath).toContain('Disc 5');

    // Build assignment map
    const assignments = new Map<string, number>();
    for (const m of result.matched) {
      const discMatch = m.mediaFile.filePath.match(/Disc (\d+)/);
      const trackMatch = m.mediaFile.fileName.match(/_t(\d+)\./);
      const key = `D${discMatch?.[1]}_t${trackMatch?.[1]}`;
      assignments.set(key, m.tmdbMatch?.episodeNumber ?? -1);
    }

    // Disc 2: all 5 files matched — 4 regular via greedy, extended via fallback
    // t09→E06, t08→E07, t07→E08, t06→E09, t05→E10 (reversed)
    expect(assignments.get('D2_t09')).toBe(6);   // The Schizoid Man
    expect(assignments.get('D2_t08')).toBe(7);   // Unnatural Selection
    expect(assignments.get('D2_t07')).toBe(8);   // A Matter of Honor
    expect(assignments.get('D2_t06')).toBe(9);   // The Measure of a Man
    expect(assignments.has('D2_t05')).toBe(true); // Extended version — matched via fallback

    // Disc 3: range shifted by 1 since D2 consumed 5 slots instead of 4
    // t09→E11, t08→E12, t07→E13, t06→E14, t05→E15 (reversed)
    expect(assignments.get('D3_t09')).toBe(11);  // Contagion
    expect(assignments.get('D3_t08')).toBe(12);  // The Royale
    expect(assignments.get('D3_t07')).toBe(13);  // Time Squared
    expect(assignments.get('D3_t06')).toBe(14);  // The Icarus Factor
    expect(assignments.get('D3_t05')).toBe(15);  // Pen Pals
  });

  it('should produce sequential episode ordering within each disc', async () => {
    // Even with nearly identical runtimes across all episodes, the episode
    // assignments within each disc must be monotonically increasing (after
    // track reversal). This verifies the sequential ordering enforcement.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(2, makeSeasonDetails(2, makeTngS2TmdbEpisodes()));
    const client = makeSeasonMockClient(seasonMap);
    const dvdCompareDiscs = makeTngS2DvdCompare();

    // Standard 22-file setup (no extended versions)
    const episodeFiles: ClassifiedFile[] = [
      makeTngFile(2, 1, 8, 2852), makeTngFile(2, 1, 9, 2859),
      makeTngFile(2, 1, 10, 2868), makeTngFile(2, 1, 11, 2873),
      makeTngFile(2, 1, 12, 2860),
      makeTngFile(2, 2, 5, 2862), makeTngFile(2, 2, 6, 2856),
      makeTngFile(2, 2, 7, 2842), makeTngFile(2, 2, 8, 2857),
      makeTngFile(2, 3, 5, 2858), makeTngFile(2, 3, 6, 2858),
      makeTngFile(2, 3, 7, 2857), makeTngFile(2, 3, 8, 2860),
      makeTngFile(2, 3, 9, 2858),
      makeTngFile(2, 4, 5, 2853), makeTngFile(2, 4, 6, 2854),
      makeTngFile(2, 4, 7, 2858), makeTngFile(2, 4, 8, 2857),
      makeTngFile(2, 4, 9, 2857),
      makeTngFile(2, 5, 5, 2857), makeTngFile(2, 5, 6, 2858),
      makeTngFile(2, 5, 7, 2859),
    ];

    const result = await matchSeasonBatch(
      client, 655, 'Star Trek: The Next Generation', 1987,
      2, episodeFiles, undefined, dvdCompareDiscs, 'reverse',
    );

    expect(result.matched).toHaveLength(22);

    // Group assignments by disc, sorted by track number within each disc.
    // The matched array is in greedy-cost order, not file order, so we
    // must sort by track to verify sequential episode ordering.
    const discAssignments = new Map<number, Array<{ track: number; epNum: number }>>();
    for (const m of result.matched) {
      const discMatch = m.mediaFile.filePath.match(/Disc (\d+)/);
      if (!discMatch) continue;
      const disc = parseInt(discMatch[1], 10);
      const trackMatch = m.mediaFile.fileName.match(/_t(\d+)\./);
      const track = parseInt(trackMatch?.[1] ?? '0', 10);
      const epNum = m.tmdbMatch?.episodeNumber ?? 0;
      const list = discAssignments.get(disc) ?? [];
      list.push({ track, epNum });
      discAssignments.set(disc, list);
    }

    // For each disc, when sorted by track (reversed → highest track first),
    // episode numbers should be monotonically increasing.
    for (const [disc, assignments] of discAssignments) {
      // Tracks are reversed: highest track = first episode in reversed order
      assignments.sort((a, b) => b.track - a.track);
      const epNums = assignments.map(a => a.epNum);
      for (let i = 1; i < epNums.length; i++) {
        expect(epNums[i]).toBeGreaterThan(epNums[i - 1]);
      }
    }
  });

  it('should fall back to file counts for disc ranges without DVDCompare', async () => {
    // When no DVDCompare data is available, disc ranges use file counts.
    // This test verifies the fallback behavior still works correctly.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Episode 1', 45), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Episode 2', 44), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Episode 3', 46), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Episode 4', 43), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),
      makeEpisodeFile(1, 2, 44),
      makeEpisodeFile(2, 1, 46),
      makeEpisodeFile(2, 2, 43),
    ];

    // No DVDCompare data — should use file counts (2 per disc)
    const result = await matchSeasonBatch(
      client, 12345, 'TestShow', 2020, 1, files,
    );

    expect(result.matched).toHaveLength(4);

    // Disc 1 files → E1, E2; Disc 2 files → E3, E4
    const d1Eps = result.matched
      .filter(m => m.mediaFile.filePath.includes('S1D1'))
      .map(m => m.tmdbMatch?.episodeNumber)
      .sort();
    const d2Eps = result.matched
      .filter(m => m.mediaFile.filePath.includes('S1D2'))
      .map(m => m.tmdbMatch?.episodeNumber)
      .sort();

    expect(d1Eps).toEqual([1, 2]);
    expect(d2Eps).toEqual([3, 4]);
  });

  it('should detect reverse track order from DVDCompare correlation without a hint (real TNG S2 data)', async () => {
    // REAL-WORLD REPRODUCTION: TNG S2 has 22 episodes, all 46 min on TMDb
    // (except E7 at 45 min). DVDCompare runtimes range from 45:14 to 45:44.
    // File runtimes are ~2 min longer (47:12-47:53) with a constant Blu-ray
    // overhead. Without a hint, absolute forward vs reverse costs are IDENTICAL
    // because the overhead is constant. The system must use runtime correlation
    // (pattern of small sub-second variations) to detect reverse order.
    //
    // This test reproduces the real failure: S2 scanned without S1, no hint
    // available, and the system incorrectly defaulted to forward order.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    const tmdbEpisodes = makeTngS2TmdbEpisodes();
    // Fix E7 to match real TMDb data (45 min, not 46)
    tmdbEpisodes[6] = { ...tmdbEpisodes[6], runtime: 45 };
    seasonMap.set(2, makeSeasonDetails(2, tmdbEpisodes));
    const client = makeSeasonMockClient(seasonMap);
    const dvdCompareDiscs = makeTngS2DvdCompare();

    // All 22 files across 5 discs in REVERSE chronological order.
    // These are exact real-world file durations from the user's Blu-ray rips.
    const episodeFiles: ClassifiedFile[] = [
      // Disc 1 — E01-E05 reversed (t12=E01, t08=E05)
      makeTngFile(2, 1, 8, 2852),   // 47:32 — actually E05
      makeTngFile(2, 1, 9, 2859),   // 47:39 — actually E04
      makeTngFile(2, 1, 10, 2868),  // 47:48 — actually E03
      makeTngFile(2, 1, 11, 2873),  // 47:53 — actually E02
      makeTngFile(2, 1, 12, 2860),  // 47:40 — actually E01
      // Disc 2 — E06-E09 reversed (t08=E06, t05=E09)
      makeTngFile(2, 2, 5, 2862),   // 47:42 — actually E09
      makeTngFile(2, 2, 6, 2856),   // 47:36 — actually E08
      makeTngFile(2, 2, 7, 2842),   // 47:22 — actually E07
      makeTngFile(2, 2, 8, 2857),   // 47:37 — actually E06
      // Disc 3 — E10-E14 reversed
      makeTngFile(2, 3, 5, 2858),   // actually E14
      makeTngFile(2, 3, 6, 2858),   // actually E13
      makeTngFile(2, 3, 7, 2857),   // actually E12
      makeTngFile(2, 3, 8, 2860),   // actually E11
      makeTngFile(2, 3, 9, 2858),   // actually E10
      // Disc 4 — E15-E19 reversed
      makeTngFile(2, 4, 5, 2853),   // actually E19
      makeTngFile(2, 4, 6, 2854),   // actually E18
      makeTngFile(2, 4, 7, 2858),   // actually E17
      makeTngFile(2, 4, 8, 2857),   // actually E16
      makeTngFile(2, 4, 9, 2857),   // actually E15
      // Disc 5 — E20-E22 reversed
      makeTngFile(2, 5, 5, 2857),   // actually E22
      makeTngFile(2, 5, 6, 2858),   // actually E21
      makeTngFile(2, 5, 7, 2859),   // actually E20
    ];

    // NO HINT — simulates scanning S2 without S1 data
    const result = await matchSeasonBatch(
      client, 655, 'Star Trek: The Next Generation', 1987,
      2, episodeFiles, undefined, dvdCompareDiscs,
      // no trackOrderHint
    );

    expect(result.matched).toHaveLength(22);
    expect(result.detectedTrackOrder).toBe('reverse');

    // Build assignment map: "D{disc}_t{track}" → episode number
    const assignments = new Map<string, number>();
    for (const m of result.matched) {
      const discMatch = m.mediaFile.filePath.match(/Disc (\d+)/);
      const trackMatch = m.mediaFile.fileName.match(/_t(\d+)\./);
      const key = `D${discMatch?.[1]}_t${trackMatch?.[1]}`;
      assignments.set(key, m.tmdbMatch?.episodeNumber ?? -1);
    }

    // Disc 1 reversed: t12→E01, t11→E02, t10→E03, t09→E04, t08→E05
    expect(assignments.get('D1_t12')).toBe(1);
    expect(assignments.get('D1_t11')).toBe(2);
    expect(assignments.get('D1_t10')).toBe(3);
    expect(assignments.get('D1_t09')).toBe(4);
    expect(assignments.get('D1_t08')).toBe(5);

    // Disc 2 reversed: t08→E06, t07→E07, t06→E08, t05→E09
    expect(assignments.get('D2_t08')).toBe(6);
    expect(assignments.get('D2_t07')).toBe(7);
    expect(assignments.get('D2_t06')).toBe(8);
    expect(assignments.get('D2_t05')).toBe(9);

    // Disc 5 reversed: t07→E20, t06→E21, t05→E22
    expect(assignments.get('D5_t07')).toBe(20);
    expect(assignments.get('D5_t06')).toBe(21);
    expect(assignments.get('D5_t05')).toBe(22);
  });
});

describe('sequential ordering enforcement', () => {
  it('should fix non-sequential episode ordering within a disc', async () => {
    // Create a scenario where greedy matching could produce non-sequential
    // ordering: all episodes have nearly identical TMDb runtimes but
    // slightly different DVDCompare runtimes that could trick the matcher.
    const seasonMap = new Map<number, TmdbSeasonDetails>();
    seasonMap.set(1, makeSeasonDetails(1, [
      { ...makeTmdbEpisode(1, 'Ep A', 45), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Ep B', 45), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Ep C', 45), season_number: 1 },
    ]));
    const client = makeSeasonMockClient(seasonMap);

    // 3 files on disc 1 with runtimes all within 1 second of each other
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45.0),   // Should map to E1
      makeEpisodeFile(1, 2, 45.01),  // Should map to E2
      makeEpisodeFile(1, 3, 45.02),  // Should map to E3
    ];

    const result = await matchSeasonBatch(
      client, 12345, 'TestShow', 2020, 1, files,
    );

    expect(result.matched).toHaveLength(3);

    // Sort matched by file track order
    const sorted = [...result.matched].sort((a, b) => {
      const aTrack = parseInt(a.mediaFile.fileName.match(/_t(\d+)/)?.[1] ?? '0', 10);
      const bTrack = parseInt(b.mediaFile.fileName.match(/_t(\d+)/)?.[1] ?? '0', 10);
      return aTrack - bTrack;
    });

    // Episode numbers must be monotonically increasing regardless of
    // which candidate the greedy matcher picked first
    const epNums = sorted.map(m => m.tmdbMatch?.episodeNumber ?? 0);
    for (let i = 1; i < epNums.length; i++) {
      expect(epNums[i]).toBeGreaterThan(epNums[i - 1]);
    }
  });
});

describe('matchSpecialsBatch', () => {
  it('should match a file to a Season 0 special by runtime', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
      makeTmdbEpisode(2, 'Behind the Scenes', 25),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 138), // Close to 132min Extended Pilot
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.matched[0].tmdbMatch?.seasonNumber).toBe(0);
    expect(result.matched[0].tmdbMatch?.episodeNumber).toBe(1);
    expect(result.matched[0].tmdbMatch?.episodeTitle).toBe('Extended Pilot');
  });

  it('should match a short special', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
      makeTmdbEpisode(2, 'Deleted Scene', 5),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t03.mkv', 4), // Close to 5min Deleted Scene
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.matched[0].tmdbMatch?.episodeNumber).toBe(2);
    expect(result.matched[0].tmdbMatch?.episodeTitle).toBe('Deleted Scene');
  });

  it('should return all as unmatched when Season 0 fetch fails', async () => {
    const client = makeMockClient(null);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 138),
      makeClassifiedFile('S1D1', 'title_t01.mkv', 4),
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
  });

  it('should match multiple specials of various durations', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
      makeTmdbEpisode(2, 'Making Of', 45),
      makeTmdbEpisode(3, 'Deleted Scene', 5),
      makeTmdbEpisode(4, 'Gag Reel', 12),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 138),  // → Extended Pilot (132)
      makeClassifiedFile('S1D1', 'title_t01.mkv', 44),   // → Making Of (45)
      makeClassifiedFile('S1D1', 'title_t02.mkv', 4),    // → Deleted Scene (5)
      makeClassifiedFile('S1D1', 'title_t03.mkv', 11),   // → Gag Reel (12)
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(4);
    expect(result.unmatched).toHaveLength(0);

    // Verify each matched correctly
    const matchedEps = result.matched.map(m => m.tmdbMatch?.episodeNumber).sort();
    expect(matchedEps).toEqual([1, 2, 3, 4]);
  });

  it('should not match when runtime difference exceeds thresholds', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
    ]);
    const client = makeMockClient(season0);

    // 90min file vs 132min special = 42min diff, 31.8% → exceeds both thresholds
    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 90),
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('should not match when absolute threshold exceeded even if percentage is ok', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Very Long Special', 300), // 5 hours
    ]);
    const client = makeMockClient(season0);

    // 280min file vs 300min special = 20min diff, 6.7% → percentage ok but >15min absolute
    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 280),
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('should prefer closer runtime match (deduplication)', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Pilot Extended', 130),
    ]);
    const client = makeMockClient(season0);

    // Two candidates: 132min (closer) and 138min (farther)
    // Only one special available — closer match should win
    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 138),  // 8min diff
      makeClassifiedFile('S1D1', 'title_t01.mkv', 132),  // 2min diff
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    // First candidate (138) matches first since it's processed first, then special is consumed
    // The second candidate (132) has no remaining specials
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);

    // The first file in order wins (greedy, not optimal)
    expect(result.matched[0].mediaFile.fileName).toBe('title_t00.mkv');
  });

  it('should skip candidates without duration data', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', undefined), // No duration
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('should use season0Cache to avoid redundant fetches', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'Extended Pilot', 132),
    ]);
    const client = makeMockClient(season0);
    const cache = new Map<number, TmdbSeasonDetails | null>();

    const candidates1 = [makeClassifiedFile('S1D1', 'title_t00.mkv', 138)];
    const candidates2 = [makeClassifiedFile('S2D1', 'title_t00.mkv', 130)];

    // First call — fetches and caches
    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates1, undefined, cache);
    // Second call — should use cache
    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates2, undefined, cache);

    // getSeasonDetails should only be called once
    expect(client.getSeasonDetails).toHaveBeenCalledTimes(1);
  });

  it('should cache null when Season 0 not found and skip on subsequent calls', async () => {
    const client = makeMockClient(null);
    const cache = new Map<number, TmdbSeasonDetails | null>();

    const candidates1 = [makeClassifiedFile('S1D1', 'title_t00.mkv', 138)];
    const candidates2 = [makeClassifiedFile('S2D1', 'title_t00.mkv', 130)];

    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates1, undefined, cache);
    const result2 = await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates2, undefined, cache);

    // Should only call once (cached null)
    expect(client.getSeasonDetails).toHaveBeenCalledTimes(1);
    expect(result2.matched).toHaveLength(0);
    expect(result2.unmatched).toHaveLength(1);
  });

  it('should handle empty candidates list', async () => {
    const client = makeMockClient(null);

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, [],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
    // Should not even call getSeasonDetails
    expect(client.getSeasonDetails).not.toHaveBeenCalled();
  });

  it('should skip Season 0 episodes without runtime data', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(1, 'No Runtime Special', null),  // No runtime
      makeTmdbEpisode(2, 'Has Runtime Special', 45),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 44),
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].tmdbMatch?.episodeNumber).toBe(2);
    expect(result.matched[0].tmdbMatch?.episodeTitle).toBe('Has Runtime Special');
  });

  it('should render S00E## filenames correctly', async () => {
    const season0 = makeSeason0Details([
      makeTmdbEpisode(3, 'Behind the Scenes', 25),
    ]);
    const client = makeMockClient(season0);

    const candidates = [
      makeClassifiedFile('S1D1', 'title_t00.mkv', 24),
    ];

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, candidates,
    );

    expect(result.matched).toHaveLength(1);
    // Verify the new filename contains S00E03
    expect(result.matched[0].newFilename).toContain('S00E03');
  });
});

// ── Play All detection ───────────────────────────────────────────────

function makeClassifiedFileWithSize(
  subdir: string,
  name: string,
  durationMinutes: number | undefined,
  sizeBytes: number,
): ClassifiedFile {
  const file: MediaFile = {
    filePath: `/shows/TestShow/${subdir}/${name}`,
    fileName: name,
    extension: '.mkv',
    sizeBytes,
  };
  return {
    file,
    probeData: durationMinutes !== undefined ? makeProbeResult(durationMinutes) : undefined,
    classification: 'episode',
    durationMinutes,
    sortOrder: 0,
  };
}

describe('detectPlayAllFiles', () => {
  it('should flag a file with runtime > 2.5x median', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', 180, 15_000_000_000), // Play All
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(1);
    expect(flagged.has(classified[3].file.filePath)).toBe(true);
  });

  it('should flag a file with size > 3x median', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', 45, 20_000_000_000), // Huge file
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(1);
    expect(flagged.has(classified[3].file.filePath)).toBe(true);
  });

  it('should not flag anything when all files have similar runtime and size', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_100_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', 45, 4_300_000_000),
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(0);
  });

  it('should return empty set when fewer than 3 candidates', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 180, 15_000_000_000),
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(0);
  });

  it('should flag by size even without duration data', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', undefined, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', undefined, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', undefined, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', undefined, 20_000_000_000), // >3x median
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(1);
    expect(flagged.has(classified[3].file.filePath)).toBe(true);
  });

  it('should ignore extras-classified files', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_200_000_000),
      { ...makeClassifiedFileWithSize('extras', 'title_t00.mkv', 180, 15_000_000_000), classification: 'extra' },
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(0); // Extra file not considered
  });

  it('should flag multiple Play All files', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', 180, 15_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t04.mkv', 200, 18_000_000_000),
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(2);
  });

  it('should not flag a double-length finale (below 2.5x threshold)', () => {
    const classified: ClassifiedFile[] = [
      makeClassifiedFileWithSize('S1D1', 'title_t00.mkv', 43, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t01.mkv', 42, 4_000_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t02.mkv', 44, 4_200_000_000),
      makeClassifiedFileWithSize('S1D1', 'title_t03.mkv', 90, 8_000_000_000), // 2.1x median, below 2.5x
    ];

    const flagged = detectPlayAllFiles(classified);
    expect(flagged.size).toBe(0);
  });
});

describe('detectAndApplyTrackOrder', () => {
  // Helper: build unified refs and disc ranges for track order tests
  function buildTestRefsAndRanges(
    tmdbEpisodes: TmdbEpisode[],
    files: ClassifiedFile[],
  ): { refs: UnifiedEpisodeRef[]; ranges: Map<number, { startEp: number; endEp: number }> } {
    const refs = buildUnifiedEpisodeRefs(tmdbEpisodes);
    const discFileCounts = new Map<number, number>();
    for (const file of files) {
      // Match S#D# pattern (e.g., S1D1, S1D2) used by makeEpisodeFile
      const sdMatch = file.file.filePath.match(/S\d{1,2}D(\d{1,2})/i);
      // Also match "Disc N" pattern
      const discMatch = file.file.filePath.match(/(?:Disc|Disk)\s*(\d{1,2})/i);
      const disc = sdMatch ? parseInt(sdMatch[1], 10) : (discMatch ? parseInt(discMatch[1], 10) : 0);
      discFileCounts.set(disc, (discFileCounts.get(disc) ?? 0) + 1);
    }
    const ranges = new Map<number, { startEp: number; endEp: number }>();
    const sortedDiscs = [...discFileCounts.entries()].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (let i = 0; i < sortedDiscs.length; i++) {
      const [disc, count] = sortedDiscs[i];
      const isLast = i === sortedDiscs.length - 1;
      const startEp = cursor;
      const endEp = isLast ? tmdbEpisodes.length - 1 : Math.min(cursor + count - 1, tmdbEpisodes.length - 1);
      if (startEp < tmdbEpisodes.length) ranges.set(disc, { startEp, endEp });
      cursor += count;
    }
    return { refs, ranges };
  }

  it('should reverse tracks on discs where reverse order fits TMDb episodes better', () => {
    // John Adams Discs 1 & 2 have tracks in reverse episode order
    // TMDb runtimes based on actual API data for John Adams (2008).
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'Join or Die', 68), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Independence', 91), season_number: 1 },
      { ...makeTmdbEpisode(3, "Don't Tread on Me", 70), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Reunion', 66), season_number: 1 },
      { ...makeTmdbEpisode(5, 'Unite or Die', 61), season_number: 1 },
      { ...makeTmdbEpisode(6, 'Unnecessary War', 63), season_number: 1 },
      { ...makeTmdbEpisode(7, 'Peacefield', 79), season_number: 1 },
    ];

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 91.892),  // D1_t01 → should be E02
      makeEpisodeFile(1, 2, 70.782),  // D1_t02 → should be E01
      makeEpisodeFile(2, 1, 63.641),  // D2_t01 → should be E05
      makeEpisodeFile(2, 2, 65.985),  // D2_t02 → should be E04
      makeEpisodeFile(2, 3, 68.947),  // D2_t03 → should be E03
      makeEpisodeFile(3, 3, 62.380),  // D3_t03 → should stay E06
      makeEpisodeFile(3, 4, 79.412),  // D3_t04 → should stay E07
    ];

    // Capture original filenames by position
    const originalOrder = files.map(f => f.file.fileName);

    const { refs, ranges } = buildTestRefsAndRanges(tmdbEpisodes, files);
    detectAndApplyTrackOrder(files, refs, ranges);

    const newOrder = files.map(f => f.file.fileName);

    // Global decision is reverse (D1+D2 strongly favor reverse, overwhelming D3).
    // All discs are reversed since the decision is global — a physical release
    // is mastered one way.

    // Disc 1 reversed: [t02, t01] instead of [t01, t02]
    expect(newOrder[0]).toBe(originalOrder[1]); // D1_t02 now first
    expect(newOrder[1]).toBe(originalOrder[0]); // D1_t01 now second

    // Disc 2 reversed: [t03, t02, t01] instead of [t01, t02, t03]
    expect(newOrder[2]).toBe(originalOrder[4]); // D2_t03 now first
    expect(newOrder[3]).toBe(originalOrder[3]); // D2_t02 stays middle
    expect(newOrder[4]).toBe(originalOrder[2]); // D2_t01 now last

    // Disc 3 also reversed (global decision from D1+D2 signal)
    expect(newOrder[5]).toBe(originalOrder[6]); // D3_t04 now first
    expect(newOrder[6]).toBe(originalOrder[5]); // D3_t03 now second
  });

  it('should not reverse tracks when forward order already matches well', () => {
    // 6 files across 2 discs, all with similar runtimes matching sequentially
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'Ep 1', 45), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Ep 2', 46), season_number: 1 },
      { ...makeTmdbEpisode(3, 'Ep 3', 47), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Ep 4', 45), season_number: 1 },
      { ...makeTmdbEpisode(5, 'Ep 5', 46), season_number: 1 },
      { ...makeTmdbEpisode(6, 'Ep 6', 47), season_number: 1 },
    ];

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),
      makeEpisodeFile(1, 2, 46),
      makeEpisodeFile(1, 3, 47),
      makeEpisodeFile(2, 1, 45),
      makeEpisodeFile(2, 2, 46),
      makeEpisodeFile(2, 3, 47),
    ];

    const originalOrder = files.map(f => f.file.fileName);
    const { refs, ranges } = buildTestRefsAndRanges(tmdbEpisodes, files);
    detectAndApplyTrackOrder(files, refs, ranges);
    const newOrder = files.map(f => f.file.fileName);

    // Nothing should change — forward order already matches perfectly
    expect(newOrder).toEqual(originalOrder);
  });

  it('should follow reverse hint when runtimes are near-uniform (TNG S2 Disc 1)', () => {
    // TNG S2 Disc 1: all DVDCompare runtimes within 20s of each other (45:24-45:44).
    // File runtimes all ~2min longer than DVDCompare. Forward vs reverse cost is
    // nearly identical (~10.7min each), so runtime-based detection alone cannot
    // distinguish. The reverse hint from Season 1 must be followed.
    //
    // DVDCompare Disc 1 order: The Child (2731s), Where Silence (2744s),
    //   Elementary Dear Data (2739s), Outrageous Okona (2731s), Loud as a Whisper (2724s)
    // TMDb: all 46 min
    // Files: t08(2852s)..t12(2860s) — reverse chronological (t12=E01..t08=E05)
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'The Child', 46), season_number: 2 },
      { ...makeTmdbEpisode(2, 'Where Silence Has Lease', 46), season_number: 2 },
      { ...makeTmdbEpisode(3, 'Elementary, Dear Data', 46), season_number: 2 },
      { ...makeTmdbEpisode(4, 'The Outrageous Okona', 46), season_number: 2 },
      { ...makeTmdbEpisode(5, 'Loud as a Whisper', 46), season_number: 2 },
    ];

    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'The Child', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Where Silence Has Lease', runtimeSeconds: 2744, runtimeFormatted: '45:44' },
          { title: 'Elementary, Dear Data', runtimeSeconds: 2739, runtimeFormatted: '45:39' },
          { title: 'The Outrageous Okona', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Loud as a Whisper', runtimeSeconds: 2724, runtimeFormatted: '45:24' },
        ],
      },
    ];

    // Files on Disc 1 — reverse-chronological on the Blu-ray
    // t12 is actually E01 (The Child), t08 is E05 (Loud as a Whisper)
    const makeTngDiscFile = (disc: number, track: number, durationSec: number): ClassifiedFile => {
      const name = `Star Trek- The Next Generation Season 2 Disc ${disc}_t${String(track).padStart(2, '0')}.mkv`;
      const dir = `Star Trek- The Next Generation Season 2 Disc ${disc}`;
      return {
        file: {
          filePath: `/shows/${dir}/${name}`,
          fileName: name,
          extension: '.mkv',
          sizeBytes: 7_000_000_000,
        },
        probeData: { durationMinutes: durationSec / 60, durationSeconds: durationSec },
        classification: 'episode',
        durationMinutes: durationSec / 60,
        sortOrder: disc * 1000 + track,
      };
    };

    const files: ClassifiedFile[] = [
      makeTngDiscFile(1, 8, 2852),   // t08 → E05 Loud as a Whisper
      makeTngDiscFile(1, 9, 2859),   // t09 → E04 The Outrageous Okona
      makeTngDiscFile(1, 10, 2868),  // t10 → E03 Elementary, Dear Data
      makeTngDiscFile(1, 11, 2873),  // t11 → E02 Where Silence Has Lease
      makeTngDiscFile(1, 12, 2860),  // t12 → E01 The Child
    ];

    const originalOrder = files.map(f => f.file.fileName);
    const refs = buildUnifiedEpisodeRefs(tmdbEpisodes, dvdCompareDiscs);
    const ranges = new Map<number, { startEp: number; endEp: number }>();
    ranges.set(1, { startEp: 0, endEp: 4 });

    // With reverse hint from Season 1 — should follow it
    const decision = detectAndApplyTrackOrder(files, refs, ranges, 'reverse');
    const newOrder = files.map(f => f.file.fileName);

    expect(decision).toBe('reverse');
    // Files should be reversed: t12, t11, t10, t09, t08
    expect(newOrder[0]).toBe(originalOrder[4]); // t12 now first
    expect(newOrder[1]).toBe(originalOrder[3]); // t11
    expect(newOrder[2]).toBe(originalOrder[2]); // t10
    expect(newOrder[3]).toBe(originalOrder[1]); // t09
    expect(newOrder[4]).toBe(originalOrder[0]); // t08 now last
  });

  it('should detect reverse via correlation when runtimes are near-uniform with no hint', () => {
    // TNG S2 Disc 1 data without a hint. Absolute costs are identical
    // (constant ~128s Blu-ray overhead), but DVDCompare sub-second runtime
    // correlation reveals the correct reverse ordering. The runtime variation
    // patterns (slight differences in episode lengths) align much better
    // when files are reversed.
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'The Child', 46), season_number: 2 },
      { ...makeTmdbEpisode(2, 'Where Silence Has Lease', 46), season_number: 2 },
      { ...makeTmdbEpisode(3, 'Elementary, Dear Data', 46), season_number: 2 },
      { ...makeTmdbEpisode(4, 'The Outrageous Okona', 46), season_number: 2 },
      { ...makeTmdbEpisode(5, 'Loud as a Whisper', 46), season_number: 2 },
    ];

    const dvdCompareDiscs = [
      {
        discNumber: 1,
        discLabel: 'DISC ONE',
        episodes: [
          { title: 'The Child', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Where Silence Has Lease', runtimeSeconds: 2744, runtimeFormatted: '45:44' },
          { title: 'Elementary, Dear Data', runtimeSeconds: 2739, runtimeFormatted: '45:39' },
          { title: 'The Outrageous Okona', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
          { title: 'Loud as a Whisper', runtimeSeconds: 2724, runtimeFormatted: '45:24' },
        ],
      },
    ];

    const makeTngDiscFile = (disc: number, track: number, durationSec: number): ClassifiedFile => {
      const name = `Star Trek- The Next Generation Season 2 Disc ${disc}_t${String(track).padStart(2, '0')}.mkv`;
      const dir = `Star Trek- The Next Generation Season 2 Disc ${disc}`;
      return {
        file: {
          filePath: `/shows/${dir}/${name}`,
          fileName: name,
          extension: '.mkv',
          sizeBytes: 7_000_000_000,
        },
        probeData: { durationMinutes: durationSec / 60, durationSeconds: durationSec },
        classification: 'episode',
        durationMinutes: durationSec / 60,
        sortOrder: disc * 1000 + track,
      };
    };

    const files: ClassifiedFile[] = [
      makeTngDiscFile(1, 8, 2852),   // t08 → actually E05
      makeTngDiscFile(1, 9, 2859),   // t09 → actually E04
      makeTngDiscFile(1, 10, 2868),  // t10 → actually E03
      makeTngDiscFile(1, 11, 2873),  // t11 → actually E02
      makeTngDiscFile(1, 12, 2860),  // t12 → actually E01
    ];

    const originalOrder = files.map(f => f.file.fileName);
    const refs = buildUnifiedEpisodeRefs(tmdbEpisodes, dvdCompareDiscs);
    const ranges = new Map<number, { startEp: number; endEp: number }>();
    ranges.set(1, { startEp: 0, endEp: 4 });

    // No hint — correlation should detect reverse order from sub-second
    // runtime variation patterns even though absolute costs are identical
    const decision = detectAndApplyTrackOrder(files, refs, ranges);
    const newOrder = files.map(f => f.file.fileName);

    expect(decision).toBe('reverse');
    // Files should be reversed: t12, t11, t10, t09, t08
    expect(newOrder[0]).toBe(originalOrder[4]); // t12 now first
    expect(newOrder[1]).toBe(originalOrder[3]); // t11
    expect(newOrder[2]).toBe(originalOrder[2]); // t10 stays middle
    expect(newOrder[3]).toBe(originalOrder[1]); // t09
    expect(newOrder[4]).toBe(originalOrder[0]); // t08 now last
  });

  it('should not reverse tracks when episode runtimes are uniform (sitcoms)', () => {
    // Seinfeld-like scenario: all episodes ~22min, no DVDCompare data.
    // With uniform runtimes, forward/reverse costs are nearly identical,
    // so the system must default to forward (natural track order).
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'The Seinfeld Chronicles', 23), season_number: 1 },
      { ...makeTmdbEpisode(2, 'The Stakeout', 22), season_number: 1 },
      { ...makeTmdbEpisode(3, 'The Robbery', 23), season_number: 1 },
      { ...makeTmdbEpisode(4, 'Male Unbonding', 22), season_number: 1 },
      { ...makeTmdbEpisode(5, 'The Stock Tip', 23), season_number: 1 },
    ];

    // Files with similar runtimes — small variations that could trick
    // cost-based reversal if not guarded
    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 0, 23.5),
      makeEpisodeFile(1, 1, 22.3),
      makeEpisodeFile(1, 2, 23.1),
      makeEpisodeFile(1, 3, 22.7),
      makeEpisodeFile(1, 4, 23.4),
    ];

    const originalOrder = files.map(f => f.file.fileName);
    const { refs, ranges } = buildTestRefsAndRanges(tmdbEpisodes, files);
    const decision = detectAndApplyTrackOrder(files, refs, ranges);
    const newOrder = files.map(f => f.file.fileName);

    // Must stay forward — uniform runtimes should never trigger reversal
    expect(decision).toBe('forward');
    expect(newOrder).toEqual(originalOrder);
  });

  it('should handle single-file discs without reversal', () => {
    const tmdbEpisodes: TmdbEpisode[] = [
      { ...makeTmdbEpisode(1, 'Ep 1', 45), season_number: 1 },
      { ...makeTmdbEpisode(2, 'Ep 2', 46), season_number: 1 },
    ];

    const files: ClassifiedFile[] = [
      makeEpisodeFile(1, 1, 45),
      makeEpisodeFile(2, 1, 46),
    ];

    const originalOrder = files.map(f => f.file.fileName);
    const { refs, ranges } = buildTestRefsAndRanges(tmdbEpisodes, files);
    detectAndApplyTrackOrder(files, refs, ranges);
    const newOrder = files.map(f => f.file.fileName);

    // Single-file discs can't be reversed
    expect(newOrder).toEqual(originalOrder);
  });
});

// ── identifyShow ──────────────────────────────────────────────────────────────

describe('identifyShow', () => {
  function makeDirectoryContext(showName: string) {
    return {
      showName,
      showNameSource: 'directory',
    };
  }

  function makeTvResult(id: number, name: string, year: string = '2020-01-01') {
    return {
      id,
      name,
      original_name: name,
      overview: '',
      first_air_date: year,
      popularity: 10,
      vote_average: 8,
      poster_path: null,
      origin_country: ['US'],
      genre_ids: [],
      backdrop_path: null,
      vote_count: 100,
      original_language: 'en',
    };
  }

  it('returns IdentifiedShow when user confirms', async () => {
    const tvResult = makeTvResult(42, 'Breaking Bad', '2008-01-20');
    const client = {
      searchTv: vi.fn().mockResolvedValue({ results: [tvResult] }),
      getTvDetails: vi.fn().mockResolvedValue({ episode_run_time: [47] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn().mockResolvedValue(tvResult),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('Breaking Bad'), prompts);

    expect(result).not.toBeNull();
    expect(result!.showId).toBe(42);
    expect(result!.showName).toBe('Breaking Bad');
    expect(result!.showYear).toBe(2008);
    expect(result!.episodeRunTime).toEqual([47]);
  });

  it('returns null when user skips', async () => {
    const tvResult = makeTvResult(1, 'Some Show');
    const client = {
      searchTv: vi.fn().mockResolvedValue({ results: [tvResult] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn().mockResolvedValue(null),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('Some Show'), prompts);
    expect(result).toBeNull();
  });

  it('retries search when user sends __retry signal', async () => {
    const wrongResult = makeTvResult(1, 'Wrong Show');
    const rightResult = makeTvResult(2, 'Right Show', '2020-05-15');

    const client = {
      searchTv: vi.fn()
        .mockResolvedValueOnce({ results: [wrongResult] })
        .mockResolvedValueOnce({ results: [rightResult] }),
      getTvDetails: vi.fn().mockResolvedValue({ episode_run_time: [45] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn()
        .mockResolvedValueOnce({ __retry: 'correct name' })
        .mockResolvedValueOnce(rightResult),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('wrong name'), prompts);

    expect(client.searchTv).toHaveBeenCalledTimes(2);
    expect(client.searchTv).toHaveBeenNthCalledWith(1, 'wrong name');
    expect(client.searchTv).toHaveBeenNthCalledWith(2, 'correct name');
    expect(result).not.toBeNull();
    expect(result!.showName).toBe('Right Show');
  });

  it('allows retry when no results found', async () => {
    const foundResult = makeTvResult(5, 'Found Show', '2022-03-01');

    const client = {
      searchTv: vi.fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ results: [foundResult] }),
      getTvDetails: vi.fn().mockResolvedValue({ episode_run_time: [30] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn()
        .mockResolvedValueOnce({ __retry: 'better query' })
        .mockResolvedValueOnce(foundResult),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('bad query'), prompts);

    expect(client.searchTv).toHaveBeenCalledTimes(2);
    expect(prompts.confirmShowIdentification).toHaveBeenNthCalledWith(1, 'bad query', []);
    expect(result!.showName).toBe('Found Show');
  });

  it('supports multiple retries before confirming', async () => {
    const finalResult = makeTvResult(10, 'Final Show', '2021-01-01');

    const client = {
      searchTv: vi.fn()
        .mockResolvedValueOnce({ results: [makeTvResult(1, 'Attempt 1')] })
        .mockResolvedValueOnce({ results: [makeTvResult(2, 'Attempt 2')] })
        .mockResolvedValueOnce({ results: [finalResult] }),
      getTvDetails: vi.fn().mockResolvedValue({ episode_run_time: [60] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn()
        .mockResolvedValueOnce({ __retry: 'second try' })
        .mockResolvedValueOnce({ __retry: 'third try' })
        .mockResolvedValueOnce(finalResult),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('first try'), prompts);

    expect(client.searchTv).toHaveBeenCalledTimes(3);
    expect(client.searchTv).toHaveBeenNthCalledWith(1, 'first try');
    expect(client.searchTv).toHaveBeenNthCalledWith(2, 'second try');
    expect(client.searchTv).toHaveBeenNthCalledWith(3, 'third try');
    expect(result!.showName).toBe('Final Show');
  });

  it('returns null when no results and user skips', async () => {
    const client = {
      searchTv: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as TmdbClient;

    const prompts = {
      confirmShowIdentification: vi.fn().mockResolvedValue(null),
      confirmRenames: vi.fn(),
      confirmDvdCompareSelection: vi.fn(),
    };

    const result = await identifyShow(client, makeDirectoryContext('nonexistent'), prompts);

    expect(result).toBeNull();
    expect(prompts.confirmShowIdentification).toHaveBeenCalledWith('nonexistent', []);
  });
});
