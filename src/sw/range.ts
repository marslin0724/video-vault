/** Pure helpers for mapping HTTP byte ranges onto chunks; unit-tested, no SW APIs. */

export interface ChunkSpan {
  index: number;
  /** slice of the decrypted chunk to emit */
  start: number;
  end: number; // exclusive
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    // suffix range: last N bytes
    const n = Math.min(Number(b), size);
    return { start: size - n, end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (start > end || start >= size) return null;
  return { start, end };
}

/** Chunk offsets from a size list (works for fixed or content-defined chunking). */
export function chunkOffsets(sizes: number[]): number[] {
  const offsets: number[] = new Array(sizes.length);
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    offsets[i] = acc;
    acc += sizes[i];
  }
  return offsets;
}

/** Yield the chunk slices covering [start, end] inclusive. */
export function spansFor(sizes: number[], offsets: number[], start: number, end: number): ChunkSpan[] {
  const out: ChunkSpan[] = [];
  let i = findChunk(offsets, start);
  for (; i < sizes.length && offsets[i] <= end; i++) {
    const s = Math.max(start, offsets[i]) - offsets[i];
    const e = Math.min(end, offsets[i] + sizes[i] - 1) - offsets[i] + 1;
    out.push({ index: i, start: s, end: e });
  }
  return out;
}

function findChunk(offsets: number[], pos: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
