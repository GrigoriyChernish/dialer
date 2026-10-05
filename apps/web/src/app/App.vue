<script setup lang="ts">
import { RouterView } from 'vue-router';
import CallScreen from '@/features/call/CallScreen.vue';
import { useCallStore } from '@/features/call/store';

const call = useCallStore();
</script>

<template>
  <main class="safe-area relative mx-auto h-full max-w-106.25 overflow-y-auto">
    <RouterView />
    <!-- відступи safe-area лежать і на шарі: він займає всю область `main` разом з її відступами й має сам не заходити під системні панелі -->
    <!-- екран дзвінка не маршрут, а шар поверх поточної сторінки: навігація його не обриває -->
    <div v-if="call.status !== 'idle' ? !call.minimized : call.missed" class="safe-area absolute inset-0 z-10 bg-bg">
      <CallScreen />
    </div>
  </main>
</template>
