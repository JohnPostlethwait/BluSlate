<script lang="ts">
  interface Props {
    matches: MatchResultData[];
    scanDirectory: string;
  }

  let { matches, scanDirectory }: Props = $props();

  let matched = $derived(matches.filter((m) => m.status !== 'unmatched'));
  let unmatched = $derived(matches.filter((m) => m.status === 'unmatched'));

  function relativePath(filePath: string): string {
    if (!scanDirectory) return filePath;
    // Simple relative path: remove scanDirectory prefix
    if (filePath.startsWith(scanDirectory)) {
      const rel = filePath.substring(scanDirectory.length);
      return rel.startsWith('/') || rel.startsWith('\\') ? rel.substring(1) : rel;
    }
    return filePath;
  }

  function confidenceClass(confidence: number): string {
    if (confidence >= 85) return 'high';
    if (confidence >= 60) return 'medium';
    return 'low';
  }

  function formatRuntime(probeData?: { durationMinutes?: number }): string {
    if (!probeData?.durationMinutes) return '--';
    const m = probeData.durationMinutes;
    const h = Math.floor(m / 60);
    const min = Math.round(m % 60);
    if (h > 0) return `${h}h${String(min).padStart(2, '0')}m`;
    return `${min}min`;
  }
</script>

<div class="results">
  {#if matched.length > 0}
    <h2>Rename Plan <span class="count">({matched.length} files)</span></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th class="col-original">Original</th>
            <th class="col-new">New Name</th>
            <th class="col-runtime">Runtime</th>
            <th class="col-confidence">Conf.</th>
            <th class="col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each matched as match, i}
            <tr>
              <td class="col-num">{i + 1}</td>
              <td class="col-original" title={match.mediaFile.filePath}>
                {relativePath(match.mediaFile.filePath)}
              </td>
              <td class="col-new">{match.newFilename}</td>
              <td class="col-runtime">{formatRuntime(match.probeData)}</td>
              <td class="col-confidence">
                <span class="badge {confidenceClass(match.confidence)}">{match.confidence}%</span>
              </td>
              <td class="col-status">
                <span class="status-{match.status}">{match.status}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if unmatched.length > 0}
    <h2 class="unmatched-heading">Unmatched <span class="count">({unmatched.length} files)</span></h2>
    <div class="table-wrap">
      <table class="unmatched-table">
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th>File</th>
            <th class="col-runtime">Runtime</th>
          </tr>
        </thead>
        <tbody>
          {#each unmatched as match, i}
            <tr>
              <td class="col-num">{i + 1}</td>
              <td title={match.mediaFile.filePath}>{relativePath(match.mediaFile.filePath)}</td>
              <td class="col-runtime">{formatRuntime(match.probeData)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
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
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-num {
    width: 40px;
    text-align: right;
    color: #666;
  }

  .col-runtime {
    width: 70px;
    color: #888;
  }

  .col-confidence {
    width: 60px;
    text-align: center;
  }

  .col-status {
    width: 80px;
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
</style>
