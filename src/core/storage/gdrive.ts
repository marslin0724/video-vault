import type { StorageEntry, StorageProvider } from '../types';
import { VAULT_FOLDER_NAME } from '../../config';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Needed only to browse the user's own videos for import; requested on demand, not at login. */
const SCOPE_READ = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface TokenInfo {
  token: string;
  expiresAt: number; // epoch ms
}
/**
 * `selectAccount` forces Google's account chooser; `hint` pre-selects an account for a silent refresh;
 * `read` also asks for drive.readonly (incremental consent, previously granted scopes are kept).
 */
export type TokenRequester = (opts?: { selectAccount?: boolean; hint?: string; read?: boolean }) => Promise<TokenInfo>;

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isFolder: boolean;
}

interface DriveFile {
  id: string;
  name: string;
  size?: string;
}

/**
 * Google Drive provider. All vault objects live as flat files in one folder; the file name is the
 * vault path (e.g. "chunks/<sha256>"). A name->id cache is filled by listing the folder on connect.
 */
export class GoogleDriveProvider implements StorageProvider {
  readonly kind = 'gdrive' as const;
  private ids = new Map<string, DriveFile>();
  private folderId = '';
  private token = '';
  expiresAt = 0;
  /** Email of the signed-in Google account, filled by connect(). */
  user = '';
  private hasReadScope = false;

  constructor(private requestToken: TokenRequester) {}

  /** Service-worker side: only needs a token to download by file id. */
  static fromToken(token: string): GoogleDriveProvider {
    const p = new GoogleDriveProvider(async () => ({ token, expiresAt: 0 }));
    p.token = token;
    return p;
  }

