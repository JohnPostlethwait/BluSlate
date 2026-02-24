import { describe, it, expect, vi } from 'vitest';
import { classifyAndSortFiles, matchSeasonBatch, matchSpecialsBatch, detectAndApplyTrackOrder, identifyShow } from '../../packages/core/src/core/batch-matcher.js';
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

    expect(classified.filter((f) => f.classification === 'episode')).toHaveLength(2);
    expect(classified.filter((f) => f.classification === 'extra')).toHaveLength(2);
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
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
    });

    // 40 + 60 = 100
    expect(confidence).toBe(100);
  });

  it('should give 40 for position match + no runtime data', () => {
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: undefined,
    });

    // 40 + 0 = 40
    expect(confidence).toBe(40);
  });

  it('should give reduced score for large runtime diff', () => {
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 8,
    });

    // 40 + 52 (60-8) = 92
    expect(confidence).toBe(92);
  });

  it('should give 0 for runtime diff ≥60min with no position match', () => {
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 65,
    });

    // 0 + 0 (60-65 clamped to 0) = 0
    expect(confidence).toBe(0);
  });

  // Specials percentage-based scoring tests
  it('should use percentage-based scoring when isSpecialsMatch is true', () => {
    // 6min diff on 132min episode = 4.5% → ≤5% → 60 pts
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: false,
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
      sequentialPositionMatch: false,
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
      sequentialPositionMatch: false,
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
      sequentialPositionMatch: false,
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
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 22,
    });

    // 40 + 55(60-5) - 10(>15% relative) = 85
    expect(confidence).toBe(85);
  });

  it('should apply smaller penalty for 10-15% relative diff', () => {
    // 5min diff on 44min drama = 11.4% → 10-15% → -5
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 5,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 40 + 55(60-5) - 5(10-15% relative) = 90
    expect(confidence).toBe(90);
  });

  it('should not apply relative penalty for tight matches (<=10%)', () => {
    // 2min diff on 44min drama = 4.5% → ≤10% → no penalty
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 40 + 58(60-2) = 98, no relative penalty
    expect(confidence).toBe(98);
  });

  it('should stack multi-episode and relative penalties', () => {
    // Multi-ep match with 8min combined diff on 22min sitcom = 36.4%
    const confidence = computeBatchConfidence({
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: false,
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
    const params = { sequentialPositionMatch: true, runtimeDiffMinutes: 0 };
    const breakdown = computeBatchConfidenceBreakdown(params);
    expect(breakdown.total).toBe(100); // 40 + 60
    expect(breakdown.total).toBe(computeBatchConfidence(params));
  });

  it('should include sequential match item with +40 when matched', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
    });
    const seqItem = breakdown.items.find((i) => i.label.includes('Sequential'));
    expect(seqItem).toBeDefined();
    expect(seqItem!.points).toBe(40);
  });

  it('should include sequential match item with 0 when not matched', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 2,
    });
    const seqItem = breakdown.items.find((i) => i.label.includes('sequential') || i.label.includes('Sequential'));
    expect(seqItem).toBeDefined();
    expect(seqItem!.points).toBe(0);
  });

  it('should show +59 runtime for 1min diff (continuous deduction)', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 1,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(59); // 60 - 1
    expect(rtItem!.label).toContain('±1min');
  });

  it('should show +57 runtime for 3min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 3,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(57); // 60 - 3
    expect(breakdown.total).toBe(97); // 40 + 57
  });

  it('should show +56 runtime for 4min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 4,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(56); // 60 - 4
  });

  it('should show +52 runtime for 8min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 8,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(52); // 60 - 8
  });

  it('should show +0 runtime for ≥60min diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 65,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('Runtime'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(0);
  });

  it('should show "no data" when runtime is undefined', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
      runtimeDiffMinutes: undefined,
    });
    const rtItem = breakdown.items.find((i) => i.label.includes('no data'));
    expect(rtItem).toBeDefined();
    expect(rtItem!.points).toBe(0);
  });

  it('should include multi-episode penalty item', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
    });
    const multiItem = breakdown.items.find((i) => i.label.includes('Multi-episode'));
    expect(multiItem).toBeUndefined();
  });

  it('should include relative runtime penalty for >15% diff', () => {
    const breakdown = computeBatchConfidenceBreakdown({
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
      singleEpisodeRuntimeMinutes: 44, // 4.5%
    });
    const relItem = breakdown.items.find((i) => i.label.includes('% of episode'));
    expect(relItem).toBeUndefined();
    expect(breakdown.total).toBe(98); // 40 + 58 (60-2)
  });

  it('breakdown total should always match computeBatchConfidence for stacked penalties', () => {
    const params = {
      sequentialPositionMatch: true,
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
      sequentialPositionMatch: false,
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
      sequentialPositionMatch: false,
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

    detectAndApplyTrackOrder(files, tmdbEpisodes);

    const newOrder = files.map(f => f.file.fileName);

    // Disc 1 should be reversed: [t02, t01] instead of [t01, t02]
    expect(newOrder[0]).toBe(originalOrder[1]); // D1_t02 now first
    expect(newOrder[1]).toBe(originalOrder[0]); // D1_t01 now second

    // Disc 2 should be reversed: [t03, t02, t01] instead of [t01, t02, t03]
    expect(newOrder[2]).toBe(originalOrder[4]); // D2_t03 now first
    expect(newOrder[3]).toBe(originalOrder[3]); // D2_t02 stays middle
    expect(newOrder[4]).toBe(originalOrder[2]); // D2_t01 now last

    // Disc 3 should NOT be reversed (forward is already better)
    expect(newOrder[5]).toBe(originalOrder[5]); // D3_t03 stays
    expect(newOrder[6]).toBe(originalOrder[6]); // D3_t04 stays
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
    detectAndApplyTrackOrder(files, tmdbEpisodes);
    const newOrder = files.map(f => f.file.fileName);

    // Nothing should change — forward order already matches perfectly
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
    detectAndApplyTrackOrder(files, tmdbEpisodes);
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
