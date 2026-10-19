import type { VideoDescriptor } from '../core/vault';
import { VIDEO_ROUTE } from './protocol';
import type { PageToSw, SwSession, SwToPage } from './protocol';

type VideoResolver = (id: string) => Promise<VideoDescriptor | null>;

let sessionProvider: () => SwSession | null = () => null;
let videoResolver: VideoResolver = async () => null;
let registration: ServiceWorkerRegistration | null = null;

export async function registerSw(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker unsupported');
  const base = import.meta.env.BASE_URL;
  registration = import.meta.env.DEV
    ? await navigator.serviceWorker.register(`${base}src/sw/sw.ts`, { type: 'module', scope: base })
    : await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  await navigator.serviceWorker.ready;
  navigator.serviceWorker.addEventListener('message', async (e) => {
    const msg = e.data as SwToPage;
    if (msg.type === 'need-session') post({ type: 'session', session: sessionProvider() });
    else if (msg.type === 'need-video') {
      const d = await videoResolver(msg.id);
      if (d) post({ type: 'video', descriptor: d });
    }
  });
}

function post(msg: PageToSw) {
  const sw = registration?.active ?? navigator.serviceWorker.controller;
  sw?.postMessage(msg);
}

/** Called by the session store whenever the provider/key changes. */
export function bindSwSession(getSession: () => SwSession | null, resolveVideo: VideoResolver): void {
  sessionProvider = getSession;
  videoResolver = resolveVideo;
  post({ type: 'session', session: getSession() });
}

export function announceVideo(descriptor: VideoDescriptor): void {
  post({ type: 'video', descriptor });
}

export function videoUrl(id: string, download?: { name: string }): string {
  const u = `${location.origin}${import.meta.env.BASE_URL}${VIDEO_ROUTE}${id}`;
  return download ? `${u}?download=1&name=${encodeURIComponent(download.name)}` : u;
}