  /** Obtain an OAuth token through Google Identity Services (page side only). */
  static tokenRequester(clientId: string): TokenRequester {
    return (opts) =>
      new Promise<TokenInfo>((resolve, reject) => {
        const g = (globalThis as any).google;
        if (!g?.accounts?.oauth2) return reject(new Error('Google Identity Services not loaded'));
        const client = g.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: opts?.read ? `${SCOPE} ${SCOPE_READ}` : SCOPE,
          include_granted_scopes: true,
          callback: (resp: { access_token?: string; expires_in?: number; error?: string }) =>
            resp.access_token
              ? resolve({ token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 })
              : reject(new Error(resp.error ?? 'auth failed')),
          error_callback: (e: { type: string }) => reject(new Error(e.type)),
        });
        client.requestAccessToken({ prompt: opts?.selectAccount ? 'select_account' : '', hint: opts?.hint });
      });
  }

  /** Download any Drive file the token can read (e.g. one the user picked) with byte progress. */
  static async downloadFile(token: string, id: string, onProgress?: (bytes: number) => void): Promise<Blob> {
    const res = await fetch(`${API}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw new Error(`Drive download ${res.status}: ${await res.text()}`);
    let received = 0;
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.length;
          onProgress?.(received);
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(counted).blob();
  }

  /** Ask for drive.readonly once (Google shows a consent screen only the first time). */
  async ensureReadScope(): Promise<void> {
    if (this.hasReadScope) return;
    await this.refreshToken({ hint: this.user || undefined, read: true });
    this.hasReadScope = true;
  }

  static fromReadToken(token: string): GoogleDriveProvider {
    const p = GoogleDriveProvider.fromToken(token);
    p.hasReadScope = true;
    return p;
  }

  /** Folders and video files under `parent` ('root' for My Drive), folders first. Needs the read scope. */
  async browse(parent: string): Promise<DriveEntry[]> {
    const q = `'${parent}' in parents and trashed=false and (mimeType contains 'video/' or mimeType='${FOLDER_MIME}')`;
    return this.listEntries(q);
  }

  /** Video files anywhere in the Drive whose name contains `text`. */
  async searchVideos(text: string): Promise<DriveEntry[]> {
    const safe = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return this.listEntries(`name contains '${safe}' and trashed=false and mimeType contains 'video/'`);
  }

  private async listEntries(q: string): Promise<DriveEntry[]> {
    const out: DriveEntry[] = [];
    let pageToken = '';
    do {
      const url = `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,size)&orderBy=folder,name&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const page = (await (await this.fetch(url)).json()) as { files: (DriveFile & { mimeType: string })[]; nextPageToken?: string };
      for (const f of page.files) out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), isFolder: f.mimeType === FOLDER_MIME });
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  /** Download any Drive file the token can read with byte progress (instance form of downloadFile). */
  download(id: string, onProgress?: (bytes: number) => void): Promise<Blob> {
    return GoogleDriveProvider.downloadFile(this.token, id, onProgress);
  }

  get accessToken(): string {
    return this.token;
  }

  /**
   * Connect with a fresh token (account chooser), a stored one (`resume`), or a silent refresh for a
   * known account (`hint`).
   */
  async connect(opts: { resume?: TokenInfo; hint?: string } = {}): Promise<void> {
    if (opts.resume && opts.resume.expiresAt > Date.now()) {
      this.token = opts.resume.token;
      this.expiresAt = opts.resume.expiresAt;
    } else {
      await this.refreshToken(opts.hint ? { hint: opts.hint } : { selectAccount: true });
    }
    const about = (await (await this.fetch(`${API}/about?fields=user(emailAddress)`)).json()) as { user?: { emailAddress?: string } };
    this.user = about.user?.emailAddress ?? '';
    this.folderId = await this.findOrCreateFolder();
    await this.refreshListing();
  }

  private async fetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && retry) {
      await this.refreshToken({ hint: this.user || undefined });
      return this.fetch(url, init, false);
    }
    if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} ${res.status}: ${await res.text()}`);
    return res;
  }

  private async refreshToken(opts: Parameters<TokenRequester>[0]): Promise<void> {
    const t = await this.requestToken(opts);
    this.token = t.token;
    this.expiresAt = t.expiresAt;
  }

  private async findOrCreateFolder(): Promise<string> {
    const q = encodeURIComponent(`name='${VAULT_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const found = (await (await this.fetch(`${API}/files?q=${q}&fields=files(id)`)).json()) as { files: DriveFile[] };
    if (found.files.length) return found.files[0].id;
    const created = await this.fetch(`${API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: VAULT_FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    return ((await created.json()) as DriveFile).id;
  }

  private async refreshListing(): Promise<void> {
    this.ids.clear();
    let pageToken = '';
    do {
      const q = encodeURIComponent(`'${this.folderId}' in parents and trashed=false`);
      const url = `${API}/files?q=${q}&fields=nextPageToken,files(id,name,size)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const page = (await (await this.fetch(url)).json()) as { files: DriveFile[]; nextPageToken?: string };
      for (const f of page.files) this.ids.set(f.name, f);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
  }

  async list(prefix: string): Promise<StorageEntry[]> {
    return [...this.ids.values()].filter((f) => f.name.startsWith(prefix)).map((f) => ({ path: f.name, size: Number(f.size ?? 0) }));
  }

  async get(path: string): Promise<Uint8Array> {
    return this.getByLocator(await this.locate(path));
  }

  async getByLocator(id: string): Promise<Uint8Array> {
    const res = await this.fetch(`${API}/files/${id}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const existing = this.ids.get(path);
    if (existing) {
      await this.fetch(`${UPLOAD}/files/${existing.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data as BufferSource,
      });
      existing.size = String(data.length);
      return;
    }
    const boundary = 'vv' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name: path, parents: [this.folderId] }),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      data as BufferSource,
      `\r\n--${boundary}--`,
    ]);
    const res = await this.fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    this.ids.set(path, (await res.json()) as DriveFile);
  }

  async remove(path: string): Promise<void> {
    const f = this.ids.get(path);
    if (!f) return;
    await this.fetch(`${API}/files/${f.id}`, { method: 'DELETE' });
    this.ids.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.ids.has(path);
  }

  async locate(path: string): Promise<string> {
    const f = this.ids.get(path);
    if (!f) throw new Error(`not found: ${path}`);
    return f.id;
  }
}
