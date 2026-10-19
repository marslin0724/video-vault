import type { VideoDescriptor } from '../core/vault';

export type SwSession =
  | { provider: 'gdrive'; token: string; key: CryptoKey }
  | { provider: 'local'; handle: FileSystemDirectoryHandle; key: CryptoKey }
  | { provider: 'opfs'; name: string; key: CryptoKey };

export type PageToSw =
  | { type: 'session'; session: SwSession | null }
  | { type: 'video'; descriptor: VideoDescriptor };

export type SwToPage = { type: 'need-session' } | { type: 'need-video'; id: string };

export const VIDEO_ROUTE = 'vault/video/';
