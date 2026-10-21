<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatDuration } from './media';
import Icon from './Icon.vue';

const props = defineProps<{ src: string; title: string }>();
const emit = defineEmits<{ back: []; error: [MediaError | null] }>();

const root = ref<HTMLDivElement>();
const video = ref<HTMLVideoElement>();
const playing = ref(false);
const ended = ref(false);
const current = ref(0);
const duration = ref(0);
const buffered = ref(0);
const volume = ref(1);
const muted = ref(false);
const loop = ref(false);
const rate = ref(1);
const fullscreen = ref(false);
const speedOpen = ref(false);
const controlsVisible = ref(true);
const flash = ref<'play' | 'pause' | null>(null);
const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let hideTimer = 0;
let flashTimer = 0;

const playedPct = computed(() => (duration.value ? (current.value / duration.value) * 100 : 0));
const bufferedPct = computed(() => (duration.value ? (buffered.value / duration.value) * 100 : 0));

function v(): HTMLVideoElement {
  return video.value!;
}
function togglePlay() {
  if (v().paused) {
    void v().play();
    showFlash('play');
  } else {
    v().pause();
    showFlash('pause');
  }
}
function showFlash(kind: 'play' | 'pause') {
  flash.value = null;
  clearTimeout(flashTimer);
  requestAnimationFrame(() => (flash.value = kind));
  flashTimer = window.setTimeout(() => (flash.value = null), 400);
}
function replay() {
  v().currentTime = 0;
  void v().play();
}
function seekBy(sec: number) {
  v().currentTime = Math.max(0, Math.min(duration.value, v().currentTime + sec));
}
function seekTo(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  v().currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration.value;
}
function toggleMute() {
  v().muted = !v().muted;
}
function setVolume(e: Event) {
  v().volume = Number((e.target as HTMLInputElement).value);
  v().muted = false;
}
function toggleLoop() {
  loop.value = !loop.value;
  v().loop = loop.value;
  if (loop.value && ended.value) replay();
}
function setRate(r: number) {
  v().playbackRate = r;
  speedOpen.value = false;
}
function toggleFullscreen() {
  if (document.fullscreenElement) return void document.exitFullscreen();
  if (root.value?.requestFullscreen) return void root.value.requestFullscreen();
  (v() as any).webkitEnterFullscreen?.(); // iPhone Safari: only the native video fullscreen exists
}
function togglePip() {
  const d = document as any;
  d.pictureInPictureElement ? d.exitPictureInPicture() : (v() as any).requestPictureInPicture?.();
}
function showControls() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => playing.value && !speedOpen.value && (controlsVisible.value = false), 2500);
}
function onTime() {
  if (!video.value) return; // events can still fire while the component is being torn down
  current.value = v().currentTime;
  const b = v().buffered;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= current.value && current.value <= b.end(i)) buffered.value = b.end(i);
}
function onEnded() {
  if (loop.value) return;
  ended.value = true;
  playing.value = false;
  controlsVisible.value = true;
}
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
  const map: Record<string, () => void> = {
    ' ': togglePlay, k: togglePlay,
    ArrowLeft: () => seekBy(-5), ArrowRight: () => seekBy(5),
    j: () => seekBy(-10), l: () => seekBy(10),
    ArrowUp: () => (v().volume = Math.min(1, v().volume + 0.1)),
    ArrowDown: () => (v().volume = Math.max(0, v().volume - 0.1)),
    m: toggleMute, f: toggleFullscreen, r: toggleLoop, i: togglePip,
    ',': () => (v().playbackRate = Math.max(0.25, v().playbackRate - 0.25)),
    '.': () => (v().playbackRate = Math.min(2, v().playbackRate + 0.25)),
    Home: () => (v().currentTime = 0), End: () => (v().currentTime = duration.value),
    Escape: () => (speedOpen.value = false),
  };
  if (/^[0-9]$/.test(e.key)) v().currentTime = (Number(e.key) / 10) * duration.value;
  else if (map[e.key]) map[e.key]();
  else return;
  e.preventDefault();
  showControls();
}
function onFsChange() {
  fullscreen.value = !!document.fullscreenElement;
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFsChange);
  showControls();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('fullscreenchange', onFsChange);
  clearTimeout(hideTimer);
  clearTimeout(flashTimer);
});
</script>

