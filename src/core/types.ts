export type ProviderKind = 'gdrive' | 'local' | 'memory';

export interface StorageEntry {
  path: string;
  size: number;
}

/** Flat object store. Paths use '/' (e.g. "chunks/<sha256>"). */
export interface StorageProvider {
  readonly kind: ProviderKind;
  list(prefix: string): Promise<StorageEntry[]>;
  get(path: string): Promise<Uint8Array>;
  put(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Provider-specific locator (Drive file id, or the path itself) used by the service worker. */
  locate(path: string): Promise<string>;
  getByLocator(locator: string): Promise<Uint8Array>;
}

export interface Keyring {
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  wrapped: { iv: string; data: string };
}

export interface ChunkIndex {
  version: 1;
  chunks: Record<string, { size: number }>;
  /** Explicitly created folders (so empty ones survive); folders also exist implicitly via video.folder. */
  folders?: string[];
}

export interface VideoMeta {
  version: 1;
  id: string;
  title: string;
  originalName: string;
  mime: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  createdAt: string;
  /** Virtual folder path like "trips/2024"; '' or missing = root. */
  folder?: string;
  remuxed: boolean;
  chunkSize: number;
  chunks: string[];
  thumb?: string; // data URL (image/jpeg)
}

export const PATHS = {
  keyring: 'keyring.json',
  index: 'index.json.enc',
  metaPrefix: 'meta/',
  chunkPrefix: 'chunks/',
  meta: (id: string) => `meta/${id}.json.enc`,
  chunk: (hash: string) => `chunks/${hash}`,
} as const;
