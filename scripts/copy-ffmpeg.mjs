// Copy the single-thread ffmpeg.wasm core into public/ so it is served from our own origin.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules/@ffmpeg/core/dist/umd');
const dst = join(root, 'public/ffmpeg');
mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const s = join(src, f);
  if (!existsSync(s)) throw new Error(`missing ${s}`);
  copyFileSync(s, join(dst, f));
}
