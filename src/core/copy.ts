import { PATHS } from './types';
import type { StorageProvider } from './types';
import { runPool } from './vault';

export interface CopyProgress {
  done: number;
  total: number;
  bytes: number;
  current: string;
}

/**
 * Copy every vault object missing on `dst` from `src`, byte-for-byte (objects stay encrypted).
 * Covers backup, export and import. Refuses to mix two different vaults.
 */
export async function copyVault(
  src: StorageProvider,
  dst: StorageProvider,
  onProgress?: (p: CopyProgress) => void,
  concurrency = 4,
): Promise<CopyProgress> {
  const srcKeyring = await src.get(PATHS.keyring);
  if (await dst.exists(PATHS.keyring)) {
    const dstKeyring = await dst.get(PATHS.keyring);
    if (!bytesEqual(srcKeyring, dstKeyring)) throw new Error('destination holds a different vault (keyring mismatch)');
  }
  const srcEntries = await src.list('');
  const dstSizes = new Map((await dst.list('')).map((e) => [e.path, e.size]));
  const todo = srcEntries.filter((e) => {
    // index/meta may legitimately differ in content; always refresh them. Chunks are immutable.
    if (e.path.startsWith(PATHS.chunkPrefix)) return dstSizes.get(e.path) !== e.size;
    return true;
  });
  const progress: CopyProgress = { done: 0, total: todo.length, bytes: 0, current: '' };
  await runPool(todo, concurrency, async (e) => {
    progress.current = e.path;
    const data = await src.get(e.path);
    await dst.put(e.path, data);
    progress.bytes += data.length;
    progress.done++;
    onProgress?.({ ...progress });
  });
  return progress;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
