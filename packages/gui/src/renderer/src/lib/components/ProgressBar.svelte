<script lang="ts">
  interface Props {
    event: string;
    message: string;
  }

  let { event, message }: Props = $props();

  let isActive = $derived(event === 'start' || event === 'update');
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
    <p class="message">{message || 'Processing...'}</p>
    {#if isActive}
      <div class="bar-track">
        <div class="bar-fill"></div>
      </div>
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
    min-width: 400px;
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
    margin: 0 0 16px;
    word-break: break-word;
  }

  .bar-track {
    height: 4px;
    background: #2a2a4a;
    border-radius: 2px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: #00d4ff;
    border-radius: 2px;
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { width: 0%; margin-left: 0; }
    50% { width: 60%; margin-left: 20%; }
    100% { width: 0%; margin-left: 100%; }
  }
</style>
