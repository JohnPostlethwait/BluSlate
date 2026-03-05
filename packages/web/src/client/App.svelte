<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DirectoryPicker from './lib/components/DirectoryPicker.svelte';
  import ProgressBar from './lib/components/ProgressBar.svelte';
  import ResultsTable from './lib/components/ResultsTable.svelte';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import ShowSelector from './lib/components/ShowSelector.svelte';
  import DvdCompareSelector from './lib/components/DvdCompareSelector.svelte';
  import SummaryPanel from './lib/components/SummaryPanel.svelte';

  // --- Reactive state ---
  let currentView = $state<'setup' | 'running' | 'results' | 'confirm' | 'showSelect' | 'dvdCompareSelect' | 'summary'>('setup');
  let progressEvent = $state<string>('');
  let progressMessage = $state<string>('');
  let matches = $state<MatchResultData[]>([]);
  let scanDirectory = $state<string>('');
  let summaryData = $state<{ renamed: number; skipped: number; failed: number; dryRun: boolean } | null>(null);
  let errorMessage = $state<string>('');
  let showPrompt = $state<{ showName: string; candidates: ShowCandidate[] } | null>(null);
  let dvdComparePrompt = $state<{ showName: string; candidates: DvdCompareCandidate[] } | null>(null);

  // Settings state
  let savedApiKey = $state<string>('');
  let savedDirectory = $state<string>('');
  let apiKey = $state<string>('');
  let directory = $state<string>('');
  let recursive = $state<boolean>(false);
  let dryRun = $state<boolean>(false);
  let language = $state<string>('en-US');
  let minConfidence = $state<number>(85);
  let template = $state<string | undefined>(undefined);

  // When true, ignore all pipeline IPC events (user cancelled mid-pipeline)
  let ignoreEvents = $state(false);

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
      if (settings.language) {
        language = settings.language;
      }
      if (settings.minConfidence != null) {
        minConfidence = settings.minConfidence;
      }
      if (settings.template) {
        template = settings.template;
      }
    } catch {
      // Settings not available yet, that's OK
    }

    cleanups.push(
      api.onProgress((event, data) => {
        if (ignoreEvents) return;
        progressEvent = event;
        progressMessage = data.message ?? '';

        if (event === 'start' || event === 'update') {
          currentView = 'running';
        }
      }),
    );

    cleanups.push(
      api.onResults((data) => {
        if (ignoreEvents) return;
        matches = data.matches;
        scanDirectory = data.scanDirectory;
        currentView = 'results';
      }),
    );

    cleanups.push(
      api.onSummary((data) => {
        if (ignoreEvents) return;
        summaryData = data;
        currentView = 'summary';
      }),
    );

    cleanups.push(
      api.onConfirmRenames((data) => {
        if (ignoreEvents) return;
        matches = data.matches;
        currentView = 'confirm';
      }),
    );

    cleanups.push(
      api.onConfirmShow((data) => {
        if (ignoreEvents) return;
        showPrompt = data;
        currentView = 'showSelect';
      }),
    );

    cleanups.push(
      api.onConfirmDvdCompare((data) => {
        if (ignoreEvents) return;
        dvdComparePrompt = data;
        currentView = 'dvdCompareSelect';
      }),
    );

    cleanups.push(
      api.onPipelineComplete(() => {
        ignoreEvents = false;
      }),
    );

    cleanups.push(
      api.onPipelineError((data) => {
        ignoreEvents = false;
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
    ignoreEvents = false;
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
      minConfidence,
      template,
    });
  }

  function handleConfirm(confirmed: MatchResultData[]) {
    // Unwrap Svelte 5 $state proxies so Electron IPC structured clone works
    window.api.respondConfirmRenames(JSON.parse(JSON.stringify(confirmed)));
    currentView = 'running';
    progressMessage = 'Renaming files...';
  }

  function handleShowSelect(selected: ShowCandidate | null) {
    // Unwrap Svelte 5 $state proxy so Electron IPC structured clone works
    window.api.respondConfirmShow(selected ? JSON.parse(JSON.stringify(selected)) : null);
    showPrompt = null;
    currentView = 'running';
  }

  function handleShowRetry(query: string) {
    window.api.respondConfirmShow({ __retry: query });
    showPrompt = null;
    currentView = 'running';
    progressMessage = `Searching TMDb for "${query}"...`;
  }

  function handleDvdCompareSelect(selected: DvdCompareCandidate[]) {
    // Unwrap Svelte 5 $state proxy so Electron IPC structured clone works
    window.api.respondConfirmDvdCompare(JSON.parse(JSON.stringify(selected)));
    dvdComparePrompt = null;
    currentView = 'running';
  }

  function handleCancel() {
    window.api.cancelPipeline();
    ignoreEvents = true;
    currentView = 'setup';
    progressMessage = '';
    progressEvent = '';
  }

  function handleReset() {
    // If we're leaving a prompt view, send an empty response so the main-process
    // pipeline Promise resolves and releases the pipelineRunning guard.
    // Also ignore subsequent pipeline events until the pipeline finishes.
    if (currentView === 'confirm') {
      window.api.respondConfirmRenames([]);
      ignoreEvents = true;
    } else if (currentView === 'showSelect') {
      window.api.respondConfirmShow(null);
      ignoreEvents = true;
    } else if (currentView === 'dvdCompareSelect') {
      window.api.respondConfirmDvdCompare([]);
      ignoreEvents = true;
    }

    currentView = 'setup';
    matches = [];
    summaryData = null;
    errorMessage = '';
    progressMessage = '';
  }
</script>

<main>
  <header>
    <h1>BluSlate</h1>
    <p class="subtitle">Rename TV shows using TMDb metadata</p>
    <p class="attribution">Runtime data powered by <a href="https://www.dvdcompare.net" target="_blank">DVDCompare.net</a></p>
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
    <ProgressBar event={progressEvent} message={progressMessage} oncancel={handleCancel} />
  {:else if currentView === 'results'}
    <ResultsTable {matches} {scanDirectory} />
  {:else if currentView === 'confirm'}
    <ConfirmDialog {matches} {scanDirectory} onconfirm={handleConfirm} oncancel={handleReset} />
  {:else if currentView === 'showSelect' && showPrompt}
    <ShowSelector
      showName={showPrompt.showName}
      candidates={showPrompt.candidates}
      onselect={handleShowSelect}
      oncancel={handleReset}
      onretry={handleShowRetry}
    />
  {:else if currentView === 'dvdCompareSelect' && dvdComparePrompt}
    <DvdCompareSelector
      showName={dvdComparePrompt.showName}
      candidates={dvdComparePrompt.candidates}
      onselect={handleDvdCompareSelect}
      oncancel={handleReset}
    />
  {:else if currentView === 'summary' && summaryData}
    <SummaryPanel {...summaryData} {matches} {scanDirectory} onreset={handleReset} />
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
    max-width: 1600px;
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

  .attribution {
    color: #666;
    margin: 4px 0 0;
    font-size: 0.8rem;
  }

  .attribution a {
    color: #00d4ff;
    text-decoration: none;
  }

  .attribution a:hover {
    text-decoration: underline;
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
