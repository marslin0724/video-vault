import { describe, expect, it } from 'vitest';
import { chunkBlob, chunkCount, chunkLength } from '../src/core/chunker';

describe('chunker', () => {
  it('splits into fixed chunks with a short tail', async () => {
    const blob = new Blob([new Uint8Array(25)]);
    const pieces = [];
    for await (const p of chunkBlob(blob, 10)) pieces.push(p);
    expect(pieces.map((p) => [p.index, p.offset, p.data.length])).toEqual([[0, 0, 10], [1, 10, 10], [2, 20, 5]]);
    expect(chunkCount(25, 10)).toBe(3);
    expect(chunkLength(25, 2, 10)).toBe(5);
  });
});
