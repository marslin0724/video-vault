<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { LocalFolderProvider } from '../core/storage/local';
import Icon from './Icon.vue';

const s = useSession();
const router = useRouter();
const step = ref<'pick' | 'passphrase'>('pick');
const creating = ref(false);
const pass = ref('');
const pass2 = ref('');
const error = ref('');
const busy = ref(false);
const clientId = ref(s.googleClientId());
const localSupported = LocalFolderProvider.isSupported();

const isDev = import.meta.env.DEV;

async function connect(kind: 'gdrive' | 'local' | 'opfs') {
  error.value = '';
  busy.value = true;
  try {
    if (kind === 'gdrive') {
      s.setGoogleClientId(clientId.value);
      await s.connectGoogle();
    } else if (kind === 'opfs') {
      const name = prompt('OPFS 儲存區名稱', 'default');
      if (!name) return;
      await s.connectOpfs(name);
    } else {
      await s.connectLocal();
    }
    creating.value = !(await s.hasVault());
    step.value = 'passphrase';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function submit() {
  error.value = '';
  if (creating.value && pass.value !== pass2.value) return (error.value = '兩次輸入的 passphrase 不一致');
  if (pass.value.length < 8) return (error.value = 'passphrase 至少 8 個字元');
  busy.value = true;
  try {
    await s.unlock(pass.value, creating.value);
    router.push('/');
  } catch (e) {
    error.value = creating.value ? (e as Error).message : 'passphrase 錯誤或 vault 損毀';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="card stack">
      <div>
        <div class="brand"><span class="mark"><Icon name="play" :size="16" /></span>video-vault</div>
        <p class="muted">影片切塊、加密後存在你自己的儲存空間，瀏覽器直接串流播放。</p>
      </div>

      <template v-if="step === 'pick'">
        <label class="field">
          <span>Google OAuth Client ID（設定方式見 README）</span>
          <input class="input" type="text" v-model="clientId" placeholder="xxxx.apps.googleusercontent.com" spellcheck="false" />
        </label>
        <button class="provider" :disabled="busy || !clientId" @click="connect('gdrive')">
          <Icon name="drive" :size="26" />
          <span><div class="name">登入 Google Drive</div><div class="desc">只會存取本程式建立的 video-vault 資料夾</div></span>
        </button>
        <button class="provider" :disabled="busy || !localSupported" @click="connect('local')">
          <Icon name="folder" :size="26" />
          <span><div class="name">開啟本機資料夾</div><div class="desc">{{ localSupported ? '適合備份、匯入匯出' : '此瀏覽器不支援（需 Chrome / Edge 桌面版）' }}</div></span>
        </button>
        <button v-if="isDev" class="provider" :disabled="busy" @click="connect('opfs')">
          <Icon name="folder" :size="26" />
          <span><div class="name">瀏覽器儲存（測試用）</div><div class="desc">Origin Private File System，僅開發模式</div></span>
        </button>
      </template>

      <form v-else class="stack" @submit.prevent="submit">
        <div class="row"><Icon name="lock" :size="20" /><h3>{{ creating ? '建立 vault' : '解鎖 vault' }}</h3></div>
        <p class="muted" v-if="creating">這個儲存空間還沒有 vault。設定一組 passphrase 來建立，遺失即無法解密，請妥善保存。</p>
        <p class="muted" v-else>輸入 passphrase 解鎖。</p>
        <input class="input" type="password" v-model="pass" placeholder="passphrase（至少 8 個字元）" autofocus />
        <input v-if="creating" class="input" type="password" v-model="pass2" placeholder="再輸入一次" />
        <button class="btn primary block" type="submit" :disabled="busy">{{ busy ? '處理中…' : creating ? '建立' : '解鎖' }}</button>
        <button class="btn" type="button" @click="step = 'pick'" :disabled="busy">返回</button>
      </form>

      <p class="error" v-if="error">{{ error }}</p>
      <p class="muted" v-if="busy && step === 'pick'">連線中…</p>
    </div>
  </div>
</template>
