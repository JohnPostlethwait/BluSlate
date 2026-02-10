import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../packages/core/src/api/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow immediate acquisition when tokens are available', async () => {
    const limiter = new RateLimiter(5, 5);
    await limiter.acquire(); // should resolve immediately
  });

  it('should allow multiple acquisitions up to max tokens', async () => {
    const limiter = new RateLimiter(3, 3);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // All three should resolve without waiting
  });

  it('should wait when tokens are exhausted', async () => {
    const limiter = new RateLimiter(1, 1);
    await limiter.acquire(); // use the one token

    // The next acquire should need to wait
    const acquirePromise = limiter.acquire();
    vi.advanceTimersByTime(1000); // advance 1 second to refill 1 token
    await acquirePromise;
  });
});
