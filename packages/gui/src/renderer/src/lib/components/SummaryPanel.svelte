<script lang="ts">
  import ResultsTable from './ResultsTable.svelte';

  interface Props {
    renamed: number;
    skipped: number;
    failed: number;
    dryRun: boolean;
    matches?: MatchResultData[];
    scanDirectory?: string;
    onreset: () => void;
  }

  let { renamed, skipped, failed, dryRun, matches = [], scanDirectory = '', onreset }: Props = $props();

  let total = $derived(renamed + skipped + failed);
  let undoState = $state<'idle' | 'confirming' | 'working' | 'done' | 'error'>('idle');
  let undoResult = $state<{ restored: number; failed: number } | null>(null);

  async function executeUndo() {
    undoState = 'working';
    try {
      undoResult = await window.api.undoRenames(scanDirectory);
      undoState = 'done';
    } catch {
      undoState = 'error';
    }
  }
</script>

<div class="summary-panel">
  {#if dryRun}
    <div class="dry-run-badge">DRY RUN</div>
  {/if}

  <h2>{dryRun ? 'Dry Run Complete' : 'Renaming Complete'}</h2>

  <div class="stats">
    <div class="stat success">
      <span class="stat-value">{renamed}</span>
      <span class="stat-label">{dryRun ? 'Would Rename' : 'Renamed'}</span>
    </div>
    <div class="stat skipped">
      <span class="stat-value">{skipped}</span>
      <span class="stat-label">Skipped</span>
    </div>
    <div class="stat failed">
      <span class="stat-value">{failed}</span>
      <span class="stat-label">Failed</span>
    </div>
  </div>

  {#if total > 0}
    <div class="bar">
      {#if renamed > 0}
        <div class="bar-segment bar-success" style="width: {(renamed / total) * 100}%"></div>
      {/if}
      {#if skipped > 0}
        <div class="bar-segment bar-skipped" style="width: {(skipped / total) * 100}%"></div>
      {/if}
      {#if failed > 0}
        <div class="bar-segment bar-failed" style="width: {(failed / total) * 100}%"></div>
      {/if}
    </div>
  {/if}

  {#if matches.length > 0}
    <div class="results-section">
      <ResultsTable {matches} {scanDirectory} />
    </div>
  {/if}

  {#if dryRun}
    <p class="note">No files were actually renamed. Run again without "Dry Run" to apply changes.</p>
  {/if}

  {#if !dryRun && renamed > 0 && undoState !== 'idle'}
    <div class="undo-section">
      {#if undoState === 'confirming'}
        <p class="undo-confirm-text">Are you sure? This will restore all original filenames.</p>
        <div class="undo-confirm-btns">
          <button class="btn-undo-confirm" onclick={executeUndo}>Yes, Undo Renames</button>
          <button class="btn-undo-cancel" onclick={() => (undoState = 'idle')}>Cancel</button>
        </div>
      {:else if undoState === 'working'}
        <p class="undo-working">Restoring original filenames...</p>
      {:else if undoState === 'done' && undoResult}
        <p class="undo-done">
          Restored {undoResult.restored} file{undoResult.restored !== 1 ? 's' : ''}
          {#if undoResult.failed > 0}
            &middot; {undoResult.failed} failed
          {/if}
        </p>
      {:else if undoState === 'error'}
        <p class="undo-error">Failed to undo renames. The log file may be missing or unreadable.</p>
      {/if}
    </div>
  {/if}

  <div class="actions">
    {#if !dryRun && renamed > 0 && undoState === 'idle'}
      <button class="btn-undo" onclick={() => (undoState = 'confirming')}>Undo Renames</button>
    {/if}
    <button class="btn-start-new" onclick={onreset}>Start New Scan</button>
  </div>
</div>

<style>
  .summary-panel {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    padding: 32px;
    text-align: center;
  }

  .dry-run-badge {
    display: inline-block;
    background: #3a3000;
    color: #ffb300;
    padding: 4px 16px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    margin-bottom: 16px;
  }

  h2 {
    font-size: 1.4rem;
    color: #e0e0e0;
    margin: 0 0 24px;
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 48px;
    margin-bottom: 24px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-value {
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1;
  }

  .stat-label {
    font-size: 0.85rem;
    color: #888;
  }

  .stat.success .stat-value {
    color: #4caf50;
  }

  .stat.skipped .stat-value {
    color: #ffb300;
  }

  .stat.failed .stat-value {
    color: #ff4444;
  }

  .bar {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: #1a1a3a;
    margin-bottom: 24px;
  }

  .bar-segment {
    transition: width 0.3s ease;
  }

  .bar-success {
    background: #4caf50;
  }

  .bar-skipped {
    background: #ffb300;
  }

  .bar-failed {
    background: #ff4444;
  }

  .results-section {
    margin-bottom: 24px;
    text-align: left;
  }

  .note {
    color: #888;
    font-size: 0.9rem;
    margin: 0 0 24px;
  }

  .actions {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 20px;
  }

  .btn-start-new {
    background: #00d4ff;
    border: none;
    color: #0a0a1a;
    padding: 12px 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
  }

  .btn-start-new:hover {
    opacity: 0.9;
  }

  .btn-undo {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    padding: 12px 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-undo:hover {
    border-color: #888;
    color: #ccc;
  }

  .undo-section {
    margin-top: 16px;
    padding: 16px;
    background: #0d1a30;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    text-align: center;
  }

  .undo-confirm-text {
    color: #ffb300;
    font-size: 0.9rem;
    margin: 0 0 12px;
  }

  .undo-confirm-btns {
    display: flex;
    justify-content: center;
    gap: 12px;
  }

  .btn-undo-confirm {
    background: #ff4444;
    border: none;
    color: #fff;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .btn-undo-confirm:hover {
    opacity: 0.9;
  }

  .btn-undo-cancel {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .btn-undo-cancel:hover {
    border-color: #888;
    color: #ccc;
  }

  .undo-working {
    color: #00d4ff;
    font-size: 0.9rem;
    margin: 0;
  }

  .undo-done {
    color: #4caf50;
    font-size: 0.9rem;
    margin: 0;
  }

  .undo-error {
    color: #ff4444;
    font-size: 0.9rem;
    margin: 0;
  }

</style>
