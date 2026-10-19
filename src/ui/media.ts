/** Probe duration/dimensions and grab a thumbnail from a video blob using a hidden <video>. */
export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  thumb?: string;
}

export function probeVideo(blob: Blob): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url;
    const finish = (thumb?: string) => {
      URL.revokeObjectURL(url);
      resolve({ duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight, thumb });
    };
    v.onerror = () => finish();
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(5, (v.duration || 0) * 0.1);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        const w = 320;
        c.width = w;
        c.height = Math.round((w * v.videoHeight) / v.videoWidth) || 180;
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        finish(c.toDataURL('image/jpeg', 0.7));
      } catch {
        finish();
      }
    };
  });
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
