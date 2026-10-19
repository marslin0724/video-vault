<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import type { VideoMeta } from '../core/types';
import { announceVideo, videoUrl } from '../sw/client';
import { formatBytes, formatDuration } from './media';
import VideoPlayer from './VideoPlayer.vue';
import Icon from './Icon.vue';

const props = defineProps<{ id: string }>();
const s = useSession();
const router = useRouter();
const meta = ref<VideoMeta | null>(null);
const src = ref('');
const error = ref('');
const deleting = ref(false);
const others = computed(() => s.videos.filter((v) => v.id !== props.id));
const folderLink = computed(() => (meta.value?.folder ? { path: '/', query: { folder: meta.value.folder } } : { path: '/' }));

async function moveTo(e: Event) {
  const target = (e.target as HTMLSelectElement).value;
  if (!meta.value || target === (meta.value.folder ?? '')) return;
  try {
    meta.value = await s.vault!.moveVideo(meta.value, target);
    await s.refreshVideos();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

watch(
  () => props.id,
  async (id) => {
    src.value = '';
    error.value = '';
    try {
      const m = s.videos.find((v) => v.id === id) ?? (await s.vault!.getVideo(id));
      meta.value = m;
      announceVideo(await s.vault!.describe(m));
      const url = videoUrl(m.id);
      await probeStream(url);
      src.value = url;
    } catch (e) {
      error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

/** Hit the service-worker route once so a broken pipeline shows a readable reason instead of a dead player. */
async function probeStream(url: string) {
  if (!navigator.serviceWorker.controller) throw new Error('Service Worker 尚未接管此頁面，請重新整理一次');
  const res = await fetch(url, { headers: { Range: 'bytes=0-11' } });
  if (res.status !== 206) {
    const body = (await res.text()).slice(0, 300);
    if (res.headers.get('content-type')?.includes('text/html')) throw new Error('串流請求沒有被 Service Worker 攔截（拿到的是網頁本身），請重新整理一次');
    throw new Error(`串流測試失敗：HTTP ${res.status} ${body}`);
  }
  const head = new Uint8Array(await res.arrayBuffer());
  const ascii = String.fromCharCode(...head.subarray(4, 8));
  const isMp4 = ascii === 'ftyp';
  const isEbml = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (!isMp4 && !isEbml) throw new Error(`解密後的資料開頭不是 mp4/webm（前 12 bytes: ${Array.from(head, (b) => b.toString(16).padStart(2, '0')).join(' ')}），chunk 可能損毀或順序錯誤`);
}

const MEDIA_ERRORS: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED：播放被中止',
  2: 'MEDIA_ERR_NETWORK：讀取串流時網路錯誤',
  3: 'MEDIA_ERR_DECODE：解碼失敗，檔案損毀或編碼不支援',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED：瀏覽器不支援此格式或編碼（例如 HEVC、AV1、mkv）',
};
function onPlayerError(e: MediaError | null) {
  error.value = e ? `播放錯誤 ${MEDIA_ERRORS[e.code] ?? e.code}${e.message ? `（${e.message}）` : ''}` : '播放錯誤';
}

function downloadName(m: VideoMeta): string {
  return m.remuxed ? `${m.title}.mp4` : m.originalName;
}

const downloading = ref(0); // bytes written so far, 0 = idle

/**
 * Browser-initiated downloads (<a download>) bypass the service worker, so the page fetches the
 * stream itself. Chrome/Edge stream straight to disk; other browsers fall back to a Blob.
 */
async function download() {
  const m = meta.value!;
  const name = downloadName(m);
  const picker = (window as any).showSaveFilePicker as undefined | ((o: object) => Promise<FileSystemFileHandle>);
  try {
    let handle: FileSystemFileHandle | undefined;
    if (picker) {
      try {
        handle = await picker({ suggestedName: name });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // user cancelled
        throw e;
      }
    }
    downloading.value = 1;
    const res = await fetch(videoUrl(m.id, { name }));
    if (!res.ok || !res.body) throw new Error(`下載失敗：HTTP ${res.status}`);
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          downloading.value += chunk.length;
          controller.enqueue(chunk);
        },
      }),
    );
    if (handle) {
      await counted.pipeTo(await handle.createWritable());
    } else {
      const blob = await new Response(counted).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    downloading.value = 0;
  }
}

async function remove() {
  if (!meta.value || !confirm(`刪除「${meta.value.title}」？無人引用的 chunk 會一併回收。`)) return;
  deleting.value = true;
  try {
    await s.vault!.deleteVideo(meta.value.id);
    await s.refreshVideos();
    router.push('/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <p class="error" v-if="error">{{ error }}</p>
    <div class="watch" v-if="meta">
      <div>
        <div class="row" style="margin-bottom: 12px">
          <router-link :to="folderLink"><button class="btn"><Icon name="arrowBack" :size="18" />回到影片列表{{ meta.folder ? `（${meta.folder}）` : '' }}</button></router-link>
        </div>
        <VideoPlayer v-if="src" :key="meta.id" :src="src" :title="meta.title" @back="router.push('/')" @error="onPlayerError" />
        <div class="info">
          <h1>{{ meta.title }}</h1>
          <div class="row">
            <div class="meta-line">
              <span>{{ formatBytes(meta.size) }}</span>
              <span>{{ meta.width }}×{{ meta.height }}</span>
              <span>{{ formatDuration(meta.duration) }}</span>
              <span>{{ new Date(meta.createdAt).toLocaleString() }}</span>
              <span>{{ meta.chunks.length }} chunks</span>
              <span v-if="meta.remuxed">remuxed</span>
            </div>
            <span class="spacer" />
            <label class="row" style="gap: 6px" title="移至資料夾">
              <Icon name="move" :size="18" />
              <select class="input" :value="meta.folder ?? ''" @change="moveTo">
                <option value="">（根目錄）</option>
                <option v-for="f in s.folders" :key="f" :value="f">{{ f }}</option>
              </select>
            </label>
            <button class="btn" @click="download" :disabled="downloading > 0"><Icon name="download" :size="18" />{{ downloading ? `下載中 ${formatBytes(downloading)}` : '下載' }}</button>
            <button class="btn danger" @click="remove" :disabled="deleting"><Icon name="trash" :size="18" />刪除</button>
          </div>
        </div>
      </div>
      <aside class="upnext">
        <div class="row" style="margin-bottom: 12px">
          <h3 style="margin: 0">其他影片</h3>
          <span class="spacer" />
          <router-link to="/"><button class="btn"><Icon name="list" :size="18" />全部影片</button></router-link>
        </div>
        <p class="muted" v-if="!others.length">沒有其他影片。</p>
        <router-link v-for="v in others" :key="v.id" :to="`/watch/${v.id}`" class="item">
          <div class="thumb">
            <img v-if="v.thumb" :src="v.thumb" :alt="v.title" />
            <span class="dur">{{ formatDuration(v.duration) }}</span>
          </div>
          <div>
            <div class="title">{{ v.title }}</div>
            <div class="sub">{{ formatBytes(v.size) }} · {{ new Date(v.createdAt).toLocaleDateString() }}</div>
          </div>
        </router-link>
      </aside>
    </div>
  </div>
</template>
