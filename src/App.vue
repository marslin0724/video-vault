<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSession } from './stores/session';
import Icon from './ui/Icon.vue';
import LockScreen from './ui/LockScreen.vue';

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
    <span class="chip"><Icon :name="s.provider?.kind === 'gdrive' ? 'drive' : 'folder'" :size="14" />{{ s.providerLabel }}</span>
    <span class="spacer" />
    <router-link to="/tools"><button class="btn"><Icon name="tools" :size="18" />工具</button></router-link>
    <button class="btn icon" @click="logout" title="登出"><Icon name="logout" :size="20" /></button>
  </header>
  <!-- epoch changes on every unlock so views remount and reload what was dropped while locked -->
  <router-view :key="s.epoch" />
  <LockScreen v-if="s.shielded" />
</template>
