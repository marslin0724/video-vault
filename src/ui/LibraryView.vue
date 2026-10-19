<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { formatBytes, formatDuration } from './media';
import UploadDialog from './UploadDialog.vue';
import FolderCrumbs from './FolderCrumbs.vue';
import Icon from './Icon.vue';

const s = useSession();
const route = useRoute();
const router = useRouter();
const showUpload = ref(false);
const error = ref('');

/** Current folder comes from the URL so reload/back keep the place. */
const folder = computed(() => (typeof route.query.folder === 'string' ? route.query.folder : ''));
function go(f: string) {
  router.push(f ? { path: '/', query: { folder: f } } : { path: '/' });
}

const videosHere = computed(() => s.videos.filter((v) => (v.folder ?? '') === folder.value));
const subfolders = computed(() => {
  const prefix = folder.value ? folder.value + '/' : '';
  return s.folders
    .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
    .map((path) => ({
      path,
      name: path.slice(prefix.length),
      count: s.videos.filter((v) => (v.folder ?? '') === path || (v.folder ?? '').startsWith(path + '/')).length,
    }));
});

async function createFolder() {
  const name = prompt('新資料夾名稱');
  if (!name) return;
  error.value = '';
  try {
    const path = await s.vault!.createFolder(folder.value ? `${folder.value}/${name}` : name);
    await s.refreshVideos();
    go(path);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function deleteFolder(path: string) {
  if (!confirm(`刪除空資料夾「${path}」？`)) return;
  error.value = '';
  try {
    await s.vault!.deleteFolder(path, s.videos);
    await s.refreshVideos();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="page stack">
    <div class="row">
      <FolderCrumbs :folder="folder" @navigate="go" />
      <span class="chip">{{ videosHere.length }} 支</span>
      <span class="spacer" />
      <button class="btn" @click="createFolder"><Icon name="folderAdd" :size="18" />新增資料夾</button>
      <button class="btn icon" @click="s.refreshVideos()" :disabled="s.loading" title="重新整理"><Icon name="refresh" :size="20" /></button>
      <button class="btn primary" @click="showUpload = true"><Icon name="upload" :size="18" />上傳影片</button>
    </div>
    <p class="error" v-if="error">{{ error }}</p>
    <p class="muted" v-if="s.loading">載入中…</p>
    <template v-else>
      <template v-if="subfolders.length">
        <div class="section-title">資料夾</div>
        <div class="folders">
          <div v-for="f in subfolders" :key="f.path" class="folder" @click="go(f.path)">
            <Icon name="folder" :size="24" />
            <span class="name">{{ f.name }}</span>
            <span class="count">{{ f.count }} 支</span>
            <button v-if="!f.count" class="close-x" @click.stop="deleteFolder(f.path)" title="刪除空資料夾"><Icon name="trash" :size="16" /></button>
          </div>
        </div>
      </template>
      <div class="section-title" v-if="subfolders.length && videosHere.length">影片</div>
      <div class="empty" v-if="!videosHere.length && !subfolders.length">
        <Icon name="upload" :size="48" />
        <p>{{ folder ? '這個資料夾還沒有影片。' : '還沒有影片。點右上角「上傳影片」開始。' }}</p>
      </div>
      <div class="grid" v-else-if="videosHere.length">
        <router-link v-for="v in videosHere" :key="v.id" :to="`/watch/${v.id}`" class="tile">
          <div class="thumb">
            <img v-if="v.thumb" :src="v.thumb" :alt="v.title" />
            <div v-else class="nothumb"><Icon name="play" :size="40" /></div>
            <span class="dur">{{ formatDuration(v.duration) }}</span>
          </div>
          <div class="title">{{ v.title }}</div>
          <div class="sub">{{ formatBytes(v.size) }} · {{ new Date(v.createdAt).toLocaleDateString() }}</div>
        </router-link>
      </div>
    </template>
    <UploadDialog v-if="showUpload" :folder="folder" @close="showUpload = false" />
  </div>
</template>
