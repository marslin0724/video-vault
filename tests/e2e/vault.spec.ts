import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PASS = 'test-passphrase-123';
const SAMPLE1 = join(__dirname, 'sample1.webm');
const SAMPLE2 = join(__dirname, 'sample2.webm');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function login(page: Page, store: string, create: boolean) {
  await page.goto('/#/login');
  page.once('dialog', (d) => d.accept(store));
  await page.getByRole('button', { name: /瀏覽器儲存/ }).click();
  await page.getByPlaceholder(/^passphrase/).fill(PASS);
  if (create) await page.getByPlaceholder('再輸入一次').fill(PASS);
  await page.getByRole('button', { name: create ? '建立' : '解鎖', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的影片' })).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  await page.getByTitle('登出').click();
  await expect(page.getByRole('button', { name: /瀏覽器儲存/ })).toBeVisible();
}

async function upload(page: Page, file: string): Promise<string> {
  await page.getByRole('button', { name: '上傳影片' }).click();
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('checkbox').uncheck(); // remux off: headless Chromium has no H.264 anyway, and we test the raw path
  await page.getByRole('button', { name: '開始上傳' }).click();
  await expect(page.getByText('全部完成')).toBeVisible({ timeout: 90_000 });
  const line = await page.locator('.log li').last().innerText();
  await page.getByRole('button', { name: '關閉' }).click();
  return line;
}

async function openFirstVideo(page: Page, title: string) {
  await page.locator('.tile', { hasText: title }).first().click();
  await expect(page).toHaveURL(/#\/watch\//);
}

async function expectPlaying(page: Page) {
  await expect(page.locator('.error')).toHaveCount(0);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 3 && v.currentTime > 0.5 && !v.error;
    },
    null,
    { timeout: 30_000 },
  );
}

async function seekNearEnd(page: Page) {
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.currentTime = v.duration - 1.5;
  });
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video')!;
      return v.readyState >= 3 && v.currentTime > v.duration - 1.5 && !v.error;
    },
    null,
    { timeout: 30_000 },
  );
}

async function copyTo(page: Page, otherStore: string, direction: '匯出' | '匯入') {
  await page.goto('/#/tools');
  page.once('dialog', (d) => d.accept(otherStore));
  await page.getByRole('button', { name: /瀏覽器儲存/ }).click();
  await expect(page.getByText(/已連線/)).toBeVisible();
  await page.getByLabel(new RegExp(direction)).check();
  await page.getByRole('button', { name: '開始', exact: true }).click();
  const done = page.getByText(/^完成：複製 \d+ 個物件/);
  await expect(done).toBeVisible({ timeout: 90_000 });
  return Number(/複製 (\d+) 個/.exec(await done.innerText())![1]);
}

test('upload, stream, download, export/import, dedup, delete', async ({ page }) => {
  const sample1 = readFileSync(SAMPLE1);
  expect(sample1.length).toBeGreaterThan(4 * 1024 * 1024); // must span several chunks

  // --- vault A: create + upload ---
  await login(page, 'store-a', true);
  const log1 = await upload(page, SAMPLE1);
  expect(log1).toMatch(/完成/);
  await expect(page.locator('.tile')).toHaveCount(1);

  // --- playback through the service worker, including a seek across chunks ---
  await openFirstVideo(page, 'sample1');
  await expectPlaying(page);
  await seekNearEnd(page);

  // --- download: the service-worker stream must equal the original file ---
  const videoSrc = (await page.locator('video').getAttribute('src'))!;
  const dl = await page.evaluate(async (u) => {
    const r = await fetch(`${u}?download=1&name=x.webm`);
    const b = new Uint8Array(await r.arrayBuffer());
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
    return { status: r.status, cd: r.headers.get('content-disposition'), len: b.length, sha: Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('') };
  }, videoSrc);
  expect(dl.status).toBe(200);
  expect(dl.cd).toContain('attachment');
  expect(dl.len).toBe(sample1.length);
  expect(dl.sha).toBe(sha256(sample1));
  // The download button: the save-file picker cannot be automated, so force the Blob fallback path.
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載' }).click()]);
  expect(download.suggestedFilename()).toBe('sample1.webm');
  const saved = readFileSync((await download.path())!);
  expect(saved.length).toBe(sample1.length);
  expect(sha256(saved)).toBe(sha256(sample1));

  // --- dedup: uploading the same file again stores nothing new ---
  await page.goto('/#/');
  const log2 = await upload(page, SAMPLE1);
  expect(log2).toMatch(/上傳 0 B/);
  await expect(page.locator('.tile')).toHaveCount(2);

  // --- export A -> B, then open B and play ---
  const copied = await copyTo(page, 'store-b', '匯出');
  expect(copied).toBeGreaterThanOrEqual(5); // keyring + index + 2 meta + chunks
  await logout(page);
  await login(page, 'store-b', false);
  await expect(page.locator('.tile')).toHaveCount(2);
  await openFirstVideo(page, 'sample1');
  await expectPlaying(page);

  // --- B gets a new video, then B -> A (import from A's point of view) ---
  await page.goto('/#/');
  await upload(page, SAMPLE2);
  await expect(page.locator('.tile')).toHaveCount(3);
  await copyTo(page, 'store-a', '匯出');
  await logout(page);
  await login(page, 'store-a', false);
  await expect(page.locator('.tile')).toHaveCount(3);
  await openFirstVideo(page, 'sample2');
  await expectPlaying(page);

  // --- import direction (other -> current) with nothing new only refreshes index/meta ---
  const again = await copyTo(page, 'store-b', '匯入');
  expect(again).toBeGreaterThanOrEqual(3);

  // --- delete one of the two sample1 copies: shared chunks must survive, the other still plays ---
  await page.goto('/#/');
  await openFirstVideo(page, 'sample1');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '刪除' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.tile')).toHaveCount(2);
  await openFirstVideo(page, 'sample1');
  await expectPlaying(page);
  await seekNearEnd(page);
});
