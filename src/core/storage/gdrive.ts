import type { StorageEntry, StorageProvider } from '../types';
import { VAULT_FOLDER_NAME } from '../../config';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type TokenRequester = () => Promise<string>;

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

  constructor(private requestToken: TokenRequester) {}

  /** Service-worker side: only needs a token to download by file id. */
  static fromToken(token: string): GoogleDriveProvider {
    const p = new GoogleDriveProvider(async () => token);
    p.token = token;
    return p;
  }

  /** Obtain an OAuth token through Google Identity Services (page side only). */
  static tokenRequester(clientId: string): TokenRequester {
    return () =>
      new Promise<string>((resolve, reject) => {
        const g = (globalThis as any).google;
        if (!g?.accounts?.oauth2) return reject(new Error('Google Identity Services not loaded'));
        const client = g.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (resp: { access_token?: string; error?: string }) =>
            resp.access_token ? resolve(resp.access_token) : reject(new Error(resp.error ?? 'auth failed')),
          error_callback: (e: { type: string }) => reject(new Error(e.type)),
        });
        client.requestAccessToken();
      });
  }

  get accessToken(): string {
    return this.token;
  }

  async connect(): Promise<void> {
    this.token = await this.requestToken();
    this.folderId = await this.findOrCreateFolder();
    await this.refreshListing();
  }

  private async fetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && retry) {
      this.token = await this.requestToken();
      return this.fetch(url, init, false);
    }
    if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} ${res.status}: ${await res.text()}`);
    return res;
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
