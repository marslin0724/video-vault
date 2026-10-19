<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSession } from './stores/session';
import Icon from './ui/Icon.vue';

const s = useSession();
const router = useRouter();
function logout() {
  s.logout();
  router.push('/login');
}
</script>

<template>
  <header class="topbar" v-if="s.vault">
    <router-link class="brand" to="/"><span class="mark"><Icon name="play" :size="16" /></span>video-vault</router-link>
    <span class="chip"><Icon :name="s.provider?.kind === 'gdrive' ? 'drive' : 'folder'" :size="14" />{{ s.provider?.kind === 'gdrive' ? 'Google Drive' : '本機資料夾' }}</span>
    <span class="spacer" />
    <router-link to="/tools"><button class="btn"><Icon name="tools" :size="18" />工具</button></router-link>
    <button class="btn icon" @click="logout" title="登出"><Icon name="logout" :size="20" /></button>
  </header>
  <router-view />
</template>
