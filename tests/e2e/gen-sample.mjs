// Generate a small WebM test clip. Playwright's bundled ffmpeg only decodes MJPEG, so frames are
// JPEG-encoded in JS, concatenated into one file and read as an image2pipe sequence (no stdin protocol there).
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jpeg from 'jpeg-js';

const [out, seedArg = '1', seconds = '4', bitrate = '300k'] = process.argv.slice(2);
const seed = Number(seedArg);
const W = 320, H = 180, FPS = 15, frames = Number(seconds) * FPS;
const pwDir = join(homedir(), '.cache/ms-playwright');
// Not every bundled ffmpeg build has libvpx; pick one that does.
const ffmpeg = readdirSync(pwDir)
  .filter((d) => d.startsWith('ffmpeg-'))
  .map((d) => join(pwDir, d, 'ffmpeg-linux'))
  .find((f) => spawnSync(f, ['-hide_banner', '-encoders']).stdout?.toString().includes('libvpx'));
if (!ffmpeg) throw new Error('no Playwright ffmpeg with libvpx found');

const frame = Buffer.alloc(W * H * 4);
const jpegs = [];
for (let f = 0; f < frames; f++) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    frame[i] = (x + f * 3 * seed) & 255;
    frame[i + 1] = (y * 2 + f * seed) & 255;
    frame[i + 2] = ((x ^ y) + f * 5) & 255;
    frame[i + 3] = 255;
  }
  jpegs.push(jpeg.encode({ data: frame, width: W, height: H }, 80).data);
}
const seq = join(tmpdir(), `vv-frames-${process.pid}.mjpeg`);
writeFileSync(seq, Buffer.concat(jpegs));
const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(FPS), '-i', seq, '-c:v', 'libvpx', '-b:v', bitrate, '-pix_fmt', 'yuv420p', out], { stdio: 'inherit' });
ff.on('exit', () => unlinkSync(seq));
ff.on('exit', (code) => process.exit(code ?? 1));
