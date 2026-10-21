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
const SESSION_KEY = 'vv.session';

/** What survives a reload. The master key never does; the passphrase is asked again. */
export type StoredSession =
  | { kind: 'gdrive'; token: string; expiresAt: number; user: string }
  | { kind: 'opfs'; name: string }
  | { kind: 'local' };

function loadStored(): StoredSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function store(sess: StoredSession | null) {
  sess ? localStorage.setItem(SESSION_KEY, JSON.stringify(sess)) : localStorage.removeItem(SESSION_KEY);
}

export const useSession = defineStore('session', () => {
  const provider = shallowRef<Provider | null>(null);
  const vault = shallowRef<Vault | null>(null);
  const videos = ref<VideoMeta[]>([]);
  const loading = ref(false);
  const swReady = ref(false);

  const folders = computed(() => (vault.value ? vault.value.folders(videos.value) : []));

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

  async function connectGoogle(opts: { hint?: string } = {}): Promise<Provider> {
    const id = googleClientId();
    if (!id) throw new Error('Google Client ID is not set');
    const p = new GoogleDriveProvider(GoogleDriveProvider.tokenRequester(id));
    await p.connect(opts);
    provider.value = markRaw(p);
    store({ kind: 'gdrive', token: p.accessToken, expiresAt: p.expiresAt, user: p.user });
    return p;
  }

  async function connectLocal(): Promise<Provider> {
    const p = await LocalFolderProvider.pick();
    provider.value = markRaw(p);
    store({ kind: 'local' });
    return p;
  }

  /** The session saved by the last connect, if any. */
  function storedSession(): StoredSession | null {
    return loadStored();
  }

  /**
   * Reconnect the provider from the stored session without user interaction.
   * Returns null when that is impossible (expired token, folder permission needed) so the login
   * page can offer a one-click continuation instead.
   */
  async function resume(): Promise<Provider | null> {
    const st = loadStored();
    if (!st) return null;
    if (st.kind === 'opfs') return connectOpfs(st.name);
    if (st.kind === 'gdrive') {
      if (st.expiresAt - 60_000 < Date.now()) return null;
      const p = new GoogleDriveProvider(GoogleDriveProvider.tokenRequester(googleClientId()));
      try {
        await p.connect({ resume: { token: st.token, expiresAt: st.expiresAt } });
      } catch {
        return null; // token revoked or similar: fall back to an explicit login
      }
      provider.value = markRaw(p);
      store({ kind: 'gdrive', token: p.accessToken, expiresAt: p.expiresAt, user: p.user });
      return p;
    }
    const handle = await LocalFolderProvider.remembered();
    if (!handle || (await (handle as any).queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
    const p = new LocalFolderProvider(handle);
    provider.value = markRaw(p);
    return p;
  }

  /** Local folder whose permission must be re-granted with a click. */
  async function resumeLocalWithPrompt(): Promise<Provider | null> {
    const handle = await LocalFolderProvider.remembered();
    if (!handle) return null;
    const p = await LocalFolderProvider.reopen(handle);
    provider.value = markRaw(p);
    store({ kind: 'local' });
    return p;
  }

  /** Browser-managed storage (OPFS); the only "local" option on iPhone. */
  async function connectOpfs(name = 'default'): Promise<Provider> {
    const p = await OpfsProvider.open(name);
    provider.value = markRaw(p);
    store({ kind: 'opfs', name });
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
    store(null);
    void LocalFolderProvider.forget();
    bindSwSession(() => null, async () => null);
  }

  return {
    provider, vault, videos, loading, providerLabel, folders,
    googleClientId, setGoogleClientId, connectGoogle, connectLocal, connectOpfs, hasVault, unlock, refreshVideos, logout,
    storedSession, resume, resumeLocalWithPrompt,
  };
});
