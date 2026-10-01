<script setup lang="ts">
import { RouterView } from 'vue-router';
import CallScreen from '@/features/call/CallScreen.vue';
import { useCallStore } from '@/features/call/store';

const call = useCallStore();
</script>

<template>
  <main class="relative mx-auto h-full max-w-106.25 overflow-y-auto">
    <RouterView />
    <!-- екран дзвінка не маршрут, а шар поверх поточної сторінки: навігація його не обриває -->
    <div v-if="call.status !== 'idle' || call.missed" class="absolute inset-0 z-10 bg-bg"><CallScreen /></div>
  </main>
</template>
