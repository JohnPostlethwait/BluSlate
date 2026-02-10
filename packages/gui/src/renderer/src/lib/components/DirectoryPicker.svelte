<script lang="ts">
  interface Props {
    onstart: (event: { directory: string; apiKey: string; recursive: boolean; dryRun: boolean }) => void;
  }

  let { onstart }: Props = $props();

  let directory = $state('');
  let apiKey = $state('');
  let recursive = $state(false);
  let dryRun = $state(false);

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
</script>

<div class="picker">
  <div class="field">
    <label for="directory">Media Directory</label>
    <div class="input-row">
      <input
        id="directory"
        type="text"
        bind:value={directory}
        placeholder="/path/to/media/files"
        class="input-text"
      />
      <button class="btn-browse" onclick={handleBrowse}>Browse</button>
    </div>
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
    border: 1px solid #2a2a4a;
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
