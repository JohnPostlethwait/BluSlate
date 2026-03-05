/**
 * Shared test factory functions for building common test objects.
 */

import type { MediaFile } from '../../packages/core/src/types/media.js';

export function makeMediaFile(name: string, sizeBytes: number = 700_000_000): MediaFile {
  return {
    filePath: `/media/${name}`,
    fileName: name,
    extension: name.substring(name.lastIndexOf('.')),
    sizeBytes,
  };
}
