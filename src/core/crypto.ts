import type { Keyring } from './types';

const IV_BYTES = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function deriveKek(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createKeyring(passphrase: string, master: CryptoKey, iterations = 600_000): Promise<Keyring> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKek(passphrase, salt, iterations);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', master));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw as BufferSource));
  return {
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    wrapped: { iv: toB64(iv), data: toB64(data) },
  };
}

/** Throws on wrong passphrase (AES-GCM tag mismatch). */
export async function unlockKeyring(keyring: Keyring, passphrase: string): Promise<CryptoKey> {
  const kek = await deriveKek(passphrase, fromB64(keyring.kdf.salt), keyring.kdf.iterations);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(keyring.wrapped.iv) as BufferSource },
    kek,
    fromB64(keyring.wrapped.data) as BufferSource,
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Output layout: [12-byte IV][ciphertext + 16-byte tag]. */
export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  const iv = blob.subarray(0, IV_BYTES);
  const ct = blob.subarray(IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource));
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Uint8Array> {
  return encryptBytes(key, enc.encode(JSON.stringify(value)));
}

export async function decryptJson<T>(key: CryptoKey, blob: Uint8Array): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(key, blob))) as T;
}

export const utf8 = { encode: (s: string) => enc.encode(s), decode: (b: Uint8Array) => dec.decode(b) };
