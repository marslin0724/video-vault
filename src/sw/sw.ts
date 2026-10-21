/// <reference lib="webworker" />
import { decryptBytes } from '../core/crypto';
import { GoogleDriveProvider } from '../core/storage/gdrive';
import { LocalFolderProvider } from '../core/storage/local';
import { OpfsProvider } from '../core/storage/opfs';
import type { StorageProvider } from '../core/types';
import type { VideoDescriptor } from '../core/vault';
import { chunkOffsets, parseRange, spansFor } from './range';
import { VIDEO_ROUTE } from './protocol';
import type { PageToSw, SwSession, SwToPage } from './protocol';
import { SW_CACHE_BYTES, SW_PREFETCH_AHEAD, SW_PREFETCH_PARALLEL } from '../config';

declare const self: ServiceWorkerGlobalScope;

let session: SwSession | null = null;
let provider: Promise<StorageProvider> | null = null;
const videos = new Map<string, VideoDescriptor>();
const waiters = new Map<string, Array<() => void>>();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e: ExtendableMessageEvent) => {
  const msg = e.data as PageToSw;
  if (msg.type === 'session') {
    session = msg.session;
    provider = session ? makeProvider(session) : null;
    cache.clear();
    wake('session');
  } else if (msg.type === 'video') {
    videos.set(msg.descriptor.id, msg.descriptor);
    wake(`video:${msg.descriptor.id}`);
  }
});

async function makeProvider(s: SwSession): Promise<StorageProvider> {
  if (s.provider === 'gdrive') return GoogleDriveProvider.fromToken(s.token);
  if (s.provider === 'opfs') return OpfsProvider.open(s.name); // the SW opens OPFS itself
  return new LocalFolderProvider(s.handle);
}

function wake(topic: string) {
  waiters.get(topic)?.forEach((fn) => fn());
  waiters.delete(topic);
}

/** Ask every open page for state we lost (the SW may have been restarted) and wait for a reply. */
async function askPages(msg: SwToPage, topic: string, timeoutMs = 5000): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no page answered ${topic}`)), timeoutMs);
    waiters.set(topic, [...(waiters.get(topic) ?? []), () => (clearTimeout(t), resolve())]);
  });
}

async function ensureSession(force = false): Promise<SwSession> {
  if (!session || force) await askPages({ type: 'need-session' }, 'session');
  if (!session) throw new Error('no session');
  return session;
}

async function ensureVideo(id: string): Promise<VideoDescriptor> {
  if (!videos.has(id)) await askPages({ type: 'need-video', id }, `video:${id}`);
  const v = videos.get(id);
  if (!v) throw new Error('unknown video');
  return v;
}

// ---- decrypted chunk cache (LRU by bytes) ----
const cache = new Map<string, { p: Promise<Uint8Array>; size: number; boost?: () => void }>();
let cacheBytes = 0;

function evict(hash: string) {
  const e = cache.get(hash);
  if (!e) return;
  cache.delete(hash);
  cacheBytes -= e.size;
}

/**
 * Fetch + decrypt one chunk (deduped through the cache). Urgent fetches (needed for playback now)
 * start immediately; prefetches wait for a slot so a burst of them cannot starve the urgent one.
 */
function getChunk(hash: string, locator: string, size: number, urgent = true): Promise<Uint8Array> {
  const hit = cache.get(hash);
  if (hit) {
    cache.delete(hash);
    cache.set(hash, hit); // refresh LRU order
    if (urgent) hit.boost?.(); // a queued prefetch that playback now needs jumps the queue
    return hit.p;
  }
  const slot = urgent ? null : acquirePrefetchSlot();
  const p = (async () => {
    if (slot) await slot.wait;
    try {
      const s = await ensureSession();
      let blob: Uint8Array;
      try {
        blob = await (await provider!).getByLocator(locator);
      } catch (e) {
        // token may have expired: ask the page for a fresh session once
        if (!/401/.test(String(e))) throw e;
        await ensureSession(true);
        blob = await (await provider!).getByLocator(locator);
      }
      return await decryptBytes(s.key, blob);
    } finally {
      slot?.release();
    }
  })();
  cache.set(hash, { p, size, boost: slot?.boost });
  cacheBytes += size;
  p.catch(() => evict(hash));
  for (const oldest of cache.keys()) {
    if (cacheBytes <= SW_CACHE_BYTES || oldest === hash) break;
    evict(oldest);
  }
  return p;
}

// ---- prefetch concurrency limiter (urgent fetches bypass it, and can boost a queued prefetch) ----
let prefetchActive = 0;
const prefetchWaiters: Array<() => void> = [];
function acquirePrefetchSlot() {
  let counted = false;
  let done = false;
  let resolve!: () => void;
  const wait = new Promise<void>((r) => (resolve = r));
  const grant = () => {
    if (done) return;
    done = counted = true;
    prefetchActive++;
    resolve();
  };
  if (prefetchActive < SW_PREFETCH_PARALLEL) grant();
  else prefetchWaiters.push(grant);
  return {
    wait,
    boost: () => {
      if (done) return;
      done = true;
      const i = prefetchWaiters.indexOf(grant);
      if (i >= 0) prefetchWaiters.splice(i, 1);
      resolve();
    },
    release: () => {
      if (!counted) return;
      prefetchActive--;
      prefetchWaiters.shift()?.();
    },
  };
}

function prefetchFrom(v: VideoDescriptor, index: number) {
  for (let i = index; i < Math.min(v.chunks.length, index + SW_PREFETCH_AHEAD); i++) {
    const c = v.chunks[i];
    if (!cache.has(c.hash)) void getChunk(c.hash, c.locator, c.size, false).catch(() => {});
  }
}

function streamVideo(v: VideoDescriptor, start: number, end: number): ReadableStream<Uint8Array> {
  const sizes = v.chunks.map((c) => c.size);
  const offsets = chunkOffsets(sizes);
  const spans = spansFor(sizes, offsets, start, end);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= spans.length) return controller.close();
      const span = spans[i++];
      const c = v.chunks[span.index];
      const current = getChunk(c.hash, c.locator, c.size, true);
      prefetchFrom(v, span.index + 1);
      const data = await current;
      controller.enqueue(data.subarray(span.start, span.end));
    },
  });
}

self.addEventListener('fetch', (e: FetchEvent) => {
  const url = new URL(e.request.url);
  const route = self.registration.scope + VIDEO_ROUTE;
  if (!url.href.startsWith(route) || e.request.method !== 'GET') return;
  const id = url.href.slice(route.length).split('?')[0];
  e.respondWith(handleVideo(e.request, id, url.searchParams));
});

async function handleVideo(req: Request, id: string, params: URLSearchParams): Promise<Response> {
  try {
    const v = await ensureVideo(id);
    const headers = new Headers({
      'Content-Type': v.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    if (params.has('download')) {
      const name = params.get('name') || `${v.title}.mp4`;
      headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    const range = parseRange(req.headers.get('Range'), v.size);
    if (!range) {
      headers.set('Content-Length', String(v.size));
      return new Response(streamVideo(v, 0, v.size - 1), { status: 200, headers });
    }
    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${v.size}`);
    return new Response(streamVideo(v, range.start, range.end), { status: 206, headers });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
}
