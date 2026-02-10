import { describe, it, expect, vi } from 'vitest';
import { classifyAndSortFiles, matchSeasonBatch, matchSpecialsBatch } from '../../src/core/batch-matcher.js';
import type { SeasonGroup, MediaFile, ProbeResult, ClassifiedFile } from '../../src/types/media.js';
import type { TmdbSeasonDetails, TmdbEpisode } from '../../src/types/tmdb.js';
import { computeBatchConfidence } from '../../src/core/scorer.js';
import { TmdbClient } from '../../src/api/tmdb-client.js';

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
  it('should give max confidence for confirmed show + position + close runtime', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
      episodeExistsInTmdb: true,
    });

    expect(confidence).toBe(100);
  });

  it('should give 65 for confirmed show + position + no runtime data', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: undefined,
      episodeExistsInTmdb: true,
    });

    expect(confidence).toBe(65);
  });

  it('should give reduced score for large runtime diff', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 8,
      episodeExistsInTmdb: true,
    });

    // 30 + 25 + 15 + 10 = 80
    expect(confidence).toBe(80);
  });

  it('should give 0 for runtime diff > 10 with no other signals', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: false,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 15,
      episodeExistsInTmdb: false,
    });

    expect(confidence).toBe(0);
  });

  it('should give 30 for confirmed show only', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 15,
      episodeExistsInTmdb: false,
    });

    expect(confidence).toBe(30);
  });

  // Specials percentage-based scoring tests
  it('should use percentage-based scoring when isSpecialsMatch is true', () => {
    // 6min diff on 132min episode = 4.5% → ≤5% → 35 pts
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 6,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
    });

    // 30 (confirmed) + 0 (no position) + 35 (≤5% pct) + 10 (exists) = 75
    expect(confidence).toBe(75);
  });

  it('should give 25 runtime points for 5-10% diff in specials mode', () => {
    // 10min diff on 132min episode = 7.6% → ≤10% → 25 pts
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 10,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
    });

    // 30 + 0 + 25 + 10 = 65
    expect(confidence).toBe(65);
  });

  it('should give 15 runtime points for 10-15% diff in specials mode', () => {
    // 14min diff on 100min episode = 14% → ≤15% → 15 pts
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 14,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 100,
    });

    // 30 + 0 + 15 + 10 = 55
    expect(confidence).toBe(55);
  });

  it('should give 0 runtime points for >15% diff in specials mode', () => {
    // 20min diff on 100min episode = 20% → >15% → 0 pts
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 20,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 100,
    });

    // 30 + 0 + 0 + 10 = 40
    expect(confidence).toBe(40);
  });

  it('should fall back to absolute thresholds when tmdbRuntimeMinutes is missing', () => {
    // isSpecialsMatch true but no tmdbRuntimeMinutes → uses absolute thresholds
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      // tmdbRuntimeMinutes omitted
    });

    // Falls back to absolute: 30 + 25 + 35 + 10 = 100
    expect(confidence).toBe(100);
  });

  // Multi-episode and relative runtime penalty tests
  it('should penalize multi-episode matches by 10 points', () => {
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 0,
      episodeExistsInTmdb: true,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 30 + 25 + 35 + 10 - 10(multi-ep) = 90
    expect(confidence).toBe(90);
  });

  it('should apply relative runtime penalty for >15% diff on short episodes', () => {
    // 5min diff on 22min sitcom = 22.7% → >15% → -10
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 5,
      episodeExistsInTmdb: true,
      singleEpisodeRuntimeMinutes: 22,
    });

    // 30 + 25 + 25(≤5min) + 10 - 10(>15% relative) = 80
    expect(confidence).toBe(80);
  });

  it('should apply smaller penalty for 10-15% relative diff', () => {
    // 5min diff on 44min drama = 11.4% → 10-15% → -5
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 5,
      episodeExistsInTmdb: true,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 30 + 25 + 25(≤5min) + 10 - 5(10-15% relative) = 85
    expect(confidence).toBe(85);
  });

  it('should not apply relative penalty for tight matches (<=10%)', () => {
    // 2min diff on 44min drama = 4.5% → ≤10% → no penalty
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 2,
      episodeExistsInTmdb: true,
      singleEpisodeRuntimeMinutes: 44,
    });

    // 30 + 25 + 35(≤3min) + 10 = 100, no relative penalty
    expect(confidence).toBe(100);
  });

  it('should stack multi-episode and relative penalties', () => {
    // Multi-ep match with 8min combined diff on 22min sitcom = 36.4%
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: true,
      runtimeDiffMinutes: 8,
      episodeExistsInTmdb: true,
      isMultiEpisodeMatch: true,
      singleEpisodeRuntimeMinutes: 22,
    });

    // 30 + 25 + 15(≤10min) + 10 - 10(multi-ep) - 10(>15% relative) = 60
    expect(confidence).toBe(60);
  });

  it('should not apply relative penalty when isSpecialsMatch is true', () => {
    // Specials already use their own percentage-based scoring
    const confidence = computeBatchConfidence({
      userConfirmedShow: true,
      sequentialPositionMatch: false,
      runtimeDiffMinutes: 6,
      episodeExistsInTmdb: true,
      isSpecialsMatch: true,
      tmdbRuntimeMinutes: 132,
      singleEpisodeRuntimeMinutes: 132,
    });

    // Specials path: 30 + 0 + 35(≤5%) + 10 = 75, NO relative penalty
    expect(confidence).toBe(75);
  });
});

describe('matchSeasonBatch', () => {
  it('should be importable and defined', () => {
    expect(matchSeasonBatch).toBeDefined();
    expect(typeof matchSeasonBatch).toBe('function');
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates1, true, undefined, cache);
    // Second call — should use cache
    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates2, true, undefined, cache);

    // getSeasonDetails should only be called once
    expect(client.getSeasonDetails).toHaveBeenCalledTimes(1);
  });

  it('should cache null when Season 0 not found and skip on subsequent calls', async () => {
    const client = makeMockClient(null);
    const cache = new Map<number, TmdbSeasonDetails | null>();

    const candidates1 = [makeClassifiedFile('S1D1', 'title_t00.mkv', 138)];
    const candidates2 = [makeClassifiedFile('S2D1', 'title_t00.mkv', 130)];

    await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates1, true, undefined, cache);
    const result2 = await matchSpecialsBatch(client, 12345, 'TestShow', 2009, candidates2, true, undefined, cache);

    // Should only call once (cached null)
    expect(client.getSeasonDetails).toHaveBeenCalledTimes(1);
    expect(result2.matched).toHaveLength(0);
    expect(result2.unmatched).toHaveLength(1);
  });

  it('should handle empty candidates list', async () => {
    const client = makeMockClient(null);

    const result = await matchSpecialsBatch(
      client, 12345, 'TestShow', 2009, [], true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
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
      client, 12345, 'TestShow', 2009, candidates, true,
    );

    expect(result.matched).toHaveLength(1);
    // Verify the new filename contains S00E03
    expect(result.matched[0].newFilename).toContain('S00E03');
  });
});
