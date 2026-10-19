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
    return new LocalFolderProvider(root);
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
    const w = await fh.createWritable();
    await w.write(data as BufferSource);
    await w.close();
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
