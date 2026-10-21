<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { copyVault } from '../core/copy';
import type { CopyProgress } from '../core/copy';
import type { StorageProvider } from '../core/types';
import { GoogleDriveProvider } from '../core/storage/gdrive';
import { LocalFolderProvider } from '../core/storage/local';
import { OpfsProvider } from '../core/storage/opfs';
import { formatBytes } from './media';
import Icon from './Icon.vue';

const s = useSession();
const router = useRouter();
const other = ref<StorageProvider | null>(null);
const otherLabel = ref('');
const direction = ref<'export' | 'import'>('export');
const busy = ref(false);
const progress = ref<CopyProgress | null>(null);
const result = ref('');
const error = ref('');
const localSupported = LocalFolderProvider.isSupported();
const isDev = import.meta.env.DEV;

async function connectOther(kind: 'gdrive' | 'local' | 'opfs') {
  error.value = '';
  try {
    if (kind === 'opfs') {
      const name = isDev ? prompt('OPFS 儲存區名稱', 'other') : 'default';
      if (!name) return;
      if (s.provider instanceof OpfsProvider && s.provider.name === name) throw new Error('目前已經是這個瀏覽器內儲存');
      other.value = await OpfsProvider.open(name);
      otherLabel.value = '此裝置（瀏覽器內儲存）';
    } else if (kind === 'gdrive') {
      const p = new GoogleDriveProvider(GoogleDriveProvider.tokenRequester(s.googleClientId()));
      await p.connect();
      other.value = p;
      otherLabel.value = `Google Drive · ${p.user}`;
    } else {
      other.value = await LocalFolderProvider.pick();
      otherLabel.value = '本機資料夾';
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function run() {
  if (!s.provider || !other.value) return;
  busy.value = true;
  error.value = '';
  result.value = '';
  progress.value = null;
  const [src, dst] = direction.value === 'export' ? [s.provider, other.value] : [other.value, s.provider];
  try {
    const p = await copyVault(src, dst, (x) => (progress.value = x));
    result.value = `完成：複製 ${p.done} 個物件，${formatBytes(p.bytes)}`;
    if (direction.value === 'import') await s.refreshVideos();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page stack" style="max-width: 760px">
    <div class="card stack">
      <div class="row"><Icon name="lock" :size="22" /><h2>安全</h2></div>
      <label class="field">
        <span>離開頁面後自動鎖定（切到背景或其他分頁時會先遮住畫面；超過此時間回來需重新輸入 passphrase）</span>
        <select class="input" :value="s.lockDelayMs" @change="s.setLockDelay(Number(($event.target as HTMLSelectElement).value))">
          <option :value="0">立即</option>
          <option :value="60000">1 分鐘</option>
          <option :value="300000">5 分鐘</option>
          <option :value="-1">永不（只遮畫面，不鎖定）</option>
        </select>
      </label>
      <button class="btn" @click="s.lock()"><Icon name="lock" :size="18" />立即鎖定</button>
    </div>

    <div class="card stack">
      <div class="dialog-head">
        <Icon name="swap" :size="22" />
        <h2>複製 / 備份 / 匯入</h2>
        <button class="close-x" @click="router.push('/')" :disabled="busy" title="關閉"><Icon name="close" :size="20" /></button>
      </div>
      <p class="muted">
        把 vault 的 keyring、index、meta 與 chunk 原封不動搬到另一個儲存空間，內容保持加密，只搬缺少的 chunk。
        兩邊必須是同一個 vault（相同 keyring）。
      </p>
      <div class="field">
        <span>另一個儲存空間</span>
        <div class="row">
          <button class="btn" @click="connectOther('gdrive')" :disabled="busy"><Icon name="drive" :size="18" />Google Drive</button>
          <button class="btn" @click="connectOther('opfs')" :disabled="busy || !OpfsProvider.isSupported()"><Icon name="folder" :size="18" />此裝置（瀏覽器內儲存）</button>
          <button v-if="localSupported" class="btn" @click="connectOther('local')" :disabled="busy"><Icon name="folder" :size="18" />本機資料夾</button>
          <span class="chip" v-if="other"><Icon name="check" :size="14" />已連線：{{ otherLabel }}</span>
        </div>
      </div>
      <div class="field">
        <span>方向</span>
        <label class="check"><input type="radio" value="export" v-model="direction" /> 匯出 / 備份：目前 → {{ otherLabel || '另一個' }}</label>
        <label class="check"><input type="radio" value="import" v-model="direction" /> 匯入 / 還原：{{ otherLabel || '另一個' }} → 目前</label>
      </div>
      <button class="btn primary" :disabled="busy || !other" @click="run"><Icon name="swap" :size="18" />{{ busy ? '複製中…' : '開始' }}</button>
      <div v-if="progress" class="stack" style="gap: 8px">
        <div class="progress"><div :style="{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }" /></div>
        <div class="muted">{{ progress.done }} / {{ progress.total }} · {{ formatBytes(progress.bytes) }} · {{ progress.current }}</div>
      </div>
      <p v-if="result">{{ result }}</p>
      <p class="error" v-if="error">{{ error }}</p>
    </div>
  </div>
</template>