<template>
  <div class="player" :class="{ 'hide-cursor': !controlsVisible }" ref="root" @mousemove="showControls" @mouseleave="playing && !speedOpen && (controlsVisible = false)">
    <video
      ref="video"
      :src="props.src"
      autoplay
      preload="auto"
      playsinline
      @click="togglePlay"
      @dblclick="toggleFullscreen"
      @play="playing = true; ended = false"
      @pause="playing = false; showControls()"
      @ended="onEnded"
      @error="emit('error', v().error)"
      @timeupdate="onTime"
      @progress="onTime"
      @durationchange="duration = v().duration"
      @volumechange="volume = v().volume; muted = v().muted"
      @ratechange="rate = v().playbackRate"
    />

    <div class="center-btn" v-if="flash"><div><Icon :name="flash" :size="40" /></div></div>

    <div class="ended" v-if="ended">
      <p>「{{ props.title }}」播放完畢</p>
      <div class="row">
        <button class="btn" @click="replay"><Icon name="replay" :size="18" />重播</button>
        <button class="btn" @click="toggleLoop"><Icon name="loop" :size="18" />開啟循環播放</button>
        <button class="btn primary" @click="emit('back')"><Icon name="list" :size="18" />回到影片列表</button>
      </div>
    </div>

    <div class="controls" :class="{ hidden: !controlsVisible }">
      <div class="seek" @click="seekTo">
        <div class="track">
          <div class="buffered" :style="{ width: bufferedPct + '%' }" />
          <div class="played" :style="{ width: playedPct + '%' }" />
          <div class="knob" :style="{ left: playedPct + '%' }" />
        </div>
      </div>
      <div class="bar">
        <button class="cbtn" @click="togglePlay" :title="playing ? '暫停 (k)' : '播放 (k)'"><Icon :name="ended ? 'replay' : playing ? 'pause' : 'play'" /></button>
        <button class="cbtn" @click="seekBy(-10)" title="倒退 10 秒 (j)"><Icon name="back10" /></button>
        <button class="cbtn" @click="seekBy(10)" title="快轉 10 秒 (l)"><Icon name="fwd10" /></button>
        <div class="vol">
          <button class="cbtn" @click="toggleMute" title="靜音 (m)"><Icon :name="muted || volume === 0 ? 'mute' : 'volume'" /></button>
          <input type="range" min="0" max="1" step="0.05" :value="muted ? 0 : volume" @input="setVolume" />
        </div>
        <span class="time">{{ formatDuration(current) }} / {{ formatDuration(duration) }}</span>
        <span class="spacer" />
        <button class="cbtn toggle" :aria-pressed="loop" @click="toggleLoop" :title="loop ? '循環播放：開 (r)' : '循環播放：關 (r)'"><Icon name="loop" /></button>
        <div class="speed">
          <button class="cbtn" @click="speedOpen = !speedOpen" title="播放速度 (, .)"><span class="badge">{{ rate }}x</span></button>
          <div class="menu" v-if="speedOpen">
            <button v-for="r in rates" :key="r" :class="{ on: r === rate }" @click="setRate(r)"><span>{{ r === 1 ? '正常' : r + 'x' }}</span><Icon v-if="r === rate" name="check" :size="18" /></button>
          </div>
        </div>
        <button class="cbtn" @click="togglePip" title="子母畫面 (i)"><Icon name="pip" /></button>
        <button class="cbtn" @click="toggleFullscreen" title="全螢幕 (f)"><Icon :name="fullscreen ? 'fullscreenExit' : 'fullscreen'" /></button>
      </div>
    </div>
  </div>
</template>
