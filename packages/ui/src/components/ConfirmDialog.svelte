<script lang="ts">
  import type { MatchResultData } from '../types.js';
  import {
    relativePath as relPath,
    confidenceClass,
    formatDuration,
    formatTmdbRuntime,
    formatDvdCompareRuntime,
    formatSize,
    confidenceTooltip,
  } from '../utils.js';

  interface Props {
    matches: MatchResultData[];
    scanDirectory: string;
    onconfirm: (confirmed: MatchResultData[]) => void;
    oncancel: () => void;
  }

  let { matches, scanDirectory, onconfirm, oncancel }: Props = $props();

  function relativePath(filePath: string): string {
    return relPath(filePath, scanDirectory);
  }

  // Split matches into actionable (matched/ambiguous) and unmatched
  let renameable = $derived(
    matches.filter((m) => m.status !== 'unmatched'),
  );
  let skipped = $derived(
    matches.filter((m) => m.status === 'unmatched'),
  );

  // Track selected state per renameable match
  let selected = $state<boolean[]>([]);
  let openTooltipKey = $state<string | null>(null);

  // ── Reorder state ──────────────────────────────────────────────────
  // Tracks each file's original season+episode assignment (by filePath → "season:episode")
  let originalAssignment = $state<Map<string, string>>(new Map());
  // Files the user explicitly clicked to move (by filePath)
  let userMoved = $state<Set<string>>(new Set());
  // Reorder version counter — bumped on each reorder to trigger re-derivation
  let reorderVersion = $state(0);

  /** Snapshot a file's current assignment if not already captured */
  function snapshotOriginal(fileIdx: number) {
    const file = renameable[fileIdx];
    const key = file.mediaFile.filePath;
    if (originalAssignment.has(key)) return;
    const tm = file.tmdbMatch;
    originalAssignment.set(key, `${tm?.seasonNumber}:${tm?.episodeNumber}`);
    originalAssignment = new Map(originalAssignment);
  }

  /**
   * Derive reorder status for each file:
   * - 'moved'     — user explicitly moved this file
   * - 'displaced' — bumped as a side effect of another move
   * - undefined   — still in original position
   */
  let reorderStatus = $derived.by(() => {
    void reorderVersion;
    const status = new Map<string, 'moved' | 'displaced'>();
    for (const [filePath, origKey] of originalAssignment) {
      const file = renameable.find((m) => m.mediaFile.filePath === filePath);
      if (!file) continue;
      const currentKey = `${file.tmdbMatch?.seasonNumber}:${file.tmdbMatch?.episodeNumber}`;
      if (currentKey !== origKey) {
        status.set(filePath, userMoved.has(filePath) ? 'moved' : 'displaced');
      }
    }
    return status;
  });

  let warningFiles = $derived(
    matches.filter((m) => m.warnings && m.warnings.length > 0),
  );
  let showWarningBanner = $state(true);

  function toggleTooltip(key: string) {
    openTooltipKey = openTooltipKey === key ? null : key;
  }

  function handleWindowClick(e: MouseEvent) {
    if (openTooltipKey === null) return;
    const target = e.target as HTMLElement;
    // Ignore clicks on badge buttons and tooltip popovers themselves
    if (target.closest('.badge-wrap')) return;
    openTooltipKey = null;
  }

  // Reset selections when renameable list changes
  $effect(() => {
    selected = Array.from({ length: renameable.length }, () => true);
  });

  let selectedCount = $derived(selected.filter(Boolean).length);

  // Track original matches-array indices for skipped files (needed for within-skipped reorder)
  let skippedMatchIndices = $derived(
    matches.reduce<number[]>((acc, m, i) => {
      if (m.status === 'unmatched') acc.push(i);
      return acc;
    }, [])
  );

  interface MissingEpisode {
    episodeNumber: number;
    episodeName: string;
    runtime: number | null;
  }

  type RenameableRow =
    | { type: 'matched'; match: MatchResultData; index: number; isMultiEp: boolean; filePos: number }
    | { type: 'missing'; episode: MissingEpisode };

  interface RenameableGroup {
    label: string;
    rows: RenameableRow[];
    matchedCount: number;
    totalCount: number;
    /** Number of movable (single-episode) files in this group */
    movableCount: number;
  }

  function toggleAll(checked: boolean) {
    selected = selected.map(() => checked);
  }

  function handleConfirm() {
    const confirmed = renameable.filter((_, i) => selected[i]);
    onconfirm(confirmed);
  }

  /** Check if a match is a multi-episode file (locked, not reorderable) */
  function isMultiEpisode(m: MatchResultData): boolean {
    const tm = m.tmdbMatch;
    if (!tm) return false;
    return tm.episodeNumberEnd !== undefined && tm.episodeNumberEnd !== tm.episodeNumber;
  }

  function parseSeasonNumber(label: string): number {
    const m = label.match(/Season\s+(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  /** Swap two files' episode assignments and regenerate their filenames */
  async function swapEpisodes(idxA: number, idxB: number) {
    const fileA = renameable[idxA];
    const fileB = renameable[idxB];
    if (!fileA.tmdbMatch || !fileB.tmdbMatch) return;

    // Snapshot original assignments before any mutation
    snapshotOriginal(idxA);
    snapshotOriginal(idxB);

    // Capture original episode info from both files
    const epA = {
      episodeNumber: fileA.tmdbMatch.episodeNumber,
      episodeTitle: fileA.tmdbMatch.episodeTitle,
      runtime: fileA.tmdbMatch.runtime,
      seasonNumber: fileA.tmdbMatch.seasonNumber,
      seasonEpisodes: fileA.tmdbMatch.seasonEpisodes,
    };
    const epB = {
      episodeNumber: fileB.tmdbMatch.episodeNumber,
      episodeTitle: fileB.tmdbMatch.episodeTitle,
      runtime: fileB.tmdbMatch.runtime,
      seasonNumber: fileB.tmdbMatch.seasonNumber,
      seasonEpisodes: fileB.tmdbMatch.seasonEpisodes,
    };

    // Swap episode assignments
    fileA.tmdbMatch.episodeNumber = epB.episodeNumber;
    fileA.tmdbMatch.episodeTitle = epB.episodeTitle;
    fileA.tmdbMatch.runtime = epB.runtime;
    fileA.tmdbMatch.seasonNumber = epB.seasonNumber;
    fileA.tmdbMatch.seasonEpisodes = epB.seasonEpisodes;
    if (fileA.parsed.episodeNumbers) {
      fileA.parsed.episodeNumbers = [epB.episodeNumber];
    }

    fileB.tmdbMatch.episodeNumber = epA.episodeNumber;
    fileB.tmdbMatch.episodeTitle = epA.episodeTitle;
    fileB.tmdbMatch.runtime = epA.runtime;
    fileB.tmdbMatch.seasonNumber = epA.seasonNumber;
    fileB.tmdbMatch.seasonEpisodes = epA.seasonEpisodes;
    if (fileB.parsed.episodeNumbers) {
      fileB.parsed.episodeNumbers = [epA.episodeNumber];
    }

    // Track which file the user explicitly moved (fileA is the one the user clicked)
    userMoved.add(fileA.mediaFile.filePath);
    userMoved = new Set(userMoved);

    // Regenerate filenames for both files
    try {
      const newFilenames = await window.api.regenerateFilenames([
        { tmdbMatch: { ...fileA.tmdbMatch } as Record<string, unknown>, extension: fileA.mediaFile.extension },
        { tmdbMatch: { ...fileB.tmdbMatch } as Record<string, unknown>, extension: fileB.mediaFile.extension },
      ]);
      renameable[idxA].newFilename = newFilenames[0];
      renameable[idxB].newFilename = newFilenames[1];
    } catch {
      // Filename regeneration failed — episode data already updated
    }

    // Bump version to trigger UI re-derivation
    reorderVersion++;
  }

  /** Move a file into a missing episode slot (no other file affected) */
  async function moveToMissing(fileIdx: number, episode: MissingEpisode, targetSeasonLabel: string) {
    const file = renameable[fileIdx];
    if (!file.tmdbMatch) return;

    const targetSeason = parseSeasonNumber(targetSeasonLabel);

    // Snapshot original assignment before mutation
    snapshotOriginal(fileIdx);

    // Update the file's episode assignment
    file.tmdbMatch.episodeNumber = episode.episodeNumber;
    file.tmdbMatch.episodeTitle = episode.episodeName;
    file.tmdbMatch.runtime = episode.runtime ?? undefined;
    if (targetSeason >= 0) {
      if (file.tmdbMatch.seasonNumber !== targetSeason) {
        const targetGroup = groupedRenameable.find((g) => g.label === targetSeasonLabel);
        const targetMatch = targetGroup?.rows.find((r): r is RenameableRow & { type: 'matched' } => r.type === 'matched');
        if (targetMatch?.match.tmdbMatch?.seasonEpisodes) {
          file.tmdbMatch.seasonEpisodes = targetMatch.match.tmdbMatch.seasonEpisodes;
        }
      }
      file.tmdbMatch.seasonNumber = targetSeason;
    }
    if (file.parsed.episodeNumbers) {
      file.parsed.episodeNumbers = [episode.episodeNumber];
    }

    userMoved.add(file.mediaFile.filePath);
    userMoved = new Set(userMoved);

    // Regenerate filename
    try {
      const newFilenames = await window.api.regenerateFilenames([
        { tmdbMatch: { ...file.tmdbMatch } as Record<string, unknown>, extension: file.mediaFile.extension },
      ]);
      renameable[fileIdx].newFilename = newFilenames[0];
    } catch {
      // Filename regeneration failed — episode data already updated
    }

    reorderVersion++;
  }

  /**
   * Find the adjacent movable target row (up or down), skipping multi-ep rows.
   * Returns { type: 'matched', index } or { type: 'missing', episode } or null.
   */
  type AdjacentTarget =
    | { type: 'matched'; index: number; groupLabel: string }
    | { type: 'missing'; episode: MissingEpisode; groupLabel: string }
    | { type: 'skipped'; index: number };

  function findAdjacentTarget(
    groupIndex: number,
    rowIndex: number,
    direction: 'up' | 'down',
  ): AdjacentTarget | null {
    const group = groupedRenameable[groupIndex];
    const step = direction === 'up' ? -1 : 1;

    // Search within current group first
    for (let ri = rowIndex + step; ri >= 0 && ri < group.rows.length; ri += step) {
      const row = group.rows[ri];
      if (row.type === 'missing') return { type: 'missing', episode: row.episode, groupLabel: group.label };
      if (row.type === 'matched' && !row.isMultiEp) return { type: 'matched', index: row.index, groupLabel: group.label };
    }

    // Cross to adjacent group
    const nextGi = groupIndex + step;
    if (nextGi < 0 || nextGi >= groupedRenameable.length) {
      // Boundary: moving down past the last group can cross into skipped
      if (direction === 'down' && skipped.length > 0) return { type: 'skipped', index: 0 };
      return null;
    }
    const nextGroup = groupedRenameable[nextGi];
    const startRow = direction === 'up' ? nextGroup.rows.length - 1 : 0;
    const endRow = direction === 'up' ? -1 : nextGroup.rows.length;

    for (let ri = startRow; ri !== endRow; ri += step) {
      const row = nextGroup.rows[ri];
      if (row.type === 'missing') return { type: 'missing', episode: row.episode, groupLabel: nextGroup.label };
      if (row.type === 'matched' && !row.isMultiEp) return { type: 'matched', index: row.index, groupLabel: nextGroup.label };
    }

    // If the adjacent group had no movable rows and we're going down, try skipped
    if (direction === 'down' && skipped.length > 0) return { type: 'skipped', index: 0 };
    return null;
  }

  async function handleMoveUp(groupIndex: number, rowIdx: number, fileIdx: number) {
    const target = findAdjacentTarget(groupIndex, rowIdx, 'up');
    if (!target) return;
    if (target.type === 'matched') {
      await swapEpisodes(fileIdx, target.index);
    } else {
      await moveToMissing(fileIdx, target.episode, target.groupLabel);
    }
  }

  async function handleMoveDown(groupIndex: number, rowIdx: number, fileIdx: number) {
    const target = findAdjacentTarget(groupIndex, rowIdx, 'down');
    if (!target) return;
    if (target.type === 'matched') {
      await swapEpisodes(fileIdx, target.index);
    } else if (target.type === 'missing') {
      await moveToMissing(fileIdx, target.episode, target.groupLabel);
    } else if (target.type === 'skipped') {
      await swapRenameableAndSkipped(fileIdx, target.index);
    }
  }

  /** Swap two skipped files' positions in the matches array (within-skipped reorder) */
  function swapMatchPositions(skippedIdxA: number, skippedIdxB: number) {
    const matchIdxA = skippedMatchIndices[skippedIdxA];
    const matchIdxB = skippedMatchIndices[skippedIdxB];
    const temp = matches[matchIdxA];
    matches[matchIdxA] = matches[matchIdxB];
    matches[matchIdxB] = temp;
    reorderVersion++;
  }

  /** Snapshot a skipped file's original assignment (undefined:undefined) for reorder tracking */
  function snapshotSkippedOriginal(sk: MatchResultData) {
    const key = sk.mediaFile.filePath;
    if (originalAssignment.has(key)) return;
    originalAssignment.set(key, `${sk.tmdbMatch?.seasonNumber}:${sk.tmdbMatch?.episodeNumber}`);
    originalAssignment = new Map(originalAssignment);
  }

  /** Swap a renameable file's episode assignment with a skipped file (cross-boundary) */
  async function swapRenameableAndSkipped(renameableIdx: number, skippedIdx: number) {
    const ep = renameable[renameableIdx];
    const sk = skipped[skippedIdx];
    if (!ep.tmdbMatch) return;

    snapshotOriginal(renameableIdx);
    snapshotSkippedOriginal(sk);

    const epTmdb = { ...ep.tmdbMatch };
    const epStatus = ep.status;

    // Promote skipped file: give it the episode assignment
    sk.tmdbMatch = epTmdb;
    sk.status = epStatus;
    if (sk.parsed.episodeNumbers && epTmdb.episodeNumber !== undefined) {
      sk.parsed.episodeNumbers = [epTmdb.episodeNumber];
    }

    // Demote renameable file
    ep.tmdbMatch = undefined;
    ep.status = 'unmatched';

    userMoved.add(sk.mediaFile.filePath);
    userMoved = new Set(userMoved);

    try {
      const newFilenames = await window.api.regenerateFilenames([
        { tmdbMatch: { ...sk.tmdbMatch } as Record<string, unknown>, extension: sk.mediaFile.extension },
      ]);
      sk.newFilename = newFilenames[0];
    } catch {
      // Filename regeneration failed — episode data already updated
    }

    reorderVersion++;
  }

  /** Promote a skipped file into a missing episode slot */
  async function promoteSkippedToMissing(skippedIdx: number, episode: MissingEpisode, targetSeasonLabel: string) {
    const sk = skipped[skippedIdx];
    snapshotSkippedOriginal(sk);
    const targetSeason = parseSeasonNumber(targetSeasonLabel);
    const targetGroup = groupedRenameable.find((g) => g.label === targetSeasonLabel);
    const refRow = targetGroup?.rows.find((r): r is RenameableRow & { type: 'matched' } => r.type === 'matched');
    if (!refRow?.match.tmdbMatch) return;

    const ref = refRow.match.tmdbMatch;
    sk.tmdbMatch = {
      id: ref.id,
      name: ref.name,
      year: ref.year,
      mediaType: ref.mediaType,
      seasonNumber: targetSeason >= 0 ? targetSeason : ref.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.episodeName,
      runtime: episode.runtime ?? undefined,
      seasonEpisodes: ref.seasonEpisodes,
      seasonEpisodeCount: ref.seasonEpisodeCount,
    };
    sk.status = refRow.match.status;
    if (sk.parsed.episodeNumbers) {
      sk.parsed.episodeNumbers = [episode.episodeNumber];
    }

    userMoved.add(sk.mediaFile.filePath);
    userMoved = new Set(userMoved);

    try {
      const newFilenames = await window.api.regenerateFilenames([
        { tmdbMatch: { ...sk.tmdbMatch } as Record<string, unknown>, extension: sk.mediaFile.extension },
      ]);
      sk.newFilename = newFilenames[0];
    } catch {
      // Filename regeneration failed — episode data already updated
    }

    reorderVersion++;
  }

  /** Find the adjacent target for a skipped file (up crosses into episode groups; down stays in skipped) */
  function findSkippedAdjacentTarget(skippedIdx: number, direction: 'up' | 'down'): AdjacentTarget | null {
    if (direction === 'down') {
      if (skippedIdx < skipped.length - 1) return { type: 'skipped', index: skippedIdx + 1 };
      return null;
    }

    // direction === 'up': first try to stay within skipped
    if (skippedIdx > 0) return { type: 'skipped', index: skippedIdx - 1 };

    // skippedIdx === 0: look at the bottom of the episode groups
    for (let gi = groupedRenameable.length - 1; gi >= 0; gi--) {
      const group = groupedRenameable[gi];
      for (let ri = group.rows.length - 1; ri >= 0; ri--) {
        const row = group.rows[ri];
        if (row.type === 'missing') return { type: 'missing', episode: row.episode, groupLabel: group.label };
        if (row.type === 'matched' && !row.isMultiEp) return { type: 'matched', index: row.index, groupLabel: group.label };
      }
    }

    return null;
  }

  async function handleSkippedMoveUp(skippedIdx: number) {
    const target = findSkippedAdjacentTarget(skippedIdx, 'up');
    if (!target) return;
    if (target.type === 'skipped') {
      swapMatchPositions(skippedIdx, target.index);
    } else if (target.type === 'matched') {
      await swapRenameableAndSkipped(target.index, skippedIdx);
    } else if (target.type === 'missing') {
      await promoteSkippedToMissing(skippedIdx, target.episode, target.groupLabel);
    }
  }

  async function handleSkippedMoveDown(skippedIdx: number) {
    const target = findSkippedAdjacentTarget(skippedIdx, 'down');
    if (!target) return;
    if (target.type === 'skipped') swapMatchPositions(skippedIdx, target.index);
  }

  let hasDvdCompare = $derived(renameable.some((m) => m.dvdCompareUsed));

  let groupedRenameable = $derived.by(() => {
    // Touch reorderVersion to re-derive when reorder happens
    void reorderVersion;

    // First pass: group items by season
    type IndexedItem = { match: MatchResultData; index: number; isMultiEp: boolean };
    const itemsByLabel = new Map<string, IndexedItem[]>();
    const groupOrder: string[] = [];

    for (let i = 0; i < renameable.length; i++) {
      const m = renameable[i];
      const tm = m.tmdbMatch;
      const label = tm?.seasonNumber !== undefined ? `Season ${tm.seasonNumber}` : 'Other';
      if (!itemsByLabel.has(label)) {
        itemsByLabel.set(label, []);
        groupOrder.push(label);
      }
      itemsByLabel.get(label)!.push({ match: m, index: i, isMultiEp: isMultiEpisode(m) });
    }

    // Second pass: build interleaved rows per group
    const groups: RenameableGroup[] = [];

    for (const label of groupOrder) {
      const items = itemsByLabel.get(label)!;
      const matchedEpNums = new Set<number>();
      let seasonEpisodes: MissingEpisode[] | undefined;

      for (const item of items) {
        const tm = item.match.tmdbMatch;
        if (!tm) continue;
        if (!seasonEpisodes && tm.seasonEpisodes) seasonEpisodes = tm.seasonEpisodes;
        if (tm.episodeNumber !== undefined) {
          matchedEpNums.add(tm.episodeNumber);
          if (tm.episodeNumberEnd !== undefined) {
            for (let ep = tm.episodeNumber + 1; ep <= tm.episodeNumberEnd; ep++) {
              matchedEpNums.add(ep);
            }
          }
        }
      }

      let rows: RenameableRow[];
      let totalCount: number;
      let matchedCount: number;
      let movableCount = 0;

      if (seasonEpisodes) {
        totalCount = seasonEpisodes.length;
        matchedCount = matchedEpNums.size;
        rows = [];

        // Walk full episode list in order, placing files at their episodeNumber positions
        const epToItem = new Map<number, IndexedItem>();
        for (const item of items) {
          const tm = item.match.tmdbMatch;
          if (tm?.episodeNumber !== undefined) {
            epToItem.set(tm.episodeNumber, item);
          }
        }

        const usedItems = new Set<IndexedItem>();
        let singlePos = 0;
        for (const ep of seasonEpisodes) {
          const matchItem = epToItem.get(ep.episodeNumber);
          if (matchItem) {
            const isME = matchItem.isMultiEp;
            rows.push({ type: 'matched', match: matchItem.match, index: matchItem.index, isMultiEp: isME, filePos: isME ? -1 : singlePos });
            if (!isME) {
              singlePos++;
              movableCount++;
            }
            usedItems.add(matchItem);
          } else if (!matchedEpNums.has(ep.episodeNumber)) {
            rows.push({ type: 'missing', episode: ep });
          }
        }
        // Append any items not in the episode list (edge case)
        for (const item of items) {
          if (!usedItems.has(item)) {
            rows.push({ type: 'matched', match: item.match, index: item.index, isMultiEp: item.isMultiEp, filePos: item.isMultiEp ? -1 : singlePos++ });
            if (!item.isMultiEp) movableCount++;
          }
        }
      } else {
        const firstTm = items[0]?.match.tmdbMatch;
        totalCount = firstTm?.seasonEpisodeCount ?? items.length;
        matchedCount = matchedEpNums.size || items.length;
        let singlePos = 0;
        rows = items.map((item) => {
          const isME = item.isMultiEp;
          const fp = isME ? -1 : singlePos++;
          if (!isME) movableCount++;
          return { type: 'matched' as const, match: item.match, index: item.index, isMultiEp: isME, filePos: fp };
        });
      }

      groups.push({ label, rows, matchedCount, totalCount, movableCount });
    }

    return groups;
  });
</script>

<svelte:window onclick={handleWindowClick} />

<div class="confirm-dialog">
  <h2>Review Rename Plan</h2>
  <p class="subtitle">
    {selectedCount} of {renameable.length} files selected for renaming
    {#if skipped.length > 0}
      &middot; {skipped.length} skipped
    {/if}
  </p>

  {#if showWarningBanner && warningFiles.length > 0}
    <div class="warning-banner">
      <div class="warning-header">
        <span class="warning-icon">&#9888;</span>
        <strong>Warnings</strong>
        <button class="dismiss-btn" onclick={() => (showWarningBanner = false)}>Dismiss</button>
      </div>
      <ul class="warning-list">
        {#each warningFiles as wf}
          <li>
            <span class="warning-file">{relativePath(wf.mediaFile.filePath)}</span>
            {#each wf.warnings ?? [] as warning}
              <div class="warning-detail">{warning}</div>
            {/each}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="toolbar">
    <button class="btn-link" onclick={() => toggleAll(true)}>Select All</button>
    <button class="btn-link" onclick={() => toggleAll(false)}>Deselect All</button>
  </div>

  <table>
    <thead>
      <tr>
        <th class="col-check"></th>
        <th class="col-reorder"></th>
        <th>Original</th>
        <th class="col-fixed">Size</th>
        <th class="col-fixed">Runtime</th>
        <th class="col-arrow"></th>
        <th class="col-fixed">TMDb</th>
        {#if hasDvdCompare}
          <th class="col-fixed">DVDCompare</th>
        {/if}
        <th>Episode</th>
        <th class="col-fixed">Conf.</th>
      </tr>
    </thead>
    <tbody>
      {#each groupedRenameable as group, gi}
        <tr class="season-divider">
          <td colspan={hasDvdCompare ? 10 : 9}>
            <span class="season-label">{group.label}</span>
            {#if group.totalCount > 0}
              <span class="season-stat" class:stat-complete={group.matchedCount === group.totalCount} class:stat-partial={group.matchedCount !== group.totalCount}>
                {group.matchedCount}/{group.totalCount} episodes matched
              </span>
            {:else}
              <span class="season-file-count">({group.rows.length} files)</span>
            {/if}
          </td>
        </tr>
        {#each group.rows as row, i}
          {#if row.type === 'matched'}
            {@const tooltipKey = `${group.label}-${i}`}
            {@const rowStatus = reorderStatus.get(row.match.mediaFile.filePath)}
            <tr class:deselected={!selected[row.index]} class:user-moved={rowStatus === 'moved'} class:user-displaced={rowStatus === 'displaced'}>
              <td class="col-check">
                <input type="checkbox" bind:checked={selected[row.index]} />
              </td>
              <td class="col-reorder">
                {#if !row.isMultiEp && (group.movableCount > 1 || groupedRenameable.length > 1 || group.totalCount > group.matchedCount)}
                  <div class="reorder-btns">
                    <button
                      class="reorder-btn"
                      disabled={!findAdjacentTarget(gi, i, 'up')}
                      onclick={() => handleMoveUp(gi, i, row.index)}
                      title="Move file up"
                    >&#9650;</button>
                    <button
                      class="reorder-btn"
                      disabled={!findAdjacentTarget(gi, i, 'down')}
                      onclick={() => handleMoveDown(gi, i, row.index)}
                      title="Move file down"
                    >&#9660;</button>
                  </div>
                {:else if row.isMultiEp}
                  <div class="reorder-btns">
                    <button class="reorder-btn" disabled title="Multi-episode file (locked)">&#9650;</button>
                    <button class="reorder-btn" disabled title="Multi-episode file (locked)">&#9660;</button>
                  </div>
                {/if}
              </td>
              <td class="col-wrap">{relativePath(row.match.mediaFile.filePath)}</td>
              <td class="col-fixed col-dim">{formatSize(row.match.mediaFile.sizeBytes)}</td>
              <td class="col-fixed col-dim">{formatDuration(row.match.probeData)}</td>
              <td class="col-arrow">&rarr;</td>
              <td class="col-fixed col-dim">{formatTmdbRuntime(row.match.tmdbMatch?.runtime)}</td>
              {#if hasDvdCompare}
                <td class="col-fixed col-dim">
                  {#if row.match.dvdCompareRuntimeSeconds != null}
                    {formatDvdCompareRuntime(row.match)}
                  {:else}
                    <span class="dvd-missing-badge">missing</span>
                  {/if}
                </td>
              {/if}
              <td class="col-wrap">{#if row.match.tmdbMatch?.episodeNumber !== undefined}E{String(row.match.tmdbMatch.episodeNumber).padStart(2, '0')}{#if row.match.tmdbMatch.episodeNumberEnd}–E{String(row.match.tmdbMatch.episodeNumberEnd).padStart(2, '0')}{/if} — {row.match.tmdbMatch.episodeTitle ?? ''}{:else}{row.match.newFilename}{/if}</td>
              <td class="col-fixed">
                <span class="badge-wrap">
                  <span
                    class="badge {confidenceClass(row.match.confidence)}"
                    title={confidenceTooltip(row.match)}
                    role="button"
                    tabindex="0"
                    onclick={() => toggleTooltip(tooltipKey)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTooltip(tooltipKey); }}
                  >{row.match.confidence}%</span>
                  {#if openTooltipKey === tooltipKey}
                    <div class="tooltip-popover">{confidenceTooltip(row.match)}</div>
                  {/if}
                </span>
              </td>
            </tr>
          {:else}
            <tr class="missing-episode">
              <td class="col-check"></td>
              <td class="col-reorder"></td>
              <td class="col-wrap missing-label"><span class="missing-badge">missing</span></td>
              <td class="col-fixed col-dim">--</td>
              <td class="col-fixed col-dim">--</td>
              <td class="col-arrow"></td>
              <td class="col-fixed col-dim">{row.episode.runtime ? `${row.episode.runtime} min` : '--'}</td>
              {#if hasDvdCompare}
                <td class="col-fixed col-dim">--</td>
              {/if}
              <td class="col-wrap missing-label">E{String(row.episode.episodeNumber).padStart(2, '0')} — {row.episode.episodeName}</td>
              <td class="col-fixed">--</td>
            </tr>
          {/if}
        {/each}
      {/each}
    </tbody>
  </table>

  {#if skipped.length > 0}
    <h3 class="skipped-heading">
      Skipped <span class="count">({skipped.length} files)</span>
    </h3>
    <table class="skipped-table">
      <thead>
        <tr>
          <th class="col-reorder"></th>
          <th class="col-num">#</th>
          <th>File</th>
          <th class="col-fixed">Size</th>
          <th class="col-fixed">Runtime</th>
          <th class="col-fixed">Reason</th>
        </tr>
      </thead>
      <tbody>
        {#each skipped as match, i}
          <tr>
            <td class="col-reorder">
              <div class="reorder-btns">
                <button
                  class="reorder-btn"
                  disabled={!findSkippedAdjacentTarget(i, 'up')}
                  onclick={() => handleSkippedMoveUp(i)}
                  title="Move file up"
                >&#9650;</button>
                <button
                  class="reorder-btn"
                  disabled={!findSkippedAdjacentTarget(i, 'down')}
                  onclick={() => handleSkippedMoveDown(i)}
                  title="Move file down"
                >&#9660;</button>
              </div>
            </td>
            <td class="col-num">{i + 1}</td>
            <td class="col-wrap">{relativePath(match.mediaFile.filePath)}</td>
            <td class="col-fixed col-dim">{formatSize(match.mediaFile.sizeBytes)}</td>
            <td class="col-fixed col-dim">{formatDuration(match.probeData)}</td>
            <td class="col-fixed">
              <span class="reason-unmatched">unmatched</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
    <button
      style="background: transparent; border: 1px solid #555; color: #aaa; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;"
      onclick={oncancel}
    >Cancel</button>
    <button
      style="background: {selectedCount === 0 ? '#00d4ff66' : '#00d4ff'}; border: none; color: #0a0a1a; padding: 10px 24px; border-radius: 8px; cursor: {selectedCount === 0 ? 'not-allowed' : 'pointer'}; font-size: 0.9rem; font-weight: 600;"
      onclick={handleConfirm}
      disabled={selectedCount === 0}
    >Rename {selectedCount} File{selectedCount !== 1 ? 's' : ''}</button>
  </div>
</div>

<style>
  .confirm-dialog {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    padding: 24px;
  }

  h2 {
    font-size: 1.2rem;
    color: #e0e0e0;
    margin: 0 0 4px;
  }

  .subtitle {
    color: #888;
    font-size: 0.9rem;
    margin: 0 0 16px;
  }

  .season-label {
    margin-right: 12px;
  }

  .season-stat {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: 12px;
  }

  .stat-complete {
    background: #1b4332;
    color: #4caf50;
  }

  .stat-partial {
    background: #3a3000;
    color: #ffb300;
  }

  .season-file-count {
    color: #888;
    font-weight: normal;
    font-size: 0.85rem;
  }

  .toolbar {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }

  .btn-link {
    background: none;
    border: none;
    color: #00d4ff;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0;
    text-decoration: underline;
  }

  .btn-link:hover {
    color: #33dfff;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    table-layout: auto;
  }

  th {
    text-align: left;
    padding: 8px 10px;
    color: #888;
    font-weight: 600;
    border-bottom: 1px solid #2a2a4a;
    white-space: nowrap;
  }

  td {
    padding: 8px 10px;
    border-bottom: 1px solid #1a1a3a;
    color: #ccc;
    vertical-align: top;
  }

  .col-check {
    width: 32px;
    text-align: center;
    vertical-align: middle;
  }

  .col-reorder {
    width: 32px;
    text-align: center;
    vertical-align: middle;
    padding: 4px 2px;
  }

  .reorder-btns {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: center;
  }

  .reorder-btn {
    background: transparent;
    border: 1px solid #2a2a4a;
    color: #00d4ff;
    font-size: 0.6rem;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
    border-radius: 3px;
    width: 22px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reorder-btn:hover:not(:disabled) {
    background: #00d4ff22;
    border-color: #00d4ff;
  }

  .reorder-btn:disabled {
    color: #444;
    border-color: #1a1a3a;
    cursor: not-allowed;
    opacity: 0.5;
  }

  tr.user-moved > td {
    background: rgba(0, 212, 255, 0.10);
  }

  tr.user-moved > td:first-child {
    border-left: 3px solid #00d4ff;
  }

  tr.user-displaced > td {
    background: rgba(255, 179, 0, 0.05);
  }

  tr.user-displaced > td:first-child {
    border-left: 3px solid rgba(255, 179, 0, 0.35);
  }

  .col-arrow {
    width: 24px;
    text-align: center;
    color: #00d4ff;
    white-space: nowrap;
  }

  .col-wrap {
    word-break: break-all;
  }

  .col-fixed {
    white-space: nowrap;
    width: 1%;
  }

  .col-num {
    width: 40px;
    text-align: right;
    color: #666;
    white-space: nowrap;
  }

  tr.deselected td {
    opacity: 0.4;
  }

  input[type="checkbox"] {
    accent-color: #00d4ff;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .badge.high {
    background: #1b4332;
    color: #4caf50;
  }

  .badge.medium {
    background: #3a3000;
    color: #ffb300;
  }

  .badge.low {
    background: #4a1c1c;
    color: #ff4444;
  }

  .badge-wrap {
    position: relative;
    display: inline-block;
  }

  .badge[title] {
    cursor: pointer;
  }

  .badge:focus {
    outline: 1px solid #00d4ff;
    outline-offset: 2px;
  }

  .tooltip-popover {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: #1a1a3a;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 0.78rem;
    color: #ccc;
    white-space: pre;
    z-index: 100;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  .skipped-heading {
    font-size: 0.95rem;
    color: #888;
    margin: 20px 0 8px;
    font-weight: 600;
  }

  .count {
    font-weight: normal;
    font-size: 0.85rem;
  }

  .skipped-table td {
    color: #666;
  }

  .reason-unmatched {
    color: #ff4444;
    font-size: 0.8rem;
  }


  .col-dim {
    color: #888;
  }

  .season-divider td {
    padding: 12px 10px 6px;
    font-weight: 700;
    font-size: 0.9rem;
    color: #00d4ff;
    border-bottom: 2px solid #00d4ff33;
    background: #0d1a30;
  }

  .missing-episode td {
    color: #555;
    font-style: italic;
    border-bottom: 1px solid #1a1a3a;
  }

  .missing-label {
    color: #666;
  }

  .missing-badge {
    display: inline-block;
    background: #2a1a1a;
    color: #884444;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 8px;
    font-style: normal;
  }

  .dvd-missing-badge {
    display: inline-block;
    background: #1a1a2a;
    color: #666;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    font-style: italic;
  }

  .warning-banner {
    background: #3a3000;
    border: 1px solid #ffb300;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .warning-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .warning-icon {
    color: #ffb300;
    font-size: 1.2rem;
  }

  .warning-header strong {
    color: #ffb300;
    font-size: 0.95rem;
  }

  .dismiss-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid #ffb300;
    color: #ffb300;
    padding: 2px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .dismiss-btn:hover {
    background: #ffb30022;
  }

  .warning-list {
    margin: 0 0 8px 16px;
    padding: 0;
    list-style: disc;
    color: #ccc;
    font-size: 0.85rem;
  }

  .warning-list li {
    margin: 4px 0;
  }

  .warning-file {
    color: #ccc;
  }

  .warning-detail {
    color: #999;
    font-size: 0.8rem;
    font-style: italic;
    margin-top: 2px;
  }
</style>
