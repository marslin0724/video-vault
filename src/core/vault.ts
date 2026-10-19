import { PATHS } from './types';
import type { ChunkIndex, Keyring, StorageProvider, VideoMeta } from './types';
import { createKeyring, decryptJson, encryptBytes, encryptJson, generateMasterKey, sha256Hex, unlockKeyring, utf8 } from './crypto';
import { chunkBlob, chunkCount } from './chunker';
import { CHUNK_SIZE } from '../config';

export interface UploadProgress {
  done: number; // chunks processed (uploaded or deduped)
  total: number;
  uploadedBytes: number;
  dedupedBytes: number;
}

export interface UploadInput {
  blob: Blob;
  title: string;
  originalName: string;
  mime: string;
  duration: number;
  width: number;
  height: number;
  remuxed: boolean;
  thumb?: string;
}

export interface ChunkRef {
  hash: string;
  size: number;
  locator: string;
}

export interface VideoDescriptor {
  id: string;
  mime: string;
  size: number;
  title: string;
  chunks: ChunkRef[];
}

/** High-level vault operations over a StorageProvider plus the unlocked master key. */
export class Vault {
  private constructor(
    readonly provider: StorageProvider,
    readonly key: CryptoKey,
    public index: ChunkIndex,
  ) {}

  static async hasKeyring(provider: StorageProvider): Promise<boolean> {
    return provider.exists(PATHS.keyring);
  }

  static async create(provider: StorageProvider, passphrase: string): Promise<Vault> {
    if (await provider.exists(PATHS.keyring)) throw new Error('vault already exists');
    const key = await generateMasterKey();
    const keyring = await createKeyring(passphrase, key);
    await provider.put(PATHS.keyring, utf8.encode(JSON.stringify(keyring)));
    const index: ChunkIndex = { version: 1, chunks: {} };
    await provider.put(PATHS.index, await encryptJson(key, index));
    return new Vault(provider, key, index);
  }

  static async open(provider: StorageProvider, passphrase: string): Promise<Vault> {
    const keyring = JSON.parse(utf8.decode(await provider.get(PATHS.keyring))) as Keyring;
    const key = await unlockKeyring(keyring, passphrase);
    const index = await decryptJson<ChunkIndex>(key, await provider.get(PATHS.index));
    return new Vault(provider, key, index);
  }

  async saveIndex(): Promise<void> {
    await this.provider.put(PATHS.index, await encryptJson(this.key, this.index));
  }

  async listVideos(concurrency = 6): Promise<VideoMeta[]> {
    const entries = await this.provider.list(PATHS.metaPrefix);
    const out: VideoMeta[] = [];
    await runPool(entries, concurrency, async (e) => {
      out.push(await decryptJson<VideoMeta>(this.key, await this.provider.get(e.path)));
    });
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getVideo(id: string): Promise<VideoMeta> {
    return decryptJson<VideoMeta>(this.key, await this.provider.get(PATHS.meta(id)));
  }

  async saveVideo(meta: VideoMeta): Promise<void> {
    await this.provider.put(PATHS.meta(meta.id), await encryptJson(this.key, meta));
  }

  /** Chunk, dedup, encrypt and upload. Re-running after an interruption only uploads missing chunks. */
  async uploadVideo(input: UploadInput, onProgress?: (p: UploadProgress) => void, concurrency = 4): Promise<VideoMeta> {
    const total = chunkCount(input.blob.size);
    const hashes: string[] = new Array(total);
    const progress: UploadProgress = { done: 0, total, uploadedBytes: 0, dedupedBytes: 0 };
    const inflight = new Set<Promise<void>>();
    const storing = new Map<string, Promise<void>>(); // same hash appearing twice in one file

    for await (const piece of chunkBlob(input.blob)) {
      const task = (async () => {
        const hash = await sha256Hex(piece.data);
        hashes[piece.index] = hash;
        const pending = storing.get(hash);
        if (pending) {
          await pending;
          progress.dedupedBytes += piece.data.length;
        } else if (this.index.chunks[hash] && (await this.provider.exists(PATHS.chunk(hash)))) {
          progress.dedupedBytes += piece.data.length;
        } else {
          const store = (async () => {
            await this.provider.put(PATHS.chunk(hash), await encryptBytes(this.key, piece.data));
            this.index.chunks[hash] = { size: piece.data.length };
          })();
          storing.set(hash, store);
          await store;
          progress.uploadedBytes += piece.data.length;
        }
        progress.done++;
        onProgress?.({ ...progress });
      })();
      inflight.add(task);
      task.finally(() => inflight.delete(task));
      if (inflight.size >= concurrency) await Promise.race(inflight);
    }
    await Promise.all(inflight);

    const meta: VideoMeta = {
      version: 1,
      id: crypto.randomUUID(),
      title: input.title,
      originalName: input.originalName,
      mime: input.mime,
      size: input.blob.size,
      duration: input.duration,
      width: input.width,
      height: input.height,
      createdAt: new Date().toISOString(),
      remuxed: input.remuxed,
      chunkSize: CHUNK_SIZE,
      chunks: hashes,
      thumb: input.thumb,
    };
    await this.saveVideo(meta);
    await this.saveIndex();
    return meta;
  }

  /** Delete a video and garbage-collect chunks no other video references. */
  async deleteVideo(id: string): Promise<{ removedChunks: number }> {
    await this.provider.remove(PATHS.meta(id));
    const referenced = new Set<string>();
    for (const v of await this.listVideos()) v.chunks.forEach((h) => referenced.add(h));
    let removedChunks = 0;
    for (const hash of Object.keys(this.index.chunks)) {
      if (referenced.has(hash)) continue;
      await this.provider.remove(PATHS.chunk(hash));
      delete this.index.chunks[hash];
      removedChunks++;
    }
    await this.saveIndex();
    return { removedChunks };
  }

  /** Everything the service worker needs to serve byte ranges of a video. */
  async describe(meta: VideoMeta): Promise<VideoDescriptor> {
    const chunks: ChunkRef[] = [];
    for (let i = 0; i < meta.chunks.length; i++) {
      const hash = meta.chunks[i];
      const size = this.index.chunks[hash]?.size ?? Math.min(meta.chunkSize, meta.size - i * meta.chunkSize);
      chunks.push({ hash, size, locator: await this.provider.locate(PATHS.chunk(hash)) });
    }
    return { id: meta.id, mime: meta.mime, size: meta.size, title: meta.title, chunks };
  }
}

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
