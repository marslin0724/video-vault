// Google OAuth Client ID is public, not a secret. Set VITE_GOOGLE_CLIENT_ID at build time,
// or paste it on the login page (kept in localStorage).
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const VAULT_FOLDER_NAME = 'video-vault';
export const CHUNK_SIZE = 4 * 1024 * 1024;
export const REMUX_MAX_BYTES = 1024 * 1024 * 1024; // ffmpeg.wasm MEMFS limit; larger files skip remux
export const SW_CACHE_BYTES = 96 * 1024 * 1024;
/** Chunks fetched ahead of the one being played, and how many prefetches may run at once. */
export const SW_PREFETCH_AHEAD = 3;
export const SW_PREFETCH_PARALLEL = 3;
