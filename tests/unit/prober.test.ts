import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { setFfprobePath, isFfprobeAvailable, probeFile } from '../../packages/core/src/core/prober.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

describe('setFfprobePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default path so each test starts clean
    setFfprobePath('ffprobe');
  });

  it('should use custom path when set', async () => {
    // Make execFile succeed for the custom path
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      if (typeof cb === 'function') (cb as CallableFunction)(null);
      return {} as ReturnType<typeof execFile>;
    });

    setFfprobePath('/custom/bin/ffprobe');
    await isFfprobeAvailable();

    // The first call to execFile should use the custom path
    expect(mockExecFile).toHaveBeenCalledWith(
      '/custom/bin/ffprobe',
      ['-version'],
      expect.any(Function),
    );
  });

  it('should reset availability cache when path changes', async () => {
    // First call: ffprobe available
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      if (typeof cb === 'function') (cb as CallableFunction)(null);
      return {} as ReturnType<typeof execFile>;
    });

    const first = await isFfprobeAvailable();
    expect(first).toBe(true);
    expect(mockExecFile).toHaveBeenCalledTimes(1);

    // Second call with same path: cached (no new execFile call)
    const second = await isFfprobeAvailable();
    expect(second).toBe(true);
    expect(mockExecFile).toHaveBeenCalledTimes(1);

    // Change path: cache reset, new execFile call
    setFfprobePath('/new/ffprobe');
    const third = await isFfprobeAvailable();
    expect(third).toBe(true);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });
});

describe('isFfprobeAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFfprobePath('ffprobe');
  });

  it('should return true when ffprobe is found', async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      if (typeof cb === 'function') (cb as CallableFunction)(null);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await isFfprobeAvailable();
    expect(result).toBe(true);
  });

  it('should return false when ffprobe is not found', async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      if (typeof cb === 'function') (cb as CallableFunction)(new Error('ENOENT'));
      return {} as ReturnType<typeof execFile>;
    });

    const result = await isFfprobeAvailable();
    expect(result).toBe(false);
  });
});

describe('probeFile with custom path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFfprobePath('ffprobe');
  });

  it('should return undefined when ffprobe is not available', async () => {
    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      if (typeof cb === 'function') (cb as CallableFunction)(new Error('ENOENT'));
      return {} as ReturnType<typeof execFile>;
    });

    const result = await probeFile('/some/file.mkv');
    expect(result).toBeUndefined();
  });

  it('should use custom ffprobe path for probing', async () => {
    const mockOutput = {
      format: {
        duration: '3600.5',
        format_name: 'matroska,webm',
        tags: { title: 'Test Episode' },
      },
      streams: [],
    };

    let callCount = 0;
    mockExecFile.mockImplementation((cmd: unknown, _args: unknown, cbOrOpts: unknown, maybeCb?: unknown) => {
      const cb = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
      callCount++;
      if (callCount === 1) {
        // checkFfprobe call
        if (typeof cb === 'function') (cb as CallableFunction)(null);
      } else {
        // runFfprobe call — verify the custom path is used
        expect(cmd).toBe('/bundled/ffprobe');
        if (typeof cb === 'function') (cb as CallableFunction)(null, JSON.stringify(mockOutput));
      }
      return {} as ReturnType<typeof execFile>;
    });

    setFfprobePath('/bundled/ffprobe');
    const result = await probeFile('/some/file.mkv');

    expect(result).toBeDefined();
    expect(result?.durationSeconds).toBeCloseTo(3600.5);
    expect(result?.title).toBe('Test Episode');
  });
});
