<script lang="ts">
  interface Props {
    matches: MatchResultData[];
    onconfirm: (confirmed: MatchResultData[]) => void;
    oncancel: () => void;
  }

  let { matches, onconfirm, oncancel }: Props = $props();

  // Track selected state per match — initialized from matches length
  let selected = $state<boolean[]>([]);

  // Reset selections when matches change
  $effect(() => {
    selected = Array.from({ length: matches.length }, () => true);
  });

  let selectedCount = $derived(selected.filter(Boolean).length);

  function toggleAll(checked: boolean) {
    selected = selected.map(() => checked);
  }

  function handleConfirm() {
    const confirmed = matches.filter((_, i) => selected[i]);
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
    {selectedCount} of {matches.length} files selected for renaming
  </p>

  <div class="toolbar">
    <button class="btn-link" onclick={() => toggleAll(true)}>Select All</button>
    <button class="btn-link" onclick={() => toggleAll(false)}>Deselect All</button>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-check"></th>
          <th class="col-original">Original</th>
          <th class="col-arrow"></th>
          <th class="col-new">New Name</th>
          <th class="col-confidence">Conf.</th>
        </tr>
      </thead>
      <tbody>
        {#each matches as match, i}
          <tr class:deselected={!selected[i]}>
            <td class="col-check">
              <input type="checkbox" bind:checked={selected[i]} />
            </td>
            <td class="col-original" title={match.mediaFile.filePath}>
              {match.mediaFile.fileName}
            </td>
            <td class="col-arrow">→</td>
            <td class="col-new">{match.newFilename}</td>
            <td class="col-confidence">
              <span class="badge {confidenceClass(match.confidence)}">{match.confidence}%</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="actions">
    <button class="btn-cancel" onclick={oncancel}>Cancel</button>
    <button class="btn-confirm" onclick={handleConfirm} disabled={selectedCount === 0}>
      Rename {selectedCount} File{selectedCount !== 1 ? 's' : ''}
    </button>
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

  .table-wrap {
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
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
    position: sticky;
    top: 0;
    background: #16213e;
  }

  td {
    padding: 8px 10px;
    border-bottom: 1px solid #1a1a3a;
    color: #ccc;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-check {
    width: 32px;
    text-align: center;
  }

  .col-arrow {
    width: 24px;
    text-align: center;
    color: #00d4ff;
  }

  .col-confidence {
    width: 60px;
    text-align: center;
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

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 20px;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    padding: 10px 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-cancel:hover {
    border-color: #888;
    color: #ccc;
  }

  .btn-confirm {
    background: #00d4ff;
    border: none;
    color: #0a0a1a;
    padding: 10px 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .btn-confirm:hover:not(:disabled) {
    background: #33dfff;
  }

  .btn-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
