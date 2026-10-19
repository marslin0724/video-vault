<script setup lang="ts">
import Icon from './Icon.vue';

const props = defineProps<{ folder: string }>();
const emit = defineEmits<{ navigate: [folder: string] }>();

function parts(): { name: string; path: string }[] {
  const segs = props.folder.split('/').filter(Boolean);
  return segs.map((name, i) => ({ name, path: segs.slice(0, i + 1).join('/') }));
}
</script>

<template>
  <nav class="crumbs">
    <button class="link" @click="emit('navigate', '')" title="根目錄"><Icon name="home" :size="18" />全部影片</button>
    <template v-for="p in parts()" :key="p.path">
      <span class="sep">/</span>
      <span v-if="p.path === props.folder" class="here">{{ p.name }}</span>
      <button v-else class="link" @click="emit('navigate', p.path)">{{ p.name }}</button>
    </template>
  </nav>
</template>
