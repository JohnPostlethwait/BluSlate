import type { MatchResultData } from './types.js';

export function relativePath(filePath: string, scanDirectory: string): string {
  if (!scanDirectory) return filePath;
  if (filePath.startsWith(scanDirectory)) {
    const rel = filePath.substring(scanDirectory.length);
    return rel.startsWith('/') || rel.startsWith('\\') ? rel.substring(1) : rel;
  }
  return filePath;
}

export function confidenceClass(confidence: number): string {
  if (confidence >= 85) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
}

export function formatDuration(probeData?: { durationSeconds?: number }): string {
  if (!probeData?.durationSeconds) return '--';
  const totalSec = Math.round(probeData.durationSeconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTmdbRuntime(runtime?: number | null): string {
  if (runtime == null) return '--';
  return `${runtime} min`;
}

export function formatDvdCompareRuntime(match: MatchResultData): string {
  if (match.dvdCompareRuntimeSeconds != null) {
    return formatDuration({ durationSeconds: match.dvdCompareRuntimeSeconds });
  }
  return '--';
}

export function formatSize(sizeBytes: number): string {
  const gb = sizeBytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = sizeBytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

export function confidenceTooltip(match: MatchResultData): string {
  if (match.confidenceBreakdown && match.confidenceBreakdown.length > 0) {
    const lines = match.confidenceBreakdown.map((item) => {
      const sign = item.points >= 0 ? '+' : '';
      if (item.maxPoints !== undefined) {
        return `${item.label} (${sign}${item.points}/${item.maxPoints})`;
      }
      return `${item.label} (${sign}${item.points})`;
    });
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    lines.push(`Total: ${match.confidence}%`);
    return lines.join('\n');
  }
  return `Confidence: ${match.confidence}%`;
}
