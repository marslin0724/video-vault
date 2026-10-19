# video-vault 計畫

純前端（GitHub Pages 靜態站）的個人影片庫：影片切塊、去重、加密後存到可抽換的儲存後端（第一版 Google Drive），在瀏覽器內串流播放。

## 1. 整體架構

```
Browser (GitHub Pages, HTTPS)
├─ UI (Vue 3 + TypeScript, Vite 打包)
│   ├─ Login：選擇 storage provider → Google 登入 → 輸入 passphrase 解鎖
│   ├─ Library：影片格狀列表（縮圖、標題、長度、大小）
│   ├─ Player：類 YouTube 播放器（loop / 速度 / 快捷鍵 / 全螢幕 / PiP）
│   ├─ Upload：選檔 → 切塊 → hash → dedup → 加密 → 上傳（進度、並行）
│   └─ Tools：下載、Copy/備份到另一 provider、Export / Import
├─ Core（與 UI 無關的純邏輯，可單元測試）
│   ├─ chunker      固定大小切塊（4 MiB）
│   ├─ crypto       AES-256-GCM（WebCrypto），PBKDF2 解開 master key
│   ├─ index        chunk hash → {fileId, size} 的全域索引
│   ├─ meta         每支影片的 metadata（標題、chunk 列表、縮圖…）
│   └─ storage/     StorageProvider 介面 + GoogleDriveProvider + LocalFolderProvider
└─ Service Worker（sw.js）
    └─ 攔截 /vault/video/<id> 的 HTTP Range 請求 → 對應到 chunk → 抓取/解密/快取 → 回傳
```

### 播放方式：Service Worker + Range（不使用 MSE）
`<video src="/vault/video/<id>">` 由瀏覽器自己發 Range 請求，Service Worker 把 byte range 對應到 chunk，向 Drive 抓加密 chunk、解密後回應。優點：
- 不需要 fMP4 / ffmpeg.wasm 轉檔，mp4 / webm 原檔即可播，seek 由瀏覽器原生處理。
- 下載功能直接重用同一條路徑（加 `Content-Disposition: attachment`），不會把整支影片塞進記憶體。
- SW 內做「下一個 chunk 預取」+ 記憶體 LRU（解密後的 chunk，約 64 MiB），確保播放順暢。
上傳時預設用 ffmpeg.wasm remux 成 faststart mp4（`-c copy -movflags +faststart`），讓 moov 在檔頭、mov/mkv 內的 H.264/AAC 也能播；不做 transcode（瀏覽器內太慢）。單檔超過 wasm 記憶體上限（約 2 GB）時跳過 remux 原檔上傳。

### 加密與 dedup 如何並存
- Chunk ID = SHA-256(明文 chunk)。上傳前先查 index，已存在就跳過（這就是 dedup，也順便讓中斷後重傳自動續傳）。
- 每個 chunk 用 master key + 隨機 12-byte IV 做 AES-256-GCM，IV 放在檔頭。WebCrypto 有硬體加速，4 MiB 解密約數 ms，不影響播放。
- master key 為隨機 256-bit，用 passphrase 經 PBKDF2-SHA256（600k 次）派生的 key 包起來存成 `keyring.json`。index 與 meta 也用 master key 加密。
- Google access token 與 master key 只留在記憶體（不進 localStorage）。

### 儲存版面（Drive 內 `video-vault/` 資料夾，其他 provider 相同結構）
```
keyring.json            salt、KDF 參數、wrapped master key（明文 JSON）
index.json.enc          { chunks: { "<sha256>": { size } }, folders: ["trips", "trips/2024"] }
meta/<videoId>.json.enc { title, size, mime, duration, createdAt, folder, thumb(base64 jpeg), chunks: ["<sha256>", ...] }
chunks/<sha256>         加密後的 chunk 二進位（IV + ciphertext + tag）
```
三種物件分開存，Copy/Export/Import 就是把這些物件原封搬移，不需解密。

