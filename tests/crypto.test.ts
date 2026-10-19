import { describe, expect, it } from 'vitest';
import { createKeyring, decryptBytes, decryptJson, encryptBytes, encryptJson, generateMasterKey, sha256Hex, unlockKeyring } from '../src/core/crypto';

describe('crypto', () => {
  it('keyring round-trips and rejects wrong passphrase', async () => {
    const master = await generateMasterKey();
    const kr = await createKeyring('correct horse', master, 1000);
    const data = new Uint8Array([1, 2, 3, 4]);
    const enc = await encryptBytes(master, data);
    const unlocked = await unlockKeyring(kr, 'correct horse');
    expect(await decryptBytes(unlocked, enc)).toEqual(data);
    await expect(unlockKeyring(kr, 'wrong')).rejects.toThrow();
  });

  it('encrypts with a fresh IV each time and authenticates', async () => {
    const key = await generateMasterKey();
    const a = await encryptBytes(key, new Uint8Array(100));
    const b = await encryptBytes(key, new Uint8Array(100));
    expect(a).not.toEqual(b);
    a[20] ^= 1;
    await expect(decryptBytes(key, a)).rejects.toThrow();
  });

  it('json helpers', async () => {
    const key = await generateMasterKey();
    expect(await decryptJson(key, await encryptJson(key, { x: 1, s: '中' }))).toEqual({ x: 1, s: '中' });
  });

  it('sha256', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
