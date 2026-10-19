import { describe, expect, it } from 'vitest';
import { chunkOffsets, parseRange, spansFor } from '../src/sw/range';

describe('range mapping', () => {
  const sizes = [10, 10, 5];
  const offsets = chunkOffsets(sizes);

  it('parses range headers', () => {
    expect(parseRange('bytes=0-', 25)).toEqual({ start: 0, end: 24 });
    expect(parseRange('bytes=5-9', 25)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=5-999', 25)).toEqual({ start: 5, end: 24 });
    expect(parseRange('bytes=-5', 25)).toEqual({ start: 20, end: 24 });
    expect(parseRange('bytes=30-', 25)).toBeNull();
    expect(parseRange(null, 25)).toBeNull();
  });

  it('maps ranges onto chunk slices', () => {
    expect(spansFor(sizes, offsets, 0, 24)).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 0, end: 10 },
      { index: 2, start: 0, end: 5 },
    ]);
    expect(spansFor(sizes, offsets, 8, 12)).toEqual([
      { index: 0, start: 8, end: 10 },
      { index: 1, start: 0, end: 3 },
    ]);
    expect(spansFor(sizes, offsets, 22, 22)).toEqual([{ index: 2, start: 2, end: 3 }]);
  });
});
