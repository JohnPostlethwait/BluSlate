import * as path from 'node:path';
import chalk from 'chalk';
import type { MatchResult } from '../types/media.js';

function confidenceColor(confidence: number): (s: string) => string {
  if (confidence >= 85) return chalk.green;
  if (confidence >= 60) return chalk.yellow;
  return chalk.red;
}

function statusLabel(status: MatchResult['status']): string {
  switch (status) {
    case 'matched': return chalk.green('matched');
    case 'ambiguous': return chalk.yellow('ambiguous');
    case 'unmatched': return chalk.red('unmatched');
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return '...' + str.substring(str.length - maxLen + 3);
}

function formatRuntime(minutes: number | undefined): string {
  if (minutes === undefined) return chalk.dim('   --');
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return chalk.dim(`${h}h${String(m).padStart(2, '0')}m`);
  return chalk.dim(`${String(m).padStart(2)}min`);
}

export function displayResults(matches: MatchResult[], scanDirectory: string): void {
  if (matches.length === 0) {
    console.log(chalk.yellow('\nNo media files found.\n'));
    return;
  }

  const absoluteScanDir = path.resolve(scanDirectory);

  // Compute relative path from the scan directory
  function relativePath(filePath: string): string {
    const rel = path.relative(absoluteScanDir, filePath);
    // If relative path starts with "..", the file is outside the scan dir — show as-is
    return rel.startsWith('..') ? filePath : rel;
  }

  const matchedResults = matches.filter((m) => m.status !== 'unmatched');
  const unmatchedResults = matches.filter((m) => m.status === 'unmatched');

  // Matched / Ambiguous table
  if (matchedResults.length > 0) {
    console.log(chalk.bold('\n  Rename Plan:\n'));

    // Compute dynamic column widths based on actual content
    const termWidth = process.stdout.columns || 120;
    // Fixed-width parts: "  ## " (5) + spacing (3) + runtime (6) + spacing (2) + conf (4) + spacing (2) + status (9) = ~31
    const fixedWidth = 31;
    const availableForNames = Math.max(40, termWidth - fixedWidth);

    // Measure longest relative file path
    const maxOriginal = Math.max(
      'Original'.length,
      ...matchedResults.map((m) => relativePath(m.mediaFile.filePath).length),
    );
    // Cap original column: give it what it needs but no more than 50% of available space
    const colOriginal = Math.min(maxOriginal + 2, Math.floor(availableForNames * 0.5));
    // New name gets the rest
    const colNew = availableForNames - colOriginal;
    const colRuntime = 8;

    console.log(
      chalk.dim('  # ') +
      chalk.dim('Original'.padEnd(colOriginal)) +
      chalk.dim('New Name'.padEnd(colNew)) +
      chalk.dim('Runtime'.padEnd(colRuntime)) +
      chalk.dim('Confidence'),
    );
    console.log(chalk.dim('  ' + '-'.repeat(colOriginal + colNew + colRuntime + 14)));

    for (let i = 0; i < matchedResults.length; i++) {
      const m = matchedResults[i];
      const idx = String(i + 1).padStart(2, ' ');
      const original = truncate(relativePath(m.mediaFile.filePath), colOriginal - 1).padEnd(colOriginal);
      const newName = truncate(m.newFilename, colNew - 1).padEnd(colNew);
      const runtime = formatRuntime(m.probeData?.durationMinutes).padEnd(colRuntime);
      const confStr = confidenceColor(m.confidence)(`${String(m.confidence).padStart(3)}%`);
      const line = `  ${idx} ${original}${newName}${runtime}${confStr}  ${statusLabel(m.status)}`;
      console.log(line);
    }

    console.log(chalk.dim('  ' + '-'.repeat(colOriginal + colNew + colRuntime + 14)));

    const matched = matchedResults.filter((m) => m.status === 'matched').length;
    const ambiguous = matchedResults.filter((m) => m.status === 'ambiguous').length;
    console.log(
      `  ${chalk.green(`${matched} matched`)}` +
      (ambiguous > 0 ? ` | ${chalk.yellow(`${ambiguous} ambiguous`)}` : ''),
    );
  }

  // Unmatched table
  if (unmatchedResults.length > 0) {
    console.log(chalk.bold(`\n  Unmatched Files (${unmatchedResults.length}):\n`));

    for (let i = 0; i < unmatchedResults.length; i++) {
      const m = unmatchedResults[i];
      const idx = String(i + 1).padStart(2, ' ');
      const runtime = formatRuntime(m.probeData?.durationMinutes);
      console.log(`  ${idx} ${runtime}  ${relativePath(m.mediaFile.filePath)}`);
    }
  }

  console.log();
}

export function displaySummary(
  renamed: number,
  skipped: number,
  failed: number,
  dryRun: boolean,
): void {
  console.log(chalk.bold(`\n  ${dryRun ? 'Dry Run ' : ''}Summary:`));
  if (renamed > 0) console.log(chalk.green(`    Renamed: ${renamed} file(s)`));
  if (skipped > 0) console.log(chalk.yellow(`    Skipped: ${skipped} file(s)`));
  if (failed > 0) console.log(chalk.red(`    Failed:  ${failed} file(s)`));
  console.log();
}
