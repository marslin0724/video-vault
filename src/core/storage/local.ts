import type { StorageEntry, StorageProvider } from '../types';

/** Local folder via the File System Access API. Works in the page and in the service worker. */
export class LocalFolderProvider implements StorageProvider {
  readonly kind = 'local' as const;
  constructor(readonly root: FileSystemDirectoryHandle) {}

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  static async pick(): Promise<LocalFolderProvider> {
    const root = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await rememberHandle(root);
    return new LocalFolderProvider(root);
  }

  /** The folder picked last time, if the browser still has permission (or can ask for it on a click). */
  static async remembered(): Promise<FileSystemDirectoryHandle | null> {
    return loadHandle();
  }

  static async forget(): Promise<void> {
    await rememberHandle(null);
  }

  static async reopen(handle: FileSystemDirectoryHandle): Promise<LocalFolderProvider> {
    const h = handle as any;
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('沒有資料夾存取權限');
    }
    return new LocalFolderProvider(handle);
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  private split(path: string): { dirs: string[]; name: string } {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`invalid path: ${path}`);
    return { dirs: parts, name };
  }

  async list(prefix: string): Promise<StorageEntry[]> {
    const out: StorageEntry[] = [];
    const walk = async (d: FileSystemDirectoryHandle, base: string) => {
      for await (const [name, h] of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        const path = base ? `${base}/${name}` : name;
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, path);
        else if (path.startsWith(prefix)) out.push({ path, size: (await (h as FileSystemFileHandle).getFile()).size });
      }
    };
    await walk(this.root, '');
    return out;
  }

  async get(path: string): Promise<Uint8Array> {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    const fh = await d.getFileHandle(name);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, true);
    const fh = await d.getFileHandle(name, { create: true });
    if (typeof (fh as any).createWritable === 'function') {
      const w = await fh.createWritable();
      await w.write(data as BufferSource);
      await w.close();
    } else {
      await writeViaSyncAccessHandle(d, name, data); // Safari: no createWritable on the main thread
    }
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = this.split(path);
    const d = await this.dir(dirs, false);
    await d.removeEntry(name);
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { dirs, name } = this.split(path);
      const d = await this.dir(dirs, false);
      await d.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async locate(path: string): Promise<string> {
    return path;
  }
  getByLocator(locator: string): Promise<Uint8Array> {
    return this.get(locator);
  }
}

// Safari (incl. iPhone) lacks FileSystemFileHandle.createWritable but offers createSyncAccessHandle
// inside workers. The worker is built from a string so no bundler plumbing is needed in the SW build.
const syncWriterSource = `
self.onmessage = async (e) => {
  const { dir, name, data } = e.data;
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const h = await fh.createSyncAccessHandle();
    try {
      h.truncate(0);
      h.write(data, { at: 0 });
      h.flush();
    } finally {
      h.close();
    }
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};`;
let syncWriter: Worker | undefined;
let syncQueue: Promise<void> = Promise.resolve();

function writeViaSyncAccessHandle(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<void> {
  syncWriter ??= new Worker(URL.createObjectURL(new Blob([syncWriterSource], { type: 'text/javascript' })));
  const run = () =>
    new Promise<void>((resolve, reject) => {
      const w = syncWriter!;
      w.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) => (e.data.ok ? resolve() : reject(new Error(e.data.error)));
      w.onerror = (e) => reject(new Error(e.message));
      w.postMessage({ dir, name, data });
    });
  // one write at a time: the worker handles a single message/response pair
  syncQueue = syncQueue.then(run, run);
  return syncQueue;
}

// Directory handles survive reloads only inside IndexedDB (structured clone), not localStorage.
const DB = 'video-vault';
const STORE = 'handles';
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function rememberHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    handle ? tx.objectStore(STORE).put(handle, 'local') : tx.objectStore(STORE).delete('local');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get('local');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
