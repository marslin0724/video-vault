<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { LocalFolderProvider } from '../core/storage/local';
import { OpfsProvider } from '../core/storage/opfs';
import { formatBytes } from './media';
import Icon from './Icon.vue';

const s = useSession();
const router = useRouter();
const route = useRoute();
const step = ref<'resume' | 'pick' | 'passphrase'>('resume');
const stored = s.storedSession();
const creating = ref(false);
const pass = ref('');
const pass2 = ref('');
const error = ref('');
const busy = ref(false);
const clientId = ref(s.googleClientId());
const localSupported = LocalFolderProvider.isSupported();

const isDev = import.meta.env.DEV;
const opfsSupported = OpfsProvider.isSupported();
const opfsInfo = ref('');
if (opfsSupported) void OpfsProvider.estimate().then((e) => e && (opfsInfo.value = `已用 ${formatBytes(e.usage)} / 可用約 ${formatBytes(e.quota)}`));

async function afterConnect() {
  creating.value = !(await s.hasVault());
  step.value = 'passphrase';
}

/** Silent reconnect from the stored session; otherwise fall through to the picker with a continue button. */
onMounted(async () => {
  if (!stored) return (step.value = 'pick');
  busy.value = true;
  try {
    if (await s.resume()) await afterConnect();
    else step.value = 'pick';
  } catch (e) {
    error.value = (e as Error).message;
    step.value = 'pick';
  } finally {
    busy.value = false;
  }
});

/** One-click continuation when the stored session needs a user gesture (expired token, folder permission). */
async function continueStored() {
  if (!stored) return;
  error.value = '';
  busy.value = true;
  try {
    if (stored.kind === 'gdrive') await s.connectGoogle({ hint: stored.user });
    else if (stored.kind === 'local') await s.resumeLocalWithPrompt();
    else await s.connectOpfs(stored.name);
    await afterConnect();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function connect(kind: 'gdrive' | 'local' | 'opfs') {
  error.value = '';
  busy.value = true;
  try {
    if (kind === 'gdrive') {
      s.setGoogleClientId(clientId.value);
      await s.connectGoogle();
    } else if (kind === 'opfs') {
      // tests need several independent stores; real users get one
      const name = isDev ? prompt('OPFS 儲存區名稱', 'default') : 'default';
      if (!name) return;
      await s.connectOpfs(name);
    } else {
      await s.connectLocal();
    }
    await afterConnect();
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
    router.push(typeof route.query.redirect === 'string' ? route.query.redirect : '/');
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

      <p class="muted" v-if="step === 'resume'">重新連線中…</p>

      <template v-if="step === 'pick'">
        <button v-if="stored" class="provider" :disabled="busy" @click="continueStored">
          <Icon :name="stored.kind === 'gdrive' ? 'drive' : 'folder'" :size="26" />
          <span>
            <div class="name">繼續上次的儲存空間</div>
            <div class="desc" v-if="stored.kind === 'gdrive'">Google 授權已過期，以 {{ stored.user }} 重新連線</div>
            <div class="desc" v-else-if="stored.kind === 'local'">需要再次允許存取上次選的資料夾</div>
            <div class="desc" v-else>瀏覽器內儲存</div>
          </span>
        </button>
        <label class="field">
          <span>Google OAuth Client ID（設定方式見 README）</span>
          <input class="input" type="text" v-model="clientId" placeholder="xxxx.apps.googleusercontent.com" spellcheck="false" />
        </label>
        <button class="provider" :disabled="busy || !clientId" @click="connect('gdrive')">
          <Icon name="drive" :size="26" />
          <span><div class="name">登入 Google Drive</div><div class="desc">只會存取本程式建立的 video-vault 資料夾</div></span>
        </button>
        <button class="provider" :disabled="busy || !opfsSupported" @click="connect('opfs')">
          <Icon name="folder" :size="26" />
          <span>
            <div class="name">存在此裝置（瀏覽器內儲存）</div>
            <div class="desc">{{ opfsSupported ? `影片存在這台裝置的瀏覽器儲存區，離線可播，iPhone 請選這個；${opfsInfo || ''}` : '此瀏覽器不支援，或處於私密瀏覽模式' }}</div>
          </span>
        </button>
        <button v-if="localSupported" class="provider" :disabled="busy" @click="connect('local')">
          <Icon name="folder" :size="26" />
          <span><div class="name">開啟本機資料夾</div><div class="desc">選一個電腦上的資料夾，適合備份、匯入匯出（Chrome / Edge 桌面版）</div></span>
        </button>
      </template>

      <form v-else class="stack" @submit.prevent="submit">
        <div class="dialog-head">
          <Icon name="lock" :size="20" />
          <h3>{{ creating ? '建立 vault' : '解鎖 vault' }}</h3>
          <button class="close-x" type="button" @click="step = 'pick'" :disabled="busy" title="返回"><Icon name="close" :size="20" /></button>
        </div>
        <p class="muted" v-if="creating">這個儲存空間還沒有 vault。設定一組 passphrase 來建立，遺失即無法解密，請妥善保存。</p>
        <p class="muted" v-else>輸入 passphrase 解鎖。</p>
        <input class="input" type="password" v-model="pass" placeholder="passphrase（至少 8 個字元）" autofocus />
        <input v-if="creating" class="input" type="password" v-model="pass2" placeholder="再輸入一次" />
        <button class="btn primary block" type="submit" :disabled="busy">{{ busy ? '處理中…' : creating ? '建立' : '解鎖' }}</button>
      </form>

      <p class="error" v-if="error">{{ error }}</p>
      <p class="muted" v-if="busy && step === 'pick'">連線中…</p>
    </div>
  </div>
</template>
