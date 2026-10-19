<script setup lang="ts">
import { ref } from 'vue';
import { useSession } from '../stores/session';
import { formatBytes, formatDuration } from './media';
import UploadDialog from './UploadDialog.vue';
import Icon from './Icon.vue';

const s = useSession();
const showUpload = ref(false);
</script>

<template>
  <div class="page stack">
    <div class="row">
      <h2>我的影片</h2>
      <span class="chip">{{ s.videos.length }} 支</span>
      <span class="spacer" />
      <button class="btn icon" @click="s.refreshVideos()" :disabled="s.loading" title="重新整理"><Icon name="refresh" :size="20" /></button>
      <button class="btn primary" @click="showUpload = true"><Icon name="upload" :size="18" />上傳影片</button>
    </div>
    <p class="muted" v-if="s.loading">載入中…</p>
    <div class="empty" v-else-if="!s.videos.length">
      <Icon name="upload" :size="48" />
      <p>還沒有影片。點右上角「上傳影片」開始。</p>
    </div>
    <div class="grid" v-else>
      <router-link v-for="v in s.videos" :key="v.id" :to="`/watch/${v.id}`" class="tile">
        <div class="thumb">
          <img v-if="v.thumb" :src="v.thumb" :alt="v.title" />
          <div v-else class="nothumb"><Icon name="play" :size="40" /></div>
          <span class="dur">{{ formatDuration(v.duration) }}</span>
        </div>
        <div class="title">{{ v.title }}</div>
        <div class="sub">{{ formatBytes(v.size) }} · {{ new Date(v.createdAt).toLocaleDateString() }}</div>
      </router-link>
    </div>
    <UploadDialog v-if="showUpload" @close="showUpload = false" />
  </div>
</template>
