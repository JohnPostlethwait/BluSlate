<script lang="ts">
  interface Props {
    showName: string;
    candidates: ShowCandidate[];
    onselect: (selected: ShowCandidate | null) => void;
    oncancel: () => void;
  }

  let { showName, candidates, onselect, oncancel }: Props = $props();

  let selected = $state<ShowCandidate | null>(null);

  function posterUrl(path: string | null): string | null {
    if (!path) return null;
    return `https://image.tmdb.org/t/p/w154${path}`;
  }

  function formatYear(date: string): string {
    if (!date) return 'Unknown';
    return date.substring(0, 4);
  }

</script>

<div class="show-selector">
  <h2>Identify Show</h2>
  <p class="subtitle">
    Select the correct show for: <strong>{showName}</strong>
  </p>

  <div class="candidates">
    {#each candidates as candidate}
      <button
        class="candidate-card"
        class:selected={selected?.id === candidate.id}
        onclick={() => (selected = candidate)}
      >
        <div class="poster">
          {#if posterUrl(candidate.poster_path)}
            <img src={posterUrl(candidate.poster_path)} alt={candidate.name} />
          {:else}
            <div class="no-poster">No Image</div>
          {/if}
        </div>
        <div class="info">
          <h3>{candidate.name}</h3>
          {#if candidate.original_name && candidate.original_name !== candidate.name}
            <p class="original-name">{candidate.original_name}</p>
          {/if}
          <p class="meta">
            {formatYear(candidate.first_air_date)}
            {#if candidate.origin_country?.length > 0}
              &middot; {candidate.origin_country.join(', ')}
            {/if}
            {#if candidate.vote_average > 0}
              &middot; ★ {candidate.vote_average.toFixed(1)}
            {/if}
          </p>
          {#if candidate.overview}
            <p class="overview">{candidate.overview}</p>
          {/if}
        </div>
      </button>
    {/each}
  </div>

  <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
    <button
      style="background: transparent; border: 1px solid #555; color: #aaa; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;"
      onclick={() => oncancel()}
    >Cancel</button>
    <button
      style="background: {selected === null ? '#00d4ff66' : '#00d4ff'}; border: none; color: #0a0a1a; padding: 10px 24px; border-radius: 8px; cursor: {selected === null ? 'not-allowed' : 'pointer'}; font-size: 0.9rem; font-weight: 600;"
      onclick={() => onselect(selected)}
      disabled={selected === null}
    >Use Selected</button>
  </div>
</div>

<style>
  .show-selector {
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
    margin: 0 0 20px;
  }

  .subtitle strong {
    color: #00d4ff;
  }

  .candidates {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 450px;
    overflow-y: auto;
  }

  .candidate-card {
    display: flex;
    gap: 16px;
    padding: 12px;
    background: #1a1a3a;
    border: 2px solid #2a2a4a;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    transition: border-color 0.15s;
  }

  .candidate-card:hover {
    border-color: #444;
  }

  .candidate-card.selected {
    border-color: #00d4ff;
    background: #1a2a4a;
  }

  .poster {
    flex-shrink: 0;
    width: 77px;
    height: 115px;
    border-radius: 6px;
    overflow: hidden;
    background: #111;
  }

  .poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .no-poster {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    font-size: 0.75rem;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .info h3 {
    margin: 0 0 4px;
    font-size: 1rem;
    color: #e0e0e0;
  }

  .original-name {
    color: #666;
    font-size: 0.8rem;
    margin: 0 0 4px;
    font-style: italic;
  }

  .meta {
    color: #888;
    font-size: 0.8rem;
    margin: 0 0 8px;
  }

  .overview {
    color: #999;
    font-size: 0.8rem;
    margin: 0;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

</style>
