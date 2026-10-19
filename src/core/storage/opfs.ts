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
    let root: FileSystemDirectoryHandle;
    try {
      root = await navigator.storage.getDirectory();
    } catch (e) {
      // Safari/WebKit throws UnknownError here in private browsing, where OPFS is unavailable.
      throw new Error(`瀏覽器內儲存無法使用（${(e as Error).message}）。若是私密/無痕瀏覽模式，請改用一般分頁。`);
    }
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
