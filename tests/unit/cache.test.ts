import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../../packages/core/src/api/cache.js';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    const cache = new LRUCache<string>();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    const cache = new LRUCache<string>();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should evict oldest entry when at capacity', () => {
    const cache = new LRUCache<string>(2);
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3'); // should evict key1

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
    expect(cache.get('key3')).toBe('value3');
  });

  it('should refresh position on access', () => {
    const cache = new LRUCache<string>(2);
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.get('key1'); // refresh key1
    cache.set('key3', 'value3'); // should evict key2, not key1

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toBe('value3');
  });

  it('should expire entries after TTL', () => {
    const cache = new LRUCache<string>(100, 1000); // 1 second TTL
    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');

    vi.advanceTimersByTime(1001);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should report correct size', () => {
    const cache = new LRUCache<string>();
    expect(cache.size).toBe(0);
    cache.set('key1', 'value1');
    expect(cache.size).toBe(1);
    cache.set('key2', 'value2');
    expect(cache.size).toBe(2);
  });

  it('should clear all entries', () => {
    const cache = new LRUCache<string>();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should update value for existing key', () => {
    const cache = new LRUCache<string>();
    cache.set('key1', 'value1');
    cache.set('key1', 'updated');
    expect(cache.get('key1')).toBe('updated');
    expect(cache.size).toBe(1);
  });

  it('should handle has() correctly', () => {
    const cache = new LRUCache<string>();
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('key2')).toBe(false);
  });
});