### StorageProvider 介面
```ts
interface StorageProvider {
  id: 'gdrive' | 'local';
  connect(): Promise<void>;
  put(path: string, data: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  list(prefix: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}
```
- `GoogleDriveProvider`：Google Identity Services token client，scope `drive.file`（只看得到本 app 建立的檔案）。上傳用 multipart（chunk < 5 MB）；下載 `files/{id}?alt=media`。
- `LocalFolderProvider`：File System Access API 指到本機資料夾。同時用來做 Export/Import 與備份。
- Copy = 從 provider A `list` → `get` → provider B `put`，加密內容原樣搬，可選擇只搬缺少的物件。

### Google 端前置作業（需要你自己做）
1. Google Cloud Console 建一個 OAuth 2.0 Client ID（Web application）。
2. Authorized JavaScript origins 加入 `https://<user>.github.io` 與 `http://localhost:5173`。
3. 啟用 Google Drive API。Client ID 不是機密，放在 `src/config.ts`。
4. 應用未經 Google 審核時會有「未驗證的應用程式」警告，把自己加為 test user 即可。

## 2. 技術選擇
| 項目 | 選擇 | 理由 |
|---|---|---|
| 建置 | Vite + TypeScript | 靜態輸出，GitHub Actions 部署到 Pages |
| UI | Vue 3（Composition API）+ Pinia | 使用者偏好；狀態（登入、索引、上傳進度）集中於 store |
| 播放器 | 原生 `<video>` + 自製控制列 | 需要自訂 loop、快捷鍵，避免大型播放器相依 |
| 加密/雜湊 | WebCrypto | 內建、硬體加速 |
| 測試 | Vitest | chunker / crypto / index / copy 邏輯用 in-memory provider 測 |

## 3. 里程碑
1. **M1 骨架**：Vite 專案、Provider 介面、Google 登入、建立 `video-vault/` 資料夾、keyring 建立與解鎖。
2. **M2 上傳**：remux（faststart，可關閉）、切塊、hash、dedup、加密、並行上傳、進度、縮圖、寫 meta/index。
3. **M3 播放**：Service Worker Range 服務、Library 列表、播放器（loop、速度、快捷鍵、全螢幕、PiP）。
4. **M4 下載 + 刪除**：SW 下載路徑；刪除影片並回收無人引用的 chunk。
5. **M5 Copy / Export / Import**：LocalFolderProvider、provider 間複製、匯入既有 vault。
6. **M6 部署**：GitHub Actions → Pages，README 寫 Google OAuth 設定步驟。

## 4. 已知取捨與風險
- 固定大小切塊：同一檔案重傳可完整 dedup；不同檔案只有部分相同內容時 dedup 率低。之後可換 content-defined chunking（FastCDC），索引格式不用變。
- index.json 單檔：每 GB 影片約 30 KB，100 GB 約 3 MB，第一版可接受。多分頁同時上傳會 last-writer-wins，第一版假設單一分頁操作。
- Drive API 配額：每個 chunk 一次請求，4 MiB chunk 下 1 GB 影片約 256 次，遠低於限額。
- Service Worker 需要 HTTPS 或 localhost，GitHub Pages 符合。
- Safari 對 File System Access API 支援不全，LocalFolderProvider 在 Safari 退化為 zip 下載/上傳（M5 再決定）。

## 5. 討論紀錄
- **切塊**：v1 固定 4 MiB。FastCDC（content-defined chunking）只在「同一影片的不同版本」才有明顯 dedup 收益，且 Range 對應需改成偏移量二分搜尋；index 已預留每塊 `size`，日後可換而不遷移資料。
- **轉檔**：v1 做 remux（ffmpeg.wasm，faststart，預設開啟可關閉），併入 M2。不做 transcode（瀏覽器內 1080p 約 0.1 到 0.3 倍速）；需要壓縮請上傳前在電腦用 HandBrake/ffmpeg 處理。
- **UI 框架**：Vue 3 + Pinia（使用者偏好）。
