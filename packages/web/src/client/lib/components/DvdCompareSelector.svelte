<script lang="ts">
  interface Props {
    showName: string;
    candidates: DvdCompareCandidate[];
    onselect: (selected: DvdCompareCandidate[]) => void;
    oncancel: () => void;
  }

  let { showName, candidates, onselect, oncancel }: Props = $props();

  // Track checked state per candidate (checkboxes for multi-select)
  let checked = $state<boolean[]>([]);

  // Reset checked array when candidates change
  $effect(() => {
    checked = candidates.map(() => false);
  });

  let selectedCount = $derived(checked.filter(Boolean).length);

  function toggleAll(value: boolean) {
    checked = checked.map(() => value);
  }

  function handleConfirm() {
    const selected = candidates.filter((_, i) => checked[i]);
    onselect(selected);
  }

  function formatType(candidate: DvdCompareCandidate): string {
    return candidate.isBluray ? 'Blu-ray' : 'DVD';
  }
</script>

<div class="dvdcompare-selector">
  <h2><a href="https://www.dvdcompare.net" target="_blank" class="dvdcompare-link">DVDCompare</a> Disc Selection</h2>
  <p class="subtitle">
    Select disc releases for runtime matching: <strong>{showName}</strong>
  </p>
  <p class="description">
    DVDCompare provides to-the-second episode runtimes for definitive episode identification.
    Select one or more Blu-ray or DVD releases that cover your disc rips, or skip to use TMDb runtimes only.
    <a href="https://www.dvdcompare.net" target="_blank" class="dvdcompare-link">DVDCompare.net</a> is a volunteer-maintained resource — entries are often listed per season, so select all that apply.
  </p>

  <div class="toolbar">
    <button class="btn-link" onclick={() => toggleAll(true)}>Select All</button>
    <button class="btn-link" onclick={() => toggleAll(false)}>Deselect All</button>
    <span class="selection-count">{selectedCount} of {candidates.length} selected</span>
  </div>

  <div class="candidates">
    {#each candidates as candidate, i}
      <label class="candidate-card" class:selected={checked[i]}>
        <input type="checkbox" bind:checked={checked[i]} />
        <div class="disc-icon">
          {#if candidate.isBluray}
            <span class="disc-badge bluray">BD</span>
          {:else}
            <span class="disc-badge dvd">DVD</span>
          {/if}
        </div>
        <div class="info">
          <h3>{candidate.title}</h3>
          <p class="meta">
            {#if candidate.years}
              {candidate.years}
            {/if}
            &middot; {formatType(candidate)}
          </p>
          {#if candidate.episodeCount === 0}
            <p class="no-runtimes-warning">No episode runtimes available</p>
          {/if}
        </div>
      </label>
    {/each}
  </div>

  <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
    <button
      class="btn-skip"
      onclick={() => onselect([])}
    >Skip DVDCompare</button>
    <button
      class="btn-cancel"
      onclick={() => oncancel()}
    >Cancel</button>
    <button
      class="btn-confirm"
      class:disabled={selectedCount === 0}
      onclick={handleConfirm}
      disabled={selectedCount === 0}
    >Use Selected ({selectedCount})</button>
  </div>
</div>

<style>
  .dvdcompare-selector {
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
    margin: 0 0 8px;
  }

  .subtitle strong {
    color: #00d4ff;
  }

  .description {
    color: #666;
    font-size: 0.8rem;
    margin: 0 0 16px;
    line-height: 1.4;
  }

  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
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

  .selection-count {
    color: #888;
    font-size: 0.8rem;
    margin-left: auto;
  }

  .candidates {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 400px;
    overflow-y: auto;
  }

  .candidate-card {
    display: flex;
    gap: 14px;
    padding: 12px 14px;
    background: #1a1a3a;
    border: 2px solid #2a2a4a;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    transition: border-color 0.15s;
    align-items: center;
  }

  .candidate-card:hover {
    border-color: #444;
  }

  .candidate-card.selected {
    border-color: #00d4ff;
    background: #1a2a4a;
  }

  .candidate-card input[type="checkbox"] {
    accent-color: #00d4ff;
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .disc-icon {
    flex-shrink: 0;
  }

  .disc-badge {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }

  .disc-badge.bluray {
    background: #1a3a6a;
    color: #5599ff;
  }

  .disc-badge.dvd {
    background: #3a2a1a;
    color: #cc8844;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .info h3 {
    margin: 0 0 4px;
    font-size: 0.95rem;
    color: #e0e0e0;
  }

  .meta {
    color: #888;
    font-size: 0.8rem;
    margin: 0;
  }

  .no-runtimes-warning {
    color: #cc4444;
    font-size: 0.75rem;
    margin: 4px 0 0;
  }

  .btn-skip {
    background: transparent;
    border: 1px solid #555;
    color: #888;
    padding: 10px 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-skip:hover {
    color: #aaa;
    border-color: #777;
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

  .btn-confirm.disabled {
    background: #00d4ff66;
    cursor: not-allowed;
  }

  .dvdcompare-link {
    color: #00d4ff;
    text-decoration: none;
  }

  .dvdcompare-link:hover {
    text-decoration: underline;
  }
</style>
