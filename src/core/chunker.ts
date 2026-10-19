import { CHUNK_SIZE } from '../config';

export interface ChunkPiece {
  index: number;
  offset: number;
  data: Uint8Array;
}

/** Fixed-size chunking. Reads the blob lazily so large files never sit in memory at once. */
export async function* chunkBlob(blob: Blob, chunkSize = CHUNK_SIZE): AsyncGenerator<ChunkPiece> {
  let index = 0;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const data = new Uint8Array(await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer());
    yield { index, offset, data };
    index++;
  }
}

export function chunkCount(size: number, chunkSize = CHUNK_SIZE): number {
  return Math.ceil(size / chunkSize);
}

/** Byte length of chunk i for a file of `size` bytes. */
export function chunkLength(size: number, i: number, chunkSize = CHUNK_SIZE): number {
  return Math.min(chunkSize, size - i * chunkSize);
}
