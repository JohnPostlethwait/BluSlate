<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    onselect: (path: string) => void;
    oncancel: () => void;
  }

  let { onselect, oncancel }: Props = $props();

  interface BrowseEntry {
    name: string;
    type: 'directory' | 'file';
    size?: number;
    mediaCount?: number;
  }

  let currentPath = $state('');
  let mediaRoot = $state('');
  let entries = $state<BrowseEntry[]>([]);
  let loading = $state(true);
  let error = $state('');

  onMount(() => {
    browse();
  });

  async function browse(path?: string) {
    loading = true;
    error = '';
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to browse directory');
      }
      const data = await res.json();
      currentPath = data.path;
      mediaRoot = data.mediaRoot;
      entries = data.entries;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function navigateUp() {
    if (currentPath === mediaRoot) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
    browse(parent || mediaRoot);
  }

  function navigateInto(name: string) {
    browse(currentPath + '/' + name);
  }

  function selectCurrent() {
    onselect(currentPath);
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
  }

  let isAtRoot = $derived(currentPath === mediaRoot);
  let displayPath = $derived(
    currentPath === mediaRoot ? '/' : currentPath.substring(mediaRoot.length) || '/',
  );
  let directoryCount = $derived(entries.filter((e) => e.type === 'directory').length);
  let fileCount = $derived(entries.filter((e) => e.type === 'file').length);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={(e) => e.key === 'Escape' && oncancel()}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={oncancel}></div>
  <div class="modal">
    <div class="header">
      <h2>Select Directory</h2>
      <p class="path-display">{displayPath}</p>
    </div>

    <div class="toolbar">
      <button class="btn-nav" onclick={navigateUp} disabled={isAtRoot} title="Go up">
        &#8593; Up
      </button>
      <span class="entry-count">
        {directoryCount} folder{directoryCount !== 1 ? 's' : ''}
        {#if fileCount > 0}
          &middot; {fileCount} media file{fileCount !== 1 ? 's' : ''}
        {/if}
      </span>
    </div>

    {#if loading}
      <div class="loading">Loading...</div>
    {:else if error}
      <div class="error-msg">{error}</div>
    {:else}
      <div class="entries">
        {#each entries as entry}
          {#if entry.type === 'directory'}
            <button class="entry entry-dir" ondblclick={() => navigateInto(entry.name)} onclick={() => navigateInto(entry.name)}>
              <span class="icon">&#128193;</span>
              <span class="name">{entry.name}</span>
              {#if entry.mediaCount && entry.mediaCount > 0}
                <span class="meta">{entry.mediaCount} media file{entry.mediaCount !== 1 ? 's' : ''}</span>
              {/if}
            </button>
          {:else}
            <div class="entry entry-file">
              <span class="icon">&#127916;</span>
              <span class="name">{entry.name}</span>
              {#if entry.size}
                <span class="meta">{formatSize(entry.size)}</span>
              {/if}
            </div>
          {/if}
        {/each}
        {#if entries.length === 0}
          <div class="empty">No files or directories found</div>
        {/if}
      </div>
    {/if}

    <div class="footer">
      <button class="btn-cancel" onclick={oncancel}>Cancel</button>
      <button class="btn-select" onclick={selectCurrent}>
        Select This Directory
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .backdrop {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
  }

  .modal {
    position: relative;
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    width: 90%;
    max-width: 700px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .header {
    padding: 20px 24px 12px;
    border-bottom: 1px solid #2a2a4a;
  }

  .header h2 {
    margin: 0 0 4px;
    font-size: 1.1rem;
    color: #e0e0e0;
  }

  .path-display {
    margin: 0;
    font-size: 0.8rem;
    color: #00d4ff;
    font-family: monospace;
    word-break: break-all;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 24px;
    border-bottom: 1px solid #1a1a3a;
  }

  .btn-nav {
    background: #2a2a4a;
    border: 1px solid #3a3a5a;
    color: #e0e0e0;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .btn-nav:hover:not(:disabled) {
    background: #3a3a5a;
  }

  .btn-nav:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .entry-count {
    color: #888;
    font-size: 0.8rem;
    margin-left: auto;
  }

  .entries {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 24px;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .entry-dir:hover {
    background: #1a2a4a;
  }

  .entry-file {
    cursor: default;
    color: #888;
  }

  .icon {
    flex-shrink: 0;
    font-size: 1rem;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: #666;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .loading, .error-msg, .empty {
    padding: 40px 24px;
    text-align: center;
    color: #888;
    font-size: 0.9rem;
  }

  .error-msg {
    color: #ff4444;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #2a2a4a;
  }

  .btn-cancel {
    background: transparent;
    border: 1px solid #555;
    color: #aaa;
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .btn-cancel:hover {
    border-color: #888;
    color: #ccc;
  }

  .btn-select {
    background: #00d4ff;
    border: none;
    color: #0a0a1a;
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .btn-select:hover {
    opacity: 0.9;
  }
</style>
