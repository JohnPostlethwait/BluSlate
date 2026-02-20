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

  // Reset selections when renameable list changes
  $effect(() => {
    selected = Array.from({ length: renameable.length }, () => true);
  });

  let selectedCount = $derived(selected.filter(Boolean).length);

  // Compute per-show/season episode stats
  interface SeasonStat { matchedCount: number; totalCount: number }
  let seasonStats = $derived.by(() => {
    const stats = new Map<string, SeasonStat>();
    for (const m of renameable) {
      const tm = m.tmdbMatch;
      if (!tm || tm.seasonNumber === undefined || !tm.seasonEpisodeCount) continue;
      const key = `${tm.name} S${String(tm.seasonNumber).padStart(2, '0')}`;
      const existing = stats.get(key);
      if (existing) {
        existing.matchedCount++;
      } else {
        stats.set(key, { matchedCount: 1, totalCount: tm.seasonEpisodeCount });
      }
    }
    return stats;
  });

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
</script>

<div class="confirm-dialog">
  <h2>Review Rename Plan</h2>
  <p class="subtitle">
    {selectedCount} of {renameable.length} files selected for renaming
    {#if skipped.length > 0}
      &middot; {skipped.length} skipped
    {/if}
  </p>

  {#if seasonStats.size > 0}
    <div class="season-stats">
      {#each [...seasonStats] as [label, stat]}
        <span class="stat-chip" class:stat-complete={stat.matchedCount === stat.totalCount} class:stat-partial={stat.matchedCount !== stat.totalCount}>
          {label}: {stat.matchedCount}/{stat.totalCount} episodes
        </span>
      {/each}
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
        <th class="col-arrow"></th>
        <th>New Name</th>
        <th class="col-fixed">Conf.</th>
      </tr>
    </thead>
    <tbody>
      {#each renameable as match, i}
        <tr class:deselected={!selected[i]}>
          <td class="col-check">
            <input type="checkbox" bind:checked={selected[i]} />
          </td>
          <td class="col-wrap">{relativePath(match.mediaFile.filePath)}</td>
          <td class="col-arrow">&rarr;</td>
          <td class="col-wrap">{match.newFilename}</td>
          <td class="col-fixed">
            <span class="badge {confidenceClass(match.confidence)}">{match.confidence}%</span>
          </td>
        </tr>
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
          <th class="col-fixed">Reason</th>
        </tr>
      </thead>
      <tbody>
        {#each skipped as match, i}
          <tr>
            <td class="col-num">{i + 1}</td>
            <td class="col-wrap">{relativePath(match.mediaFile.filePath)}</td>
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

  .season-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }

  .stat-chip {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .stat-complete {
    background: #1b4332;
    color: #4caf50;
  }

  .stat-partial {
    background: #3a3000;
    color: #ffb300;
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
</style>
