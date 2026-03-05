<script lang="ts">
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
  // Maps season label → ordered array of indices into renameable[].
  // Only populated for seasons where user has reordered files.
  let fileOrder = $state<Map<string, number[]>>(new Map());
  // Maps season label → the original order (snapshot at first interaction)
  let originalOrder = $state<Map<string, number[]>>(new Map());
  // Files the user explicitly clicked to move (by filePath)
  let userMoved = $state<Set<string>>(new Set());
  // Reorder version counter — bumped on each reorder to trigger re-derivation
  let reorderVersion = $state(0);

  /**
   * Derive reorder status for each file:
   * - 'moved'     — user explicitly moved this file
   * - 'displaced' — bumped as a side effect of another move
   * - undefined   — still in original position
   */
  let reorderStatus = $derived.by(() => {
    void reorderVersion;
    const status = new Map<string, 'moved' | 'displaced'>();
    for (const [label, order] of fileOrder) {
      const orig = originalOrder.get(label);
      if (!orig) continue;
      for (let i = 0; i < order.length; i++) {
        if (order[i] !== orig[i]) {
          const filePath = renameable[order[i]].mediaFile.filePath;
          status.set(filePath, userMoved.has(filePath) ? 'moved' : 'displaced');
        }
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

  /** Move a file within a season group and update episode assignments */
  async function moveFile(seasonLabel: string, fromPos: number, toPos: number) {
    // Get or initialize the file order for this season
    let order = fileOrder.get(seasonLabel);
    if (!order) {
      // Initialize from current groupedRenameable
      const group = groupedRenameable.find((g) => g.label === seasonLabel);
      if (!group) return;
      order = group.rows
        .filter((r): r is RenameableRow & { type: 'matched' } => r.type === 'matched' && !r.isMultiEp)
        .map((r) => r.index);
      // Snapshot the original order for comparison
      originalOrder.set(seasonLabel, [...order]);
      originalOrder = new Map(originalOrder);
    }

    if (fromPos < 0 || fromPos >= order.length || toPos < 0 || toPos >= order.length) return;

    // Splice: remove from fromPos, insert at toPos
    const [moved] = order.splice(fromPos, 1);
    order.splice(toPos, 0, moved);

    // Track this file as explicitly moved by the user
    userMoved.add(renameable[moved].mediaFile.filePath);
    userMoved = new Set(userMoved);

    // Save updated order
    fileOrder.set(seasonLabel, [...order]);
    // Trigger re-derivation
    fileOrder = new Map(fileOrder);

    // Apply episode reassignment
    await applyReorder(seasonLabel, order);
  }

  /** Re-assign episode data to files based on the user's ordering */
  async function applyReorder(seasonLabel: string, order: number[]) {
    // Get the season's episode list from the first match
    const firstMatch = renameable[order[0]];
    const seasonEpisodes = firstMatch?.tmdbMatch?.seasonEpisodes;
    if (!seasonEpisodes) return;

    // Build list of available episode slots (excluding those consumed by multi-ep files)
    const multiEpNums = new Set<number>();
    for (const m of renameable) {
      if (isMultiEpisode(m) && m.tmdbMatch?.seasonNumber !== undefined) {
        const tm = m.tmdbMatch;
        const label = `Season ${tm.seasonNumber}`;
        if (label !== seasonLabel) continue;
        if (tm.episodeNumber !== undefined) multiEpNums.add(tm.episodeNumber);
        if (tm.episodeNumberEnd !== undefined) {
          for (let ep = tm.episodeNumber; ep <= tm.episodeNumberEnd; ep++) {
            multiEpNums.add(ep);
          }
        }
      }
    }

    const availableEpisodes = seasonEpisodes.filter((ep) => !multiEpNums.has(ep.episodeNumber));

    // Zip: file[i] → episode[i]
    const itemsToRegenerate: Array<{ idx: number; tmdbMatch: MatchResultData['tmdbMatch']; extension: string }> = [];

    for (let i = 0; i < order.length && i < availableEpisodes.length; i++) {
      const matchIdx = order[i];
      const m = renameable[matchIdx];
      const ep = availableEpisodes[i];
      if (!m.tmdbMatch) continue;

      // Update episode assignment
      m.tmdbMatch.episodeNumber = ep.episodeNumber;
      m.tmdbMatch.episodeTitle = ep.episodeName;
      m.tmdbMatch.runtime = ep.runtime ?? undefined;
      if (m.parsed.episodeNumbers) {
        m.parsed.episodeNumbers = [ep.episodeNumber];
      }

      itemsToRegenerate.push({
        idx: matchIdx,
        tmdbMatch: { ...m.tmdbMatch },
        extension: m.mediaFile.extension,
      });
    }

    // Regenerate filenames via IPC
    if (itemsToRegenerate.length > 0) {
      try {
        const newFilenames = await window.api.regenerateFilenames(
          itemsToRegenerate.map((item) => ({
            tmdbMatch: item.tmdbMatch as Record<string, unknown>,
            extension: item.extension,
          })),
        );
        for (let i = 0; i < itemsToRegenerate.length; i++) {
          renameable[itemsToRegenerate[i].idx].newFilename = newFilenames[i];
        }
      } catch {
        // Filename regeneration failed — episode data is already updated,
        // filename will be stale but the confirm response carries tmdbMatch
      }
    }

    // Bump version to trigger UI re-derivation
    reorderVersion++;
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

      // Check if user has a custom file order for this season
      const customOrder = fileOrder.get(label);

      if (seasonEpisodes) {
        totalCount = seasonEpisodes.length;
        matchedCount = matchedEpNums.size;
        rows = [];

        if (customOrder) {
          // User has reordered: build rows from custom order
          // First, add multi-ep files in their episode positions
          const multiEpItems = items.filter((item) => item.isMultiEp);
          const multiEpByEp = new Map<number, IndexedItem>();
          for (const item of multiEpItems) {
            const tm = item.match.tmdbMatch;
            if (tm?.episodeNumber !== undefined) {
              multiEpByEp.set(tm.episodeNumber, item);
            }
          }

          // Walk episode list, placing multi-ep files at their positions
          // and single-ep files from the custom order
          let singleIdx = 0;
          for (const ep of seasonEpisodes) {
            const multiItem = multiEpByEp.get(ep.episodeNumber);
            if (multiItem) {
              rows.push({ type: 'matched', match: multiItem.match, index: multiItem.index, isMultiEp: true, filePos: -1 });
              continue;
            }
            // Skip episodes consumed by multi-ep ranges
            if (matchedEpNums.has(ep.episodeNumber) && !customOrder.some((idx) => {
              const m = renameable[idx];
              return m.tmdbMatch?.episodeNumber === ep.episodeNumber;
            })) {
              continue; // Consumed by a multi-ep file
            }
            // Place next single-ep file from custom order
            if (singleIdx < customOrder.length) {
              const matchIdx = customOrder[singleIdx];
              const m = renameable[matchIdx];
              rows.push({ type: 'matched', match: m, index: matchIdx, isMultiEp: false, filePos: singleIdx });
              singleIdx++;
              movableCount++;
            } else if (!matchedEpNums.has(ep.episodeNumber)) {
              rows.push({ type: 'missing', episode: ep });
            }
          }
        } else {
          // Default: walk full episode list in order, interleaving matched and missing
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
      {#each groupedRenameable as group}
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
                {#if !row.isMultiEp && group.movableCount > 1}
                  <div class="reorder-btns">
                    <button
                      class="reorder-btn"
                      disabled={row.filePos <= 0}
                      onclick={() => moveFile(group.label, row.filePos, row.filePos - 1)}
                      title="Move file up"
                    >&#9650;</button>
                    <button
                      class="reorder-btn"
                      disabled={row.filePos >= group.movableCount - 1}
                      onclick={() => moveFile(group.label, row.filePos, row.filePos + 1)}
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
    background: rgba(0, 212, 255, 0.08);
  }

  tr.user-moved > td:first-child {
    border-left: 3px solid #00d4ff;
  }

  tr.user-displaced > td {
    background: rgba(255, 179, 0, 0.06);
  }

  tr.user-displaced > td:first-child {
    border-left: 3px solid #ffb30066;
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
