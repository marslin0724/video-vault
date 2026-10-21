<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import Icon from './Icon.vue';

const s = useSession();
const router = useRouter();
const pass = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await s.unlockAgain(pass.value);
    pass.value = '';
  } catch (e) {
    const msg = (e as Error).message;
    // wrong passphrase is an AES-GCM failure; anything else (expired token, lost folder permission) needs a full login
    error.value = /Drive|permission|not connected|存取/.test(msg) ? `無法重新連線：${msg}` : 'passphrase 錯誤';
  } finally {
    busy.value = false;
  }
}

function logout() {
  s.logout();
  router.push('/login');
}
</script>

<template>
  <div class="shield">
    <div class="card stack" style="width: min(400px, 92vw)">
      <div class="brand"><span class="mark"><Icon name="play" :size="16" /></span>video-vault</div>
      <template v-if="s.locked">
        <div class="row"><Icon name="lock" :size="20" /><h3>已鎖定</h3></div>
        <p class="muted">離開頁面後已鎖定，請重新輸入 passphrase。</p>
        <form class="stack" @submit.prevent="submit">
          <input class="input" type="password" v-model="pass" placeholder="passphrase" autofocus autocomplete="current-password" />
          <button class="btn primary block" type="submit" :disabled="busy || !pass">{{ busy ? '解鎖中…' : '解鎖' }}</button>
        </form>
        <p class="error" v-if="error">{{ error }}</p>
        <button class="btn" @click="logout">登出</button>
      </template>
      <p class="muted" v-else>已暫時遮住畫面。</p>
    </div>
  </div>
</template>
