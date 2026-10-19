import { LocalFolderProvider } from './local';

/**
 * Origin Private File System: browser-managed storage, works on iPhone Safari where a user folder
 * cannot be picked. Same code paths as LocalFolderProvider on top of the OPFS directory handle.
 */
export class OpfsProvider extends LocalFolderProvider {
  constructor(root: FileSystemDirectoryHandle, readonly name: string) {
    super(root);
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  }

  static async open(name: string): Promise<OpfsProvider> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(name, { create: true });
    // Ask the browser not to evict this origin's data under storage pressure (best effort).
    void navigator.storage.persist?.().catch(() => {});
    return new OpfsProvider(dir, name);
  }

  static async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    } catch {
      return null;
    }
  }
}
