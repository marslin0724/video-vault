# video-vault

純前端（GitHub Pages）的個人影片庫。影片在瀏覽器內切塊（4 MiB）、SHA-256 去重、AES-256-GCM 加密後存到你自己的儲存空間（v1：Google Drive、本機資料夾），由 Service Worker 以 HTTP Range 串流解密播放。設計細節見 `PLAN.md`。

## 功能
- 登入 Google Drive（或開啟本機資料夾）後以 passphrase 建立 / 解鎖 vault
- 上傳：可選 remux 成 faststart mp4（ffmpeg.wasm，不重新壓縮）、chunk 去重、加密、並行上傳、進度
- 瀏覽影片、縮圖、播放器（重複播放、速度、快捷鍵、全螢幕、子母畫面）
- 下載原始影片（Chrome / Edge 直接串流寫入磁碟，其他瀏覽器經 Blob）、刪除影片並回收無人引用的 chunk
- 工具頁：vault 在兩個儲存空間之間複製（備份 / 匯出 / 匯入），內容保持加密

## 開發
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 單元測試（Vitest：crypto / chunker / range / vault / copy）
npm run test:e2e   # 端對端測試（Playwright + headless Chromium，見下）
npm run build      # 輸出 dist/（含 sw.js 與 ffmpeg core）
```

### 端對端測試
`npm run test:e2e` 會用 Playwright 附的 ffmpeg 產生兩支 WebM 測試影片，啟動 dev server，在 headless Chromium 中跑完整流程：建立 vault → 上傳（跨多個 chunk）→ 經 Service Worker 串流播放與 seek → 下載並比對 SHA-256 → 重複上傳驗證 dedup → 匯出到另一個儲存區 → 登入該儲存區播放 → 再上傳並匯回 → 刪除影片後共用 chunk 仍可播放。
測試用的儲存後端是「瀏覽器儲存（OPFS）」，只在開發模式出現在登入頁與工具頁，走的程式碼與「本機資料夾」完全相同。第一次執行前需 `npx playwright install chromium`。

## Google OAuth 設定（必要）
登入頁要填的「Google OAuth Client ID」格式如 `123456789012-xxxx.apps.googleusercontent.com`，依下列步驟取得。每一步的網址右上角都要確認選到的是同一個專案。

1. 建立專案：https://console.cloud.google.com/projectcreate
   名稱隨意（例如 video-vault），用你要存影片的那個 Google 帳號登入。
2. 啟用 Google Drive API：https://console.cloud.google.com/apis/library/drive.googleapis.com
3. OAuth 同意畫面：https://console.cloud.google.com/apis/credentials/consent
   - User Type 選 **External**，填應用程式名稱與 email，其他留空。
   - 「測試使用者」加入自己的 Gmail。未送審前只有測試使用者能登入。
   - Scopes 不用填，程式登入時會自己要求 `drive.file`。
4. 建立 OAuth 用戶端 ID：https://console.cloud.google.com/apis/credentials/oauthclient
   - 應用程式類型：**網頁應用程式**
   - 已授權的 JavaScript 來源：`http://localhost:5173`；要上 GitHub Pages 再加 `https://<你的帳號>.github.io`
   - 已授權的重新導向 URI：不用填
5. 查看或複製 Client ID：https://console.cloud.google.com/apis/credentials
   取 `.apps.googleusercontent.com` 結尾那串。「用戶端密鑰」不需要，不要貼進任何地方。

Client ID 不是機密。可在登入頁貼上（存在瀏覽器 localStorage），或建置時以環境變數注入：
```bash
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com npm run build
```
GitHub Actions 會讀取 repository variable `GOOGLE_CLIENT_ID`。

權限範圍只有 `drive.file`：程式只看得到自己建立的 `video-vault/` 資料夾。

### 為什麼一定要用 localhost 或 HTTPS 網域
- Service Worker 與 WebCrypto 只在 secure context 可用：`localhost` 或 `https://`。用 `http://<ip>:5173` 開頁面，解鎖與播放都會失敗。
- Google 的已授權 JavaScript 來源不接受 IP，只接受 localhost 或有公開 TLD 的網域。

在另一台電腦測試內網機器上的 dev server，用 SSH port forward 最簡單：
```bash
ssh -L 5173:localhost:5173 <user>@<dev 機器 ip>
```
然後在本機瀏覽器開 `http://localhost:5173`。

