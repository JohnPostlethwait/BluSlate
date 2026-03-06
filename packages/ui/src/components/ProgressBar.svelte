<script lang="ts">
  interface Props {
    event: string;
    message: string;
    oncancel?: () => void;
  }

  let { event, message, oncancel }: Props = $props();

  let isActive = $derived(event === 'start' || event === 'update');

  // Keep a log of completed steps
  let completedSteps = $state<string[]>([]);
  let lastSucceedMessage = $state<string>('');

  $effect(() => {
    if (event === 'succeed' && message && message !== lastSucceedMessage) {
      lastSucceedMessage = message;
      // Mutate in place — spreading would read completedSteps inside this
      // effect and create an infinite reactivity loop (effect_update_depth_exceeded).
      completedSteps.push(message);
    }
  });

  // Parse progress from messages like "[3/10] Processing: file.mkv"
  let progressInfo = $derived.by(() => {
    const m = message?.match(/^\[(\d+)\/(\d+)\]/);
    if (m) {
      return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    }
    return null;
  });

  let progressPercent = $derived(
    progressInfo ? Math.round((progressInfo.current / progressInfo.total) * 100) : 0,
  );

  // Clean message (strip the [x/y] prefix for display)
  let displayMessage = $derived(
    message?.replace(/^\[\d+\/\d+\]\s*/, '') || 'Processing...',
  );
</script>

<div class="progress-container">
  <div class="progress-card">
    {#if isActive}
      <div class="spinner"></div>
    {:else if event === 'succeed'}
      <div class="icon-success">&#10003;</div>
    {:else if event === 'fail'}
      <div class="icon-fail">&#10007;</div>
    {/if}

    <p class="message">{displayMessage}</p>

    {#if isActive && progressInfo}
      <div class="progress-info">
        <span class="progress-count">{progressInfo.current} / {progressInfo.total}</span>
        <span class="progress-percent">{progressPercent}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill determinate" style="width: {progressPercent}%"></div>
      </div>
    {:else if isActive}
      <div class="bar-track">
        <div class="bar-fill indeterminate"></div>
      </div>
    {/if}

    {#if completedSteps.length > 0}
      <div class="step-log">
        {#each completedSteps as step}
          <div class="step-entry">
            <span class="step-check">&#10003;</span>
            <span class="step-text">{step}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if oncancel && isActive}
      <button class="cancel-btn" onclick={oncancel}>Cancel</button>
    {/if}
  </div>
</div>

<style>
  .progress-container {
    display: flex;
    justify-content: center;
    padding: 60px 0;
  }

  .progress-card {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    padding: 40px 48px;
    text-align: center;
    min-width: 450px;
    max-width: 600px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #2a2a4a;
    border-top-color: #00d4ff;
    border-radius: 50%;
    margin: 0 auto 16px;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .icon-success {
    font-size: 2rem;
    color: #4caf50;
    margin-bottom: 12px;
  }

  .icon-fail {
    font-size: 2rem;
    color: #ff4444;
    margin-bottom: 12px;
  }

  .message {
    color: #ccc;
    font-size: 0.95rem;
    margin: 0 0 12px;
    word-break: break-word;
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: #888;
    margin-bottom: 6px;
  }

  .progress-percent {
    color: #00d4ff;
    font-weight: 600;
  }

  .bar-track {
    height: 6px;
    background: #2a2a4a;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .bar-fill {
    height: 100%;
    background: #00d4ff;
    border-radius: 3px;
  }

  .bar-fill.determinate {
    transition: width 0.3s ease;
  }

  .bar-fill.indeterminate {
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { width: 0%; margin-left: 0; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0%; margin-left: 100%; }
  }

  .step-log {
    margin-top: 20px;
    text-align: left;
    border-top: 1px solid #2a2a4a;
    padding-top: 12px;
    max-height: 150px;
    overflow-y: auto;
  }

  .step-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 0.8rem;
    color: #888;
  }

  .step-check {
    color: #4caf50;
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .step-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cancel-btn {
    margin-top: 20px;
    background: transparent;
    border: 1px solid #ff4444;
    color: #ff4444;
    padding: 8px 24px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  .cancel-btn:hover {
    background: #ff444422;
  }
</style>
