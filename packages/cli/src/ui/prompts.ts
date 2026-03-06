import { confirm, select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { filterAutoAccepted } from '@bluslate/core';
import type { MatchResult, TmdbTvResult, TmdbClient, DvdCompareSearchResult, ShowIdentificationResult } from '@bluslate/core';
import { editSingleMatch, displayReviewList, formatRuntimeMmSs } from './editor.js';
import type { ReviewStatus } from './editor.js';
import { displayResults } from './display.js';

export async function confirmRenames(
  matches: MatchResult[],
  autoAccept: boolean,
  minConfidence: number,
  template?: string,
  scanDirectory?: string,
  client?: TmdbClient,
): Promise<MatchResult[]> {
  let toRename = matches.filter((m) => m.status !== 'unmatched');

  if (toRename.length === 0) return [];

  // Auto-accept high-confidence matches if --yes flag is set
  if (autoAccept) {
    const autoAccepted = filterAutoAccepted(matches, minConfidence);
    const needsReview = toRename.filter((m) => m.confidence < minConfidence);

    if (needsReview.length === 0) return autoAccepted;

    // Review low-confidence matches individually
    const confirmed = [...autoAccepted];
    for (const match of needsReview) {
      const accepted = await confirmSingleRename(match);
      if (accepted) confirmed.push(match);
    }
    return confirmed;
  }

  // Interactive mode: confirm all at once, review/edit, or skip
  while (true) {
    if (toRename.length === 0) {
      console.log(chalk.yellow('\nNo files remaining to rename.\n'));
      return [];
    }

    if (toRename.length === 1) {
      const accepted = await confirmSingleRename(toRename[0]);
      return accepted ? [toRename[0]] : [];
    }

    const action = await select({
      message: `Rename ${toRename.length} file(s)?`,
      choices: [
        { name: 'Yes, rename all', value: 'all' },
        { name: 'Review and edit', value: 'review' },
        { name: 'Skip all', value: 'none' },
      ],
    });

    if (action === 'all') return toRename;
    if (action === 'none') return [];

    if (action === 'review') {
      const result = await reviewAndEdit(matches, template, scanDirectory, client);

      if (result === null) {
        // User chose "Back to menu" — re-filter and loop back
        toRename = matches.filter((m) => m.status !== 'unmatched');
        continue;
      }

      return result;
    }
  }
}

/**
 * Unified review-and-edit flow. Combines file picker (non-linear) with
 * per-file accept/edit/skip. Returns the list of files to rename,
 * or null if the user chose "Back to menu".
 */
async function reviewAndEdit(
  matches: MatchResult[],
  template?: string,
  scanDirectory?: string,
  client?: TmdbClient,
): Promise<MatchResult[] | null> {
  const editable = matches.filter((m) => m.status !== 'unmatched' && m.tmdbMatch);

  if (editable.length === 0) {
    console.log(chalk.yellow('\nNo editable matches available.\n'));
    return null;
  }

  const statusMap = new Map<MatchResult, ReviewStatus>();
  for (const m of editable) {
    statusMap.set(m, 'pending');
  }

  while (true) {
    displayReviewList(editable, statusMap);

    const choices = editable.map((m, i) => {
      const status = statusMap.get(m) ?? 'pending';
      const statusSuffix = status === 'accepted' ? chalk.green(' ✓')
        : status === 'skipped' ? chalk.red(' ✗')
        : '';
      const runtime = formatRuntimeMmSs(m);
      const display = status === 'skipped'
        ? `${String(i + 1).padStart(2)}. ${chalk.dim(m.mediaFile.fileName)}  ${chalk.dim('(skipped)')}${statusSuffix}`
        : `${String(i + 1).padStart(2)}. [${runtime}] ${m.mediaFile.fileName}  ${chalk.dim('-->')}  ${m.newFilename}${statusSuffix}`;
      return {
        name: display,
        value: i,
      };
    });

    const action = await select({
      message: 'Select a file to review, or finish:',
      choices: [
        ...choices,
        { name: chalk.green('Accept all and rename'), value: -1 },
        { name: 'Back to menu', value: -2 },
      ],
      loop: false,
      pageSize: 20,
    });

    if (action === -1) {
      // Accept all and rename: return all non-skipped files
      const toRename = editable.filter((m) => statusMap.get(m) !== 'skipped');

      // Re-display results if any edits were made
      if (scanDirectory) {
        displayResults(matches, scanDirectory);
      }

      return toRename.filter((m) => m.status !== 'unmatched');
    }

    if (action === -2) {
      // Back to menu — discard review state
      return null;
    }

    const match = editable[action];

    // If the file was skipped, it can't be edited (tmdbMatch is cleared)
    if (statusMap.get(match) === 'skipped') {
      console.log(chalk.dim('  This file has been skipped and cannot be edited.'));
      continue;
    }

    const result = await editSingleMatch(match, template, client);

    switch (result) {
      case 'accepted':
        statusMap.set(match, 'accepted');
        break;
      case 'edited':
        statusMap.set(match, 'accepted');
        break;
      case 'skipped':
        statusMap.set(match, 'skipped');
        break;
      case 'cancelled':
        // No change to status
        break;
    }
  }
}

async function confirmSingleRename(match: MatchResult): Promise<boolean> {
  return confirm({
    message: `Rename "${match.mediaFile.fileName}" -> "${match.newFilename}" (${match.confidence}% confidence)?`,
    default: match.confidence >= 60,
  });
}

/**
 * Present TMDb search results to the user and ask them to confirm or select the correct show.
 * Returns the confirmed TmdbTvResult, or null if the user skips.
 */
export async function confirmShowIdentification(
  directoryShowName: string,
  candidates: TmdbTvResult[],
): Promise<ShowIdentificationResult> {
  if (candidates.length === 0) {
    console.log(chalk.yellow(`\nNo TMDb results found for: "${directoryShowName}"\n`));
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Search with different name', value: 'search' as const },
        { name: 'Skip this show', value: 'skip' as const },
      ],
    });

    if (action === 'search') {
      const query = await input({ message: 'Enter show name to search:' });
      if (!query.trim()) return null;
      return { __retry: query.trim() };
    }
    return null;
  }

  const topMatch = candidates[0];
  const year = topMatch.first_air_date
    ? topMatch.first_air_date.substring(0, 4)
    : 'unknown year';

  console.log(
    `\n${chalk.cyan('Detected show from directory:')} ${chalk.bold(directoryShowName)}`,
  );

  const choices = [
    {
      name: `Yes — ${topMatch.name} (${year})`,
      value: 'confirm' as const,
    },
    ...candidates.slice(1).map((c, idx) => {
      const cYear = c.first_air_date ? c.first_air_date.substring(0, 4) : '?';
      return {
        name: `${c.name} (${cYear})`,
        value: `pick-${idx + 1}` as const,
      };
    }),
    {
      name: 'Search with different name',
      value: 'search' as const,
    },
    {
      name: 'Skip this show',
      value: 'skip' as const,
    },
  ];

  const action = await select({
    message: `Is this "${chalk.bold(topMatch.name)}" (${year})?`,
    choices,
  });

  if (action === 'confirm') {
    return topMatch;
  }

  if (action === 'skip') {
    return null;
  }

  if (action === 'search') {
    const query = await input({
      message: 'Enter show name to search:',
    });
    if (!query.trim()) return null;

    return { __retry: query.trim() };
  }

  // User picked an alternative candidate
  if (typeof action === 'string' && action.startsWith('pick-')) {
    const idx = parseInt(action.substring(5), 10);
    return candidates[idx] ?? null;
  }

  return null;
}