### 登入時常見錯誤
| 錯誤訊息 | 原因 | 處理 |
|---|---|---|
| `401 invalid_client` / `no registered origin` | 網址列的 origin 不在「已授權的 JavaScript 來源」 | 用 `http://localhost:5173` 開頁面；來源要一字不差，不加結尾 `/`，不用 `127.0.0.1`；確認用戶端類型是「網頁應用程式」；剛存檔要等幾分鐘生效 |
| `403 access_denied`「尚未完成 Google 驗證程序」 | 登入的 Google 帳號不在同意畫面的「測試使用者」名單 | 到 OAuth 同意畫面新增該 email；注意 Console 用的帳號和登入影片庫選的帳號可能不同 |
| `origin_mismatch` | 同第一項，常見於用 IP 開頁面 | 改用 localhost 或已登記的網域 |
| `Failed to register a ServiceWorker ... not under the max scope allowed ('/src/sw/')` | 開發模式 SW 檔在 `/src/sw/`，需要 `Service-Worker-Allowed` 標頭 | `vite.config.ts` 已設定；若仍出現，Ctrl+Shift+R 強制重載，或在 DevTools → Application → Service Workers 按 Unregister 後重新整理 |

測試模式下 Google 核發的授權 7 天後失效，到時重新登入即可，資料不受影響。若要免除這個限制，可把同意畫面「發布」為正式狀態；因為只用 `drive.file`（非敏感範圍）不需送審，登入時會多一個「未驗證的應用程式」警告，按「進階」→「前往 video-vault」即可。

## 部署到 GitHub Pages
1. push 到 GitHub，repo Settings → Pages → Source 選 **GitHub Actions**。
2. Settings → Variables 新增 `GOOGLE_CLIENT_ID`（可省略，改在登入頁貼上）。
3. push 到 `main` 即自動建置部署到 `https://<帳號>.github.io/<repo>/`。

## 切換儲存帳號
- 不需要為新帳號重做 Google OAuth 設定。Client ID 屬於應用程式，不屬於帳號，所有帳號共用同一個。
- 應用程式在「測試中」狀態時，只有同意畫面「測試使用者」名單內的帳號能登入，新帳號要先加進去（上限 100 個）。若在同意畫面按「發布應用程式」改成正式狀態，任何帳號都能登入且授權不會 7 天過期；`drive.file` 是非敏感範圍不需送審，只會多一個「未驗證的應用程式」警告。
- 每個儲存帳號各有獨立的 vault，含各自的 keyring 與 passphrase。
- 換帳號：右上角「登出」→ 重新「登入 Google Drive」。登入會強制跳出 Google 帳號選擇畫面，上方工具列會顯示目前連線的帳號 email。
- 把影片搬到另一個帳號：登入 A → 工具頁「另一個儲存空間」選 Google Drive 並在選擇畫面挑帳號 B → 方向選「匯出」。B 若是空的會連 keyring 一起複製，之後用同一組 passphrase 開啟。B 若已有不同的 vault 會被拒絕，避免兩個 vault 混在一起。
- 想離線搬：先匯出到本機資料夾，再登入另一個帳號匯入。

## 儲存版面
```
video-vault/
  keyring.json             salt、PBKDF2 參數、以 passphrase 包起來的 master key
  index.json.enc           chunk hash → size（加密）
  meta/<videoId>.json.enc  影片 metadata、chunk 列表、縮圖（加密）
  chunks/<sha256>          [12-byte IV][AES-GCM ciphertext + tag]
```
Google Drive 上以扁平檔名存放（檔名即路徑），本機資料夾則為實際子目錄。兩者可互相複製。

## 瀏覽器支援
- 播放 / 上傳 / Google Drive：Chrome、Edge、Firefox、Safari 16.4+（含 iPhone）
- 本機資料夾（File System Access API）：僅 Chrome、Edge 桌面版；iPhone 只能用 Google Drive 模式
- iPhone 拍攝的 HEVC 影片上傳後，在 Windows 或桌面版 Chrome 可能無法播放（編碼相容問題，remux 不重新壓縮所以無法解決）
- 可播放的格式取決於瀏覽器：mp4（H.264/AAC）、webm。mov / mkv 內含 H.264/AAC 時經 remux 即可播。

## 已知限制
- passphrase 遺失即無法解密，沒有重設機制。
- 多個分頁同時上傳會互相覆蓋 index（last-writer-wins）。
- remux 僅處理 1 GB 以下檔案（ffmpeg.wasm 記憶體限制），超過則原檔上傳。
- Google access token 有效 1 小時，過期時會再跳一次授權。
