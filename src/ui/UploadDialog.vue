<script setup lang="ts">
import { markRaw, ref, shallowRef } from 'vue';
import { useSession } from '../stores/session';
import { remuxToFaststartMp4 } from '../core/remux';
import type { UploadProgress } from '../core/vault';
import { probeVideo, formatBytes } from './media';
import type { DriveEntry, GoogleDriveProvider } from '../core/storage/gdrive';
import { DRIVE_IMPORT_MAX_BYTES } from '../config';
import Icon from './Icon.vue';
import DriveBrowser from './DriveBrowser.vue';

const props = defineProps<{ folder: string }>();
const emit = defineEmits<{ close: [] }>();
const s = useSession();
const files = ref<File[]>([]);
const remux = ref(true);
const busy = ref(false);
const over = ref(false);
const stage = ref('');
const progress = ref<UploadProgress | null>(null);
const log = ref<string[]>([]);
const error = ref('');
const drive = shallowRef<GoogleDriveProvider | null>(null); // class instance: keep it out of Vue's deep proxy
const driveStage = ref('');

/** Open the in-app Drive browser (asks for drive.readonly the first time). */
async function openDrive() {
  error.value = '';
  busy.value = true;
  try {
    drive.value = markRaw(await s.driveForImport());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/** Download the chosen Drive videos into the queue as File objects. */
async function addFromDrive(picked: DriveEntry[]) {
  const d = drive.value!;
  drive.value = null;
  busy.value = true;
  try {
    for (const f of picked) {
      if (f.size > DRIVE_IMPORT_MAX_BYTES) {
        log.value.push(`${f.name}: 略過，超過 ${formatBytes(DRIVE_IMPORT_MAX_BYTES)}（從 Drive 匯入會先載入記憶體）`);
        continue;
      }
      driveStage.value = `${f.name}: 從 Drive 下載中…`;
      const blob = await d.download(f.id, (b) => (driveStage.value = `${f.name}: 從 Drive 下載 ${formatBytes(b)} / ${formatBytes(f.size)}`));
      files.value = [...files.value, new File([blob], f.name, { type: f.mimeType })];
    }
    driveStage.value = `已加入 ${picked.length} 個 Drive 檔案，按「開始上傳」`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function pick(e: Event) {
  files.value = Array.from((e.target as HTMLInputElement).files ?? []);
}
function drop(e: DragEvent) {
  over.value = false;
  files.value = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('video/') || /\.(mkv|mov|mp4|webm)$/i.test(f.name));
}

async function start() {
  if (!s.vault || !files.value.length) return;
  busy.value = true;
  error.value = '';
  try {
    for (const file of files.value) {
      stage.value = `${file.name}: ${remux.value ? 'remux…' : '準備中…'}`;
      const r = remux.value ? await remuxToFaststartMp4(file) : { blob: file, remuxed: false };
      if (remux.value && !r.remuxed) log.value.push(`${file.name}: 略過 remux（${r.reason}）`);
      stage.value = `${file.name}: 產生縮圖…`;
      const probe = await probeVideo(r.blob);
      stage.value = `${file.name}: 上傳中…`;
      let last: UploadProgress | undefined;
      progress.value = null;
      const meta = await s.vault.uploadVideo(
        {
          blob: r.blob,
          folder: props.folder,
          title: file.name.replace(/\.[^.]+$/, ''),
          originalName: file.name,
          mime: r.remuxed ? 'video/mp4' : file.type || 'video/mp4',
          duration: probe.duration,
          width: probe.width,
          height: probe.height,
          remuxed: r.remuxed,
          thumb: probe.thumb,
        },
        (p) => (progress.value = last = p),
      );
      log.value.push(`${file.name}: 完成，上傳 ${formatBytes(last?.uploadedBytes ?? 0)}，dedup 省下 ${formatBytes(last?.dedupedBytes ?? 0)}（${meta.chunks.length} chunks）`);
    }
    await s.refreshVideos();
    stage.value = '全部完成';
    files.value = [];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DriveBrowser v-if="drive" :drive="drive" @close="drive = null" @pick="addFromDrive" />
  <div class="modal-backdrop" v-else @click.self="!busy && emit('close')">
    <div class="card modal stack">
      <div class="dialog-head">
        <Icon name="upload" :size="22" />
        <h3>上傳影片<span class="muted" v-if="props.folder" style="font-weight: 400"> 到 {{ props.folder }}</span></h3>
        <button class="close-x" @click="emit('close')" :disabled="busy" title="關閉"><Icon name="close" :size="20" /></button>
      </div>
      <label class="dropzone" :class="{ over }" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="drop">
        <input type="file" accept="video/*,.mkv,.mov" multiple @change="pick" :disabled="busy" />
        <template v-if="files.length">
          <div v-for="f in files" :key="f.name" style="color: var(--text)">{{ f.name }} <span class="muted">({{ formatBytes(f.size) }})</span></div>
        </template>
        <template v-else>拖曳影片到這裡，或點擊選擇檔案</template>
      </label>
      <div class="row">
        <button class="btn" @click="openDrive" :disabled="busy"><Icon name="drive" :size="18" />從 Google Drive 選擇</button>
        <span class="muted" v-if="driveStage">{{ driveStage }}</span>
      </div>
      <label class="check">
        <input type="checkbox" v-model="remux" :disabled="busy" />
        <span>上傳前 remux 成 faststart mp4<br /><span class="muted">不重新壓縮；起播較快，同一影片不同容器也能 dedup。1 GB 以上自動略過。</span></span>
      </label>
      <div v-if="stage" class="stack" style="gap: 8px">
        <div>{{ stage }}</div>
        <div class="progress" v-if="progress"><div :style="{ width: `${(progress.done / progress.total) * 100}%` }" /></div>
        <div class="muted" v-if="progress">{{ progress.done }} / {{ progress.total }} chunks · 上傳 {{ formatBytes(progress.uploadedBytes) }} · dedup {{ formatBytes(progress.dedupedBytes) }}</div>
      </div>
      <ul class="log" v-if="log.length">
        <li v-for="(l, i) in log" :key="i">{{ l }}</li>
      </ul>
      <p class="error" v-if="error">{{ error }}</p>
      <div class="row" style="justify-content: flex-end">
        <button class="btn" @click="emit('close')" :disabled="busy">關閉</button>
        <button class="btn primary" @click="start" :disabled="busy || !files.length"><Icon name="upload" :size="18" />開始上傳</button>
      </div>
    </div>
  </div>
</template>