/**
 * Present DVDCompare search results to the user and ask them to select
 * one or more disc releases for runtime matching.
 * DVDCompare often has separate entries per season, so multi-select is supported.
 * Returns selected results, or an empty array to skip.
 */
export async function confirmDvdCompareSelection(
  showName: string,
  candidates: DvdCompareSearchResult[],
): Promise<DvdCompareSearchResult[]> {
  if (candidates.length === 0) return [];

  console.log(
    `\n${chalk.cyan('DVDCompare results for:')} ${chalk.bold(showName)}`,
  );
  console.log(chalk.dim('  DVDCompare often has separate entries per season — you can select multiple.\n'));

  const selected: DvdCompareSearchResult[] = [];
  let done = false;

  while (!done) {
    const remaining = candidates.filter((c) => !selected.includes(c));

    const choices = remaining.map((c) => {
      const type = c.isBluray ? chalk.blue('Blu-ray') : chalk.yellow('DVD');
      const years = c.years ? ` (${c.years})` : '';
      const warning = c.episodeCount === 0 ? chalk.red(' (no episode runtimes)') : '';
      return {
        name: `${c.title}${years} — ${type}${warning}`,
        value: c.fid,
      };
    });

    if (selected.length > 0) {
      choices.push({
        name: chalk.green(`Done — use ${selected.length} selected release(s)`),
        value: -2,
      });
    }

    choices.push({
      name: chalk.dim('Skip DVDCompare (use TMDb runtimes only)'),
      value: -1,
    });

    const selectedNames = selected.map((s) => s.title).join(', ');
    const message = selected.length > 0
      ? `Select another release (selected: ${selectedNames}):`
      : 'Select a DVDCompare disc release for episode runtime matching:';

    const action = await select({ message, choices });

    if (action === -1) return [];
    if (action === -2) {
      done = true;
    } else {
      const picked = candidates.find((c) => c.fid === action);
      if (picked) selected.push(picked);

      // If no more candidates left, we're done
      if (selected.length === candidates.length) done = true;
    }
  }

  return selected;
}

export async function promptForApiKey(): Promise<string> {
  const key = await input({
    message: 'Enter your TMDb API Read Access Token:',
    validate: (value) => value.trim().length > 0 || 'API key cannot be empty',
  });

  return key.trim();
}
