# video-vault

純前端影片庫：切塊 + dedup + AES-GCM 加密 → 可抽換 storage（v1 Google Drive），Service Worker 串流播放。
架構與決策見 PLAN.md，先讀它再動手。

- 技術：Vite + TypeScript + Vue 3 + Pinia，Vitest。
- 核心邏輯（chunker/crypto/index/meta/storage）放 `src/core/`，不得依賴 DOM；UI 放 `src/ui/`；Service Worker 在 `src/sw/`。
- 任何 secret 不進 repo；Google OAuth Client ID 不是 secret，放 `src/config.ts`。
- 儲存版面（keyring.json / index.json.enc / meta/ / chunks/）改動需同步更新 PLAN.md。
