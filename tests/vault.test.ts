import { describe, expect, it } from 'vitest';
import { MemoryProvider } from '../src/core/storage/memory';
import { Vault } from '../src/core/vault';
import { copyVault } from '../src/core/copy';
import { PATHS } from '../src/core/types';
import { CHUNK_SIZE } from '../src/config';

function video(size: number, fill: number) {
  return new Blob([new Uint8Array(size).fill(fill)]);
}
const base = { title: 't', originalName: 't.mp4', mime: 'video/mp4', duration: 1, width: 1, height: 1, remuxed: false };

async function freshVault() {
  const p = new MemoryProvider();
  const v = await Vault.create(p, 'pass');
  return { p, v };
}

describe('vault', () => {
  it('creates, reopens and lists videos', async () => {
    const { p, v } = await freshVault();
    await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE + 10, 1) });
    const reopened = await Vault.open(p, 'pass');
    const videos = await reopened.listVideos();
    expect(videos).toHaveLength(1);
    expect(videos[0].chunks).toHaveLength(2);
    expect(Object.keys(reopened.index.chunks)).toHaveLength(2);
  });

  it('dedups identical chunks across uploads', async () => {
    const { p, v } = await freshVault();
    let last: any;
    await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE * 2, 7) }, (x) => (last = x));
    expect(last.uploadedBytes).toBe(CHUNK_SIZE); // two identical chunks -> stored once
    expect(last.dedupedBytes).toBe(CHUNK_SIZE);
    await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE * 2, 7) }, (x) => (last = x));
    expect(last.uploadedBytes).toBe(0);
    expect((await p.list(PATHS.chunkPrefix)).length).toBe(1);
  });

  it('stores chunks encrypted (no plaintext on storage)', async () => {
    const { p, v } = await freshVault();
    await v.uploadVideo({ ...base, blob: video(100, 9) });
    const [entry] = await p.list(PATHS.chunkPrefix);
    const stored = await p.get(entry.path);
    expect(stored.length).toBe(100 + 12 + 16);
    expect(stored.every((b) => b === 9)).toBe(false);
  });

  it('deleteVideo garbage-collects unreferenced chunks only', async () => {
    const { p, v } = await freshVault();
    const a = await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE, 1) });
    await v.uploadVideo({ ...base, blob: new Blob([new Uint8Array(CHUNK_SIZE).fill(1), new Uint8Array(5).fill(2)]) });
    expect((await p.list(PATHS.chunkPrefix)).length).toBe(2);
    await v.deleteVideo(a.id);
    expect((await p.list(PATHS.chunkPrefix)).length).toBe(2); // shared chunk kept
    const [b] = await v.listVideos();
    const r = await v.deleteVideo(b.id);
    expect(r.removedChunks).toBe(2);
    expect((await p.list(PATHS.chunkPrefix)).length).toBe(0);
  });

  it('describe gives sizes and locators for the service worker', async () => {
    const { v } = await freshVault();
    const m = await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE + 3, 4) });
    const d = await v.describe(m);
    expect(d.chunks.map((c) => c.size)).toEqual([CHUNK_SIZE, 3]);
    expect(d.chunks[0].locator).toBe(PATHS.chunk(m.chunks[0]));
  });
});

describe('copyVault', () => {
  it('copies missing objects verbatim and the copy opens with the same passphrase', async () => {
    const { p, v } = await freshVault();
    await v.uploadVideo({ ...base, blob: video(CHUNK_SIZE + 1, 3) });
    const dst = new MemoryProvider();
    const r1 = await copyVault(p, dst);
    expect(r1.done).toBe(5); // keyring + index + meta + 2 chunks
    expect([...dst.files.keys()].sort()).toEqual([...p.files.keys()].sort());
    const copy = await Vault.open(dst, 'pass');
    expect(await copy.listVideos()).toHaveLength(1);
    // second run only refreshes mutable objects (keyring/index/meta), chunks are skipped
    const r2 = await copyVault(p, dst);
    expect(r2.done).toBe(3);
    // different vault at destination is refused
    const { p: otherP } = await freshVault();
    await expect(copyVault(p, otherP)).rejects.toThrow(/different vault/);
  });
});

describe('folders', () => {
  it('creates, lists with ancestors, moves videos and refuses to delete non-empty folders', async () => {
    const { v } = await freshVault();
    expect(await v.createFolder(' trips / 2024 ')).toBe('trips/2024');
    const m = await v.uploadVideo({ ...base, blob: video(10, 1), folder: 'work/q1' });
    let videos = await v.listVideos();
    expect(videos[0].folder).toBe('work/q1');
    expect(v.folders(videos)).toEqual(['trips', 'trips/2024', 'work', 'work/q1']);
    await expect(v.deleteFolder('work', videos)).rejects.toThrow(/不是空/);
    await expect(v.deleteFolder('trips', videos)).rejects.toThrow(/不是空/);
    await v.moveVideo(m, 'trips/2024');
    videos = await v.listVideos();
    expect(videos[0].folder).toBe('trips/2024');
    expect(v.folders(videos)).toEqual(['trips', 'trips/2024']);
    await v.deleteFolder('trips/2024', videos.map((x) => ({ ...x, folder: '' })));
    expect(v.index.folders).toEqual(['trips']);
    // old metas without `folder` count as root
    expect(v.folders([{ ...m, folder: undefined }])).toEqual(['trips']);
  });
});
