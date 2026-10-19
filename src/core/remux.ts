import { REMUX_MAX_BYTES } from '../config';

export interface RemuxResult {
  blob: Blob;
  remuxed: boolean;
  reason?: string;
}

let ffmpegPromise: Promise<any> | undefined;

async function loadFFmpeg(base: string): Promise<any> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(`${base}ffmpeg/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}ffmpeg/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ff;
    })();
    ffmpegPromise.catch(() => (ffmpegPromise = undefined));
  }
  return ffmpegPromise;
}

/**
 * Remux to a faststart MP4 without re-encoding, with deterministic output so the same source
 * always yields identical bytes (keeps dedup working). Falls back to the original on failure.
 */
export async function remuxToFaststartMp4(file: File, base = import.meta.env.BASE_URL, onLog?: (s: string) => void): Promise<RemuxResult> {
  if (file.size > REMUX_MAX_BYTES) return { blob: file, remuxed: false, reason: 'file too large for in-browser remux' };
  try {
    const ff = await loadFFmpeg(base);
    const logHandler = ({ message }: { message: string }) => onLog?.(message);
    ff.on('log', logHandler);
    const inName = 'input';
    const outName = 'output.mp4';
    await ff.mount('WORKERFS', { files: [new File([file], inName)] }, '/in');
    try {
      const rc = await ff.exec([
        '-i', `/in/${inName}`,
        '-map_metadata', '-1',
        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y', outName,
      ]);
      if (rc !== 0) return { blob: file, remuxed: false, reason: `ffmpeg exit ${rc}` };
      const data = (await ff.readFile(outName)) as Uint8Array;
      await ff.deleteFile(outName);
      return { blob: new Blob([data as BufferSource], { type: 'video/mp4' }), remuxed: true };
    } finally {
      ff.off('log', logHandler);
      await ff.unmount('/in').catch(() => {});
    }
  } catch (e) {
    return { blob: file, remuxed: false, reason: (e as Error).message };
  }
}
