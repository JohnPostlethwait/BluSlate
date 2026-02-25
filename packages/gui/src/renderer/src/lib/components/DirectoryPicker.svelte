<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    onstart: (event: { directory: string; apiKey: string; recursive: boolean; dryRun: boolean }) => void;
    initialDirectory?: string;
    initialApiKey?: string;
  }

  let { onstart, initialDirectory = '', initialApiKey = '' }: Props = $props();

  let directory = $state('');
  let apiKey = $state('');
  let recursive = $state(true);
  let dryRun = $state(false);
  let isDragOver = $state(false);
  let ffprobeAvailable = $state<boolean | null>(null);
  let tipsOpen = $state(false);

  onMount(async () => {
    try {
      ffprobeAvailable = await window.api.checkFfprobe();
    } catch {
      ffprobeAvailable = false;
    }
  });

  // Sync with initial values when they load asynchronously (e.g. from saved settings)
  $effect(() => {
    if (initialDirectory && !directory) directory = initialDirectory;
  });
  $effect(() => {
    if (initialApiKey && !apiKey) apiKey = initialApiKey;
  });

  async function handleBrowse() {
    const selected = await window.api.selectDirectory();
    if (selected) {
      directory = selected;
    }
  }

  function handleSubmit() {
    if (!directory || !apiKey) return;
    onstart({ directory, apiKey, recursive, dryRun });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;

    if (!e.dataTransfer?.files?.length) return;

    // Get the first dropped item's path
    const file = e.dataTransfer.files[0];
    const path = (file as File & { path?: string }).path;
    if (path) {
      directory = path;
    }
  }
</script>

<div
  class="picker"
  class:drag-over={isDragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="region"
  aria-label="Media directory picker"
>
  {#if ffprobeAvailable === false}
    <div class="ffprobe-warning">
      <span class="warning-icon">&#9888;</span>
      <div>
        <strong>ffprobe not found</strong>
        <p>
          File durations cannot be detected. Batch matching (disc rips) will be
          severely degraded. Install
          <a href="https://ffmpeg.org/download.html" target="_blank">ffmpeg</a>
          for best results.
        </p>
      </div>
    </div>
  {/if}

  <div class="field">
    <label for="directory">Media Directory</label>
    <div class="input-row">
      <input
        id="directory"
        type="text"
        bind:value={directory}
        placeholder="Drop a folder here or click Browse"
        class="input-text"
      />
      <button class="btn-browse" onclick={handleBrowse}>Browse</button>
    </div>
    {#if !directory}
      <p class="drop-hint">Drag & drop a folder anywhere on this panel</p>
    {/if}
  </div>

  <div class="field">
    <label for="apiKey">TMDb API Key</label>
    <input
      id="apiKey"
      type="password"
      bind:value={apiKey}
      placeholder="Enter your TMDb Read Access Token"
      class="input-text"
    />
    <a href="https://www.themoviedb.org/settings/api" target="_blank" class="help-link">
      Get a free API key
    </a>
  </div>

  <div class="options-row">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={recursive} />
      <span>Scan subdirectories</span>
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={dryRun} />
      <span>Dry run (preview only)</span>
    </label>
  </div>

  <div class="tips-box">
    <button class="tips-toggle" onclick={() => (tipsOpen = !tipsOpen)}>
      <span class="tips-chevron" class:open={tipsOpen}>&#9654;</span>
      Tips for Better Matches
    </button>
    {#if tipsOpen}
      <ul class="tips-list">
        <li><strong>Season folders should have clear naming</strong> (S1, or Season 1) — MediaFetch uses folder structure to determine episode seasons. Often the disks themselves contain adequate naming.</li>
        <li><strong>Remove "Play All" tracks</strong> — Long concatenated files consume episode slots and confuse the matcher.</li>
        <li><strong>Delete extras and duplicates</strong> — Bonus content and duplicate quality rips take episode positions from real episodes.</li>
        <li><strong>TMDb Show Identification</strong> — Edit the search on the TMDb screen if the folder name doesn't result in a match. This name is also used to search DVDCompare.</li>
        <li><strong>Select a DVDCompare release</strong> — DVDCompare is the only source for to-the-second episode runtime information which dramatically improves matching accuracy.</li>
        <li><strong>Review and reorder</strong> — Check confidence scores and use the arrow buttons to fix any mismatches before confirming. It's best to spot-check the matches just to ensure there was no strange ordering from the disks.</li>
      </ul>
    {/if}
  </div>

  <button
    class="btn-start"
    onclick={handleSubmit}
    disabled={!directory || !apiKey}
  >
    Scan &amp; Match
  </button>
</div>

<style>
  .picker {
    background: #16213e;
    border-radius: 12px;
    padding: 32px;
    border: 2px solid #2a2a4a;
    transition: border-color 0.2s, background 0.2s;
  }

  .picker.drag-over {
    border-color: #00d4ff;
    background: #1a2a4a;
  }

  .ffprobe-warning {
    background: #3a3000;
    border: 1px solid #ffb300;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .ffprobe-warning .warning-icon {
    color: #ffb300;
    font-size: 1.2rem;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .ffprobe-warning strong {
    color: #ffb300;
    display: block;
    margin-bottom: 4px;
    font-size: 0.9rem;
  }

  .ffprobe-warning p {
    margin: 0;
    color: #ccc;
    font-size: 0.8rem;
  }

  .ffprobe-warning a {
    color: #00d4ff;
    text-decoration: none;
  }

  .ffprobe-warning a:hover {
    text-decoration: underline;
  }

  .field {
    margin-bottom: 20px;
  }

  label {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
    color: #ccc;
    font-size: 0.9rem;
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .input-text {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #3a3a5a;
    border-radius: 6px;
    background: #0f0f23;
    color: #e0e0e0;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .input-text:focus {
    border-color: #00d4ff;
  }

  .btn-browse {
    padding: 10px 20px;
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    white-space: nowrap;
    transition: background 0.2s;
  }

  .btn-browse:hover {
    background: #3a3a5a;
  }

  .drop-hint {
    margin: 6px 0 0;
    font-size: 0.8rem;
    color: #555;
    font-style: italic;
  }

  .help-link {
    display: inline-block;
    margin-top: 4px;
    font-size: 0.8rem;
    color: #00d4ff;
    text-decoration: none;
  }

  .help-link:hover {
    text-decoration: underline;
  }

  .options-row {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-weight: normal;
    color: #bbb;
    font-size: 0.9rem;
  }

  .checkbox-label input[type='checkbox'] {
    accent-color: #00d4ff;
  }

  .tips-box {
    margin-bottom: 24px;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    overflow: hidden;
  }

  .tips-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #0f0f23;
    border: none;
    color: #888;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.2s;
  }

  .tips-toggle:hover {
    color: #ccc;
  }

  .tips-chevron {
    font-size: 0.6rem;
    transition: transform 0.2s;
    display: inline-block;
  }

  .tips-chevron.open {
    transform: rotate(90deg);
  }

  .tips-list {
    margin: 0;
    padding: 12px 16px 12px 32px;
    background: #0d1a30;
    list-style: disc;
  }

  .tips-list li {
    color: #999;
    font-size: 0.8rem;
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .tips-list li:last-child {
    margin-bottom: 0;
  }

  .tips-list strong {
    color: #ccc;
  }

  .btn-start {
    width: 100%;
    padding: 14px;
    background: #00d4ff;
    color: #0f0f23;
    border: none;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn-start:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-start:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
