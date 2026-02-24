<script lang="ts">
  interface Props {
    matches: MatchResultData[];
    scanDirectory: string;
    onconfirm: (confirmed: MatchResultData[]) => void;
    oncancel: () => void;
  }

  let { matches, scanDirectory, onconfirm, oncancel }: Props = $props();

  function relativePath(filePath: string): string {
    if (!scanDirectory) return filePath;
    if (filePath.startsWith(scanDirectory)) {
      const rel = filePath.substring(scanDirectory.length);
      return rel.startsWith('/') || rel.startsWith('\\') ? rel.substring(1) : rel;
    }
    return filePath;
  }

  // Split matches into renameable and non-renameable
  let renameable = $derived(
    matches.filter((m) => m.status !== 'unmatched' && m.newFilename !== m.mediaFile.fileName),
  );
  let skipped = $derived(
    matches.filter((m) => m.status === 'unmatched' || m.newFilename === m.mediaFile.fileName),
  );

  // Track selected state per renameable match
  let selected = $state<boolean[]>([]);
  let openTooltipKey = $state<string | null>(null);

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
    | { type: 'matched'; match: MatchResultData; index: number }
    | { type: 'missing'; episode: MissingEpisode };

  interface RenameableGroup {
    label: string;
    rows: RenameableRow[];
    matchedCount: number;
    totalCount: number;
  }

  function toggleAll(checked: boolean) {
    selected = selected.map(() => checked);
  }

  function handleConfirm() {
    const confirmed = renameable.filter((_, i) => selected[i]);
    onconfirm(confirmed);
  }

  function confidenceClass(confidence: number): string {
    if (confidence >= 85) return 'high';
    if (confidence >= 60) return 'medium';
    return 'low';
  }

  function formatDuration(probeData?: { durationSeconds?: number }): string {
    if (!probeData?.durationSeconds) return '--';
    const totalSec = Math.round(probeData.durationSeconds);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatTmdbRuntime(runtime?: number | null): string {
    if (runtime == null) return '--';
    return `${runtime} min`;
  }

  function formatDvdCompareRuntime(match: MatchResultData): string {
    if (match.dvdCompareRuntimeSeconds != null) {
      return formatDuration({ durationSeconds: match.dvdCompareRuntimeSeconds });
    }
    return '--';
  }

  let hasDvdCompare = $derived(renameable.some((m) => m.dvdCompareUsed));

  function formatSize(sizeBytes: number): string {
    const gb = sizeBytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = sizeBytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
  }

  function confidenceTooltip(match: MatchResultData): string {
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

  let groupedRenameable = $derived.by(() => {
    // First pass: group items by season
    type IndexedItem = { match: MatchResultData; index: number };
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
      itemsByLabel.get(label)!.push({ match: m, index: i });
    }

    // Second pass: build interleaved rows per group
    const groups: RenameableGroup[] = [];

    for (const label of groupOrder) {
      const items = itemsByLabel.get(label)!;
      const matchedEpNums = new Set<number>();
      let seasonEpisodes: MissingEpisode[] | undefined;

      // Build episode→item lookup
      const epToItem = new Map<number, IndexedItem>();
      for (const item of items) {
        const tm = item.match.tmdbMatch;
        if (!tm) continue;
        if (!seasonEpisodes && tm.seasonEpisodes) seasonEpisodes = tm.seasonEpisodes;
        if (tm.episodeNumber !== undefined) {
          epToItem.set(tm.episodeNumber, item);
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

      if (seasonEpisodes) {
        totalCount = seasonEpisodes.length;
        matchedCount = matchedEpNums.size;
        rows = [];
        const usedItems = new Set<IndexedItem>();
        for (const ep of seasonEpisodes) {
          const matchItem = epToItem.get(ep.episodeNumber);
          if (matchItem) {
            rows.push({ type: 'matched', match: matchItem.match, index: matchItem.index });
            usedItems.add(matchItem);
          } else if (!matchedEpNums.has(ep.episodeNumber)) {
            rows.push({ type: 'missing', episode: ep });
          }
        }
        // Append any items not in the episode list (edge case)
        for (const item of items) {
          if (!usedItems.has(item)) {
            rows.push({ type: 'matched', match: item.match, index: item.index });
          }
        }
      } else {
        const firstTm = items[0]?.match.tmdbMatch;
        totalCount = firstTm?.seasonEpisodeCount ?? items.length;
        matchedCount = matchedEpNums.size || items.length;
        rows = items.map((item) => ({ type: 'matched' as const, match: item.match, index: item.index }));
      }

      groups.push({ label, rows, matchedCount, totalCount });
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
        <strong>Potential multi-episode files detected</strong>
        <button class="dismiss-btn" onclick={() => (showWarningBanner = false)}>Dismiss</button>
      </div>
      <ul class="warning-list">
        {#each warningFiles as wf}
          <li>{relativePath(wf.mediaFile.filePath)}</li>
        {/each}
      </ul>
      <p class="warning-note">
        These files have significantly longer runtime or larger file size than typical episodes
        in their group. They may be "Play All" tracks that concatenate multiple episodes.
        Review carefully before renaming.
      </p>
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
          <td colspan={hasDvdCompare ? 9 : 8}>
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
            <tr class:deselected={!selected[row.index]}>
              <td class="col-check">
                <input type="checkbox" bind:checked={selected[row.index]} />
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
              {#if match.status === 'unmatched'}
                <span class="reason-unmatched">unmatched</span>
              {:else}
                <span class="reason-unchanged">unchanged</span>
              {/if}
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

  .reason-unchanged {
    color: #888;
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
    margin: 2px 0;
  }

  .warning-note {
    margin: 0;
    color: #999;
    font-size: 0.8rem;
    font-style: italic;
  }
</style>
