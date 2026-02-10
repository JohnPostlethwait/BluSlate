<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DirectoryPicker from './lib/components/DirectoryPicker.svelte';
  import ProgressBar from './lib/components/ProgressBar.svelte';
  import ResultsTable from './lib/components/ResultsTable.svelte';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import ShowSelector from './lib/components/ShowSelector.svelte';
  import SummaryPanel from './lib/components/SummaryPanel.svelte';

  // --- Reactive state ---
  let currentView = $state<'setup' | 'running' | 'results' | 'confirm' | 'showSelect' | 'summary'>('setup');
  let progressEvent = $state<string>('');
  let progressMessage = $state<string>('');
  let matches = $state<MatchResultData[]>([]);
  let scanDirectory = $state<string>('');
  let summaryData = $state<{ renamed: number; skipped: number; failed: number; dryRun: boolean } | null>(null);
  let errorMessage = $state<string>('');
  let showPrompt = $state<{ showName: string; candidates: ShowCandidate[] } | null>(null);

  // Settings state
  let savedApiKey = $state<string>('');
  let savedDirectory = $state<string>('');
  let apiKey = $state<string>('');
  let directory = $state<string>('');
  let recursive = $state<boolean>(false);
  let dryRun = $state<boolean>(false);
  let language = $state<string>('en-US');

  // Cleanup functions for IPC listeners
  let cleanups: (() => void)[] = [];

  onMount(async () => {
    const api = window.api;

    // Load saved settings
    try {
      const settings = await api.loadSettings();
      if (settings.apiKey) {
        savedApiKey = settings.apiKey;
      }
      if (settings.recentDirectories?.length > 0) {
        savedDirectory = settings.recentDirectories[0];
      }
    } catch {
      // Settings not available yet, that's OK
    }

    cleanups.push(
      api.onProgress((event, data) => {
        progressEvent = event;
        progressMessage = data.message ?? '';

        if (event === 'start' || event === 'update') {
          currentView = 'running';
        }
      }),
    );

    cleanups.push(
      api.onResults((data) => {
        matches = data.matches;
        scanDirectory = data.scanDirectory;
        currentView = 'results';
      }),
    );

    cleanups.push(
      api.onSummary((data) => {
        summaryData = data;
        currentView = 'summary';
      }),
    );

    cleanups.push(
      api.onConfirmRenames((data) => {
        matches = data.matches;
        currentView = 'confirm';
      }),
    );

    cleanups.push(
      api.onConfirmShow((data) => {
        showPrompt = data;
        currentView = 'showSelect';
      }),
    );

    cleanups.push(
      api.onPipelineComplete(() => {
        // Summary will follow from displaySummary
      }),
    );

    cleanups.push(
      api.onPipelineError((data) => {
        errorMessage = data.message;
        currentView = 'setup';
      }),
    );

    cleanups.push(
      api.onMenuOpenDirectory((dir) => {
        savedDirectory = dir;
        if (currentView === 'setup') {
          // Will be picked up by DirectoryPicker via prop
        } else {
          // Switch back to setup view with the new directory
          handleReset();
          savedDirectory = dir;
        }
      }),
    );
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
  });

  function handleStart(event: { directory: string; apiKey: string; recursive: boolean; dryRun: boolean }) {
    directory = event.directory;
    apiKey = event.apiKey;
    recursive = event.recursive;
    dryRun = event.dryRun;
    errorMessage = '';
    summaryData = null;
    matches = [];

    window.api.startPipeline({
      directory: event.directory,
      apiKey: event.apiKey,
      dryRun: event.dryRun,
      recursive: event.recursive,
      language,
      autoAccept: false,
      minConfidence: 85,
    });
  }

  function handleConfirm(confirmed: MatchResultData[]) {
    window.api.respondConfirmRenames(confirmed);
    currentView = 'running';
    progressMessage = 'Renaming files...';
  }

  function handleShowSelect(selected: ShowCandidate | null) {
    window.api.respondConfirmShow(selected);
    showPrompt = null;
    currentView = 'running';
  }

  function handleReset() {
    currentView = 'setup';
    matches = [];
    summaryData = null;
    errorMessage = '';
    progressMessage = '';
  }
</script>

<main>
  <header>
    <h1>MediaFetch</h1>
    <p class="subtitle">Rename TV shows and movies using TMDb metadata</p>
  </header>

  {#if errorMessage}
    <div class="error-banner">
      <span class="error-icon">!</span>
      <span>{errorMessage}</span>
      <button onclick={() => (errorMessage = '')}>Dismiss</button>
    </div>
  {/if}

  {#if currentView === 'setup'}
    <DirectoryPicker onstart={handleStart} initialDirectory={savedDirectory} initialApiKey={savedApiKey} />
  {:else if currentView === 'running'}
    <ProgressBar event={progressEvent} message={progressMessage} />
  {:else if currentView === 'results'}
    <ResultsTable {matches} {scanDirectory} />
  {:else if currentView === 'confirm'}
    <ConfirmDialog {matches} onconfirm={handleConfirm} oncancel={handleReset} />
  {:else if currentView === 'showSelect' && showPrompt}
    <ShowSelector
      showName={showPrompt.showName}
      candidates={showPrompt.candidates}
      onselect={handleShowSelect}
    />
  {:else if currentView === 'summary' && summaryData}
    <SummaryPanel {...summaryData} onreset={handleReset} />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    min-height: 100vh;
  }

  :global(*) {
    box-sizing: border-box;
  }

  main {
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px;
  }

  header {
    text-align: center;
    margin-bottom: 32px;
  }

  header h1 {
    font-size: 2rem;
    color: #00d4ff;
    margin: 0 0 4px;
  }

  .subtitle {
    color: #888;
    margin: 0;
    font-size: 0.95rem;
  }

  .error-banner {
    background: #4a1c1c;
    border: 1px solid #ff4444;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .error-icon {
    background: #ff4444;
    color: white;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .error-banner button {
    margin-left: auto;
    background: transparent;
    border: 1px solid #ff4444;
    color: #ff4444;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .error-banner button:hover {
    background: #ff444422;
  }
</style>
