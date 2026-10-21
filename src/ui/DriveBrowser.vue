<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { DriveEntry, GoogleDriveProvider } from '../core/storage/gdrive';
import { formatBytes } from './media';
import Icon from './Icon.vue';

const props = defineProps<{ drive: GoogleDriveProvider }>();
const emit = defineEmits<{ close: []; pick: [files: DriveEntry[]] }>();

const crumbs = ref<{ id: string; name: string }[]>([{ id: 'root', name: '我的雲端硬碟' }]);
const entries = ref<DriveEntry[]>([]);
const selected = ref(new Map<string, DriveEntry>());
const query = ref('');
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = query.value.trim();
    entries.value = q ? await props.drive.searchVideos(q) : await props.drive.browse(crumbs.value[crumbs.value.length - 1].id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function open(e: DriveEntry) {
  if (!e.isFolder) return toggle(e);
  query.value = '';
  crumbs.value.push({ id: e.id, name: e.name });
  load();
}
function jump(i: number) {
  crumbs.value = crumbs.value.slice(0, i + 1);
  query.value = '';
  load();
}
function toggle(e: DriveEntry) {
  const m = new Map(selected.value);
  m.has(e.id) ? m.delete(e.id) : m.set(e.id, e);
  selected.value = m;
}
onMounted(load);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="card modal stack" style="max-height: 85vh">
      <div class="dialog-head">
        <Icon name="drive" :size="22" />
        <h3>從 Google Drive 選擇影片</h3>
        <button class="close-x" @click="emit('close')" title="關閉"><Icon name="close" :size="20" /></button>
      </div>
      <div class="row">
        <nav class="crumbs" style="flex: 1">
          <template v-for="(c, i) in crumbs" :key="c.id">
            <span v-if="i" class="sep">/</span>
            <span v-if="i === crumbs.length - 1 && !query" class="here">{{ c.name }}</span>
            <button v-else class="link" @click="jump(i)">{{ c.name }}</button>
          </template>
        </nav>
        <input class="input" style="width: 200px" type="search" v-model="query" placeholder="搜尋整個 Drive 的影片" @keyup.enter="load" @search="load" />
      </div>
      <p class="error" v-if="error">{{ error }}</p>
      <div style="overflow: auto; min-height: 200px; border: 1px solid var(--border); border-radius: 8px">
        <p class="muted" style="padding: 16px" v-if="loading">載入中…</p>
        <p class="muted" style="padding: 16px" v-else-if="!entries.length">{{ query ? '找不到符合的影片' : '這裡沒有資料夾或影片' }}</p>
        <div v-else>
          <div v-for="e in entries" :key="e.id" class="drive-row" :class="{ on: selected.has(e.id) }" @click="open(e)">
            <input v-if="!e.isFolder" type="checkbox" :checked="selected.has(e.id)" @click.stop="toggle(e)" />
            <Icon :name="e.isFolder ? 'folder' : 'play'" :size="20" :style="e.isFolder ? 'color:#f4c542' : ''" />
            <span class="name">{{ e.name }}</span>
            <span class="muted" v-if="!e.isFolder">{{ formatBytes(e.size) }}</span>
          </div>
        </div>
      </div>
      <div class="row" style="justify-content: flex-end">
        <span class="muted" v-if="selected.size">已選 {{ selected.size }} 個</span>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="!selected.size" @click="emit('pick', [...selected.values()])"><Icon name="check" :size="18" />加入</button>
      </div>
    </div>
  </div>
</template>
