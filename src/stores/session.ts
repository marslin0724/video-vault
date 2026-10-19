import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { Vault } from '../core/vault';
import type { VideoMeta } from '../core/types';
import { GoogleDriveProvider } from '../core/storage/gdrive';
import { LocalFolderProvider } from '../core/storage/local';
import { OpfsProvider } from '../core/storage/opfs';
import { GOOGLE_CLIENT_ID } from '../config';
import { bindSwSession, registerSw } from '../sw/client';
import type { SwSession } from '../sw/protocol';

type Provider = GoogleDriveProvider | LocalFolderProvider | OpfsProvider;
const CLIENT_ID_KEY = 'vv.googleClientId';

export const useSession = defineStore('session', () => {
  const provider = shallowRef<Provider | null>(null);
  const vault = shallowRef<Vault | null>(null);
  const videos = ref<VideoMeta[]>([]);
  const loading = ref(false);
  const swReady = ref(false);

  const providerLabel = computed(() => {
    const p = provider.value;
    if (!p) return '';
    if (p.kind === 'gdrive') return p.user ? `Google Drive · ${p.user}` : 'Google Drive';
    if (p instanceof OpfsProvider) return '瀏覽器內儲存';
    return `本機資料夾 · ${p.root.name}`;
  });

  function googleClientId(): string {
    return GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
  }
  function setGoogleClientId(id: string) {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  }

  async function connectGoogle(): Promise<Provider> {
    const id = googleClientId();
    if (!id) throw new Error('Google Client ID is not set');
    const p = new GoogleDriveProvider(GoogleDriveProvider.tokenRequester(id));
    await p.connect();
    provider.value = markRaw(p);
    return p;
  }

  async function connectLocal(): Promise<Provider> {
    const p = await LocalFolderProvider.pick();
    provider.value = markRaw(p);
    return p;
  }

  /** Browser-managed storage (OPFS); the only "local" option on iPhone. */
  async function connectOpfs(name = 'default'): Promise<Provider> {
    const p = await OpfsProvider.open(name);
    provider.value = markRaw(p);
    return p;
  }

  async function hasVault(): Promise<boolean> {
    if (!provider.value) throw new Error('not connected');
    return Vault.hasKeyring(provider.value);
  }

  async function unlock(passphrase: string, create: boolean) {
    if (!provider.value) throw new Error('not connected');
    const v = create ? await Vault.create(provider.value, passphrase) : await Vault.open(provider.value, passphrase);
    vault.value = markRaw(v);
    await ensureSw();
    await refreshVideos();
  }

  function swSession(): SwSession | null {
    const p = provider.value;
    const v = vault.value;
    if (!p || !v) return null;
    if (p.kind === 'gdrive') return { provider: 'gdrive', token: p.accessToken, key: v.key };
    if (p instanceof OpfsProvider) return { provider: 'opfs', name: p.name, key: v.key };
    return { provider: 'local', handle: p.root, key: v.key };
  }

  async function ensureSw() {
    if (!swReady.value) {
      await registerSw();
      swReady.value = true;
    }
    bindSwSession(swSession, async (id) => {
      const v = vault.value;
      if (!v) return null;
      const meta = videos.value.find((m) => m.id === id) ?? (await v.getVideo(id));
      return v.describe(meta);
    });
  }

  async function refreshVideos() {
    if (!vault.value) return;
    loading.value = true;
    try {
      videos.value = await vault.value.listVideos();
    } finally {
      loading.value = false;
    }
  }

  function logout() {
    vault.value = null;
    provider.value = null;
    videos.value = [];
    bindSwSession(() => null, async () => null);
  }

  return {
    provider, vault, videos, loading, providerLabel,
    googleClientId, setGoogleClientId, connectGoogle, connectLocal, connectOpfs, hasVault, unlock, refreshVideos, logout,
  };
});
