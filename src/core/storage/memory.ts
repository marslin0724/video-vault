import type { StorageEntry, StorageProvider } from '../types';

/** In-memory provider for tests. */
export class MemoryProvider implements StorageProvider {
  readonly kind = 'memory' as const;
  readonly files = new Map<string, Uint8Array>();

  async list(prefix: string): Promise<StorageEntry[]> {
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([path, d]) => ({ path, size: d.length }));
  }
  async get(path: string): Promise<Uint8Array> {
    const d = this.files.get(path);
    if (!d) throw new Error(`not found: ${path}`);
    return d;
  }
  async put(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async locate(path: string): Promise<string> {
    return path;
  }
  getByLocator(locator: string): Promise<Uint8Array> {
    return this.get(locator);
  }
}
