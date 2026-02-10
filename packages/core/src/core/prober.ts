import { execFile } from 'node:child_process';
import { logger } from '../utils/logger.js';
import type { ProbeResult } from '../types/media.js';
import type { FfprobeOutput } from '../types/probe.js';

let ffprobeAvailable: boolean | null = null;

async function checkFfprobe(): Promise<boolean> {
  if (ffprobeAvailable !== null) return ffprobeAvailable;

  return new Promise((resolve) => {
    execFile('ffprobe', ['-version'], (error) => {
      ffprobeAvailable = !error;
      if (!ffprobeAvailable) {
        logger.warn('ffprobe not found. Install ffmpeg for better matching accuracy.');
      }
      resolve(ffprobeAvailable);
    });
  });
}

function runFfprobe(filePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { maxBuffer: 1024 * 1024, timeout: 30_000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(new Error(`Failed to parse ffprobe output: ${parseError}`));
        }
      },
    );
  });
}

export async function probeFile(filePath: string): Promise<ProbeResult | undefined> {
  const available = await checkFfprobe();
  if (!available) return undefined;

  try {
    logger.probe(`Probing: ${filePath}`);
    const output = await runFfprobe(filePath);

    const tags = output.format?.tags ?? {};
    const durationStr = output.format?.duration;
    const durationSeconds = durationStr ? parseFloat(durationStr) : undefined;

    // Try to extract metadata from common tag keys (case-insensitive lookup)
    const tagLookup = (keys: string[]): string | undefined => {
      for (const key of keys) {
        for (const [tagKey, tagValue] of Object.entries(tags)) {
          if (tagKey.toLowerCase() === key.toLowerCase() && tagValue) {
            return tagValue;
          }
        }
      }
      return undefined;
    };

    const intTagLookup = (keys: string[]): number | undefined => {
      const val = tagLookup(keys);
      if (val === undefined) return undefined;
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? undefined : parsed;
    };

    const result: ProbeResult = {
      durationSeconds,
      durationMinutes: durationSeconds ? Math.round(durationSeconds / 60) : undefined,
      title: tagLookup(['title']),
      showName: tagLookup(['show', 'series', 'album', 'tvshow']),
      season: intTagLookup(['season_number', 'season']),
      episode: intTagLookup(['episode_sort', 'episode_id', 'episode_number', 'track']),
      format: output.format?.format_name,
    };

    logger.probe(`Duration: ${result.durationMinutes}min, Title: ${result.title ?? 'none'}`);
    return result;
  } catch (err) {
    logger.warn(`ffprobe failed for ${filePath}: ${err}`);
    return undefined;
  }
}
