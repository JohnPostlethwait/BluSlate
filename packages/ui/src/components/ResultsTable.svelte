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
  }

  let { matches, scanDirectory }: Props = $props();

  let matched = $derived(matches.filter((m) => m.status !== 'unmatched'));
  let unmatched = $derived(matches.filter((m) => m.status === 'unmatched'));

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

  function relativePath(filePath: string): string {
    return relPath(filePath, scanDirectory);
  }

  interface MissingEpisode {
    episodeNumber: number;
    episodeName: string;
    runtime: number | null;
  }

  type SeasonRow =
    | { type: 'matched'; match: MatchResultData }
    | { type: 'missing'; episode: MissingEpisode };

  interface SeasonGroup {
    label: string;
    rows: SeasonRow[];
    matchedCount: number;
    totalCount: number;
  }

  /** Check if DVDCompare data was available for any result in the current view */
  let hasDvdCompare = $derived(matched.some((m) => m.dvdCompareUsed));

  let groupedMatched = $derived.by(() => {
    // First pass: group matched items by season
    const itemsByLabel = new Map<string, MatchResultData[]>();
    const groupOrder: string[] = [];

    for (const m of matched) {
      const tm = m.tmdbMatch;
      const label = tm?.seasonNumber !== undefined ? `Season ${tm.seasonNumber}` : 'Other';
      if (!itemsByLabel.has(label)) {
        itemsByLabel.set(label, []);
        groupOrder.push(label);
      }
      itemsByLabel.get(label)!.push(m);
    }

    // Second pass: build interleaved rows per group
    const groups: SeasonGroup[] = [];

    for (const label of groupOrder) {
      const items = itemsByLabel.get(label)!;
      const matchedEpNums = new Set<number>();
      let seasonEpisodes: MissingEpisode[] | undefined;

      // Build episode→match lookup
      const epToMatch = new Map<number, MatchResultData>();
      for (const m of items) {
        const tm = m.tmdbMatch;
        if (!tm) continue;
        if (!seasonEpisodes && tm.seasonEpisodes) seasonEpisodes = tm.seasonEpisodes;
        if (tm.episodeNumber !== undefined) {
          epToMatch.set(tm.episodeNumber, m);
          matchedEpNums.add(tm.episodeNumber);
          if (tm.episodeNumberEnd !== undefined) {
            for (let ep = tm.episodeNumber + 1; ep <= tm.episodeNumberEnd; ep++) {
              matchedEpNums.add(ep);
            }
          }
        }
      }

      let rows: SeasonRow[];
      let totalCount: number;
      let matchedCount: number;

      if (seasonEpisodes) {
        totalCount = seasonEpisodes.length;
        matchedCount = matchedEpNums.size;
        // Walk full episode list in order, interleaving matched and missing
        rows = [];
        const usedMatches = new Set<MatchResultData>();
        for (const ep of seasonEpisodes) {
          const matchItem = epToMatch.get(ep.episodeNumber);
          if (matchItem) {
            rows.push({ type: 'matched', match: matchItem });
            usedMatches.add(matchItem);
          } else if (!matchedEpNums.has(ep.episodeNumber)) {
            rows.push({ type: 'missing', episode: ep });
          }
        }
        // Append any matched items not in the episode list (edge case)
        for (const m of items) {
          if (!usedMatches.has(m)) {
            rows.push({ type: 'matched', match: m });
          }
        }
      } else {
        const firstTm = items[0]?.tmdbMatch;
        totalCount = firstTm?.seasonEpisodeCount ?? items.length;
        matchedCount = matchedEpNums.size || items.length;
        rows = items.map((m) => ({ type: 'matched' as const, match: m }));
      }

      groups.push({ label, rows, matchedCount, totalCount });
    }

    return groups;
  });
</script>

<svelte:window onclick={handleWindowClick} />

<div class="results">
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

  {#if matched.length > 0}
    <h2>Rename Plan <span class="count">({matched.length} files)</span></h2>

    <table>
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th>Original</th>
          <th class="col-fixed">Size</th>
          <th class="col-fixed">Runtime</th>
          <th class="col-arrow"></th>
          <th class="col-fixed">TMDb</th>
          {#if hasDvdCompare}
            <th class="col-fixed"><a href="https://www.dvdcompare.net" target="_blank" class="th-link">DVDCompare</a></th>
          {/if}
          <th>Episode</th>
          <th class="col-fixed">Confidence</th>
          <th class="col-fixed">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each groupedMatched as group}
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
              <tr>
                <td class="col-num">{i + 1}</td>
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
                <td class="col-fixed">
                  <span class="status-{row.match.status}">{row.match.status}</span>
                </td>
              </tr>
            {:else}
              <tr class="missing-episode">
                <td class="col-num">--</td>
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
                <td class="col-fixed"><span class="status-missing">missing</span></td>
              </tr>
            {/if}
          {/each}
        {/each}
      </tbody>
    </table>
  {/if}

  {#if unmatched.length > 0}
    <h2 class="unmatched-heading">Unmatched <span class="count">({unmatched.length} files)</span></h2>
    <table class="unmatched-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th>File</th>
          <th class="col-fixed">Size</th>
          <th class="col-fixed">Runtime</th>
        </tr>
      </thead>
      <tbody>
        {#each unmatched as match, i}
          <tr>
            <td class="col-num">{i + 1}</td>
            <td class="col-wrap">{relativePath(match.mediaFile.filePath)}</td>
            <td class="col-fixed col-dim">{formatSize(match.mediaFile.sizeBytes)}</td>
            <td class="col-fixed col-dim">{formatDuration(match.probeData)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .results {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    padding: 24px;
  }

  h2 {
    font-size: 1.1rem;
    color: #e0e0e0;
    margin: 0 0 12px;
  }

  .count {
    color: #888;
    font-weight: normal;
    font-size: 0.9rem;
  }

  .unmatched-heading {
    margin-top: 24px;
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

  .col-num {
    width: 40px;
    text-align: right;
    color: #666;
    white-space: nowrap;
  }

  .col-wrap {
    word-break: break-all;
  }

  .col-fixed {
    white-space: nowrap;
    width: 1%;
  }

  .col-arrow {
    width: 24px;
    text-align: center;
    color: #00d4ff;
    white-space: nowrap;
  }

  .col-dim {
    color: #888;
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

  .status-matched {
    color: #4caf50;
  }

  .status-ambiguous {
    color: #ffb300;
  }

  .status-unmatched {
    color: #ff4444;
  }

  .unmatched-table td {
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

  .th-link {
    color: #888;
    text-decoration: none;
  }

  .th-link:hover {
    color: #00d4ff;
    text-decoration: underline;
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

  .status-missing {
    color: #555;
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
