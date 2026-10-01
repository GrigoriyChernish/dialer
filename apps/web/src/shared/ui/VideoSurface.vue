<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useCallStore } from '@/features/call/store';

/** Відео з кімнати: `remote` співрозмовника, `local` нашої камери (дзеркально). `track` змінюється, коли потік з'явився чи зник. */
const props = defineProps<{ kind: 'local' | 'remote'; track: boolean }>();
const call = useCallStore();
const el = ref<HTMLVideoElement>();
const bind = () => el.value && call.attach(props.kind, el.value);
onMounted(bind);
watch(() => props.track, () => nextTick(bind), { flush: 'post' });
</script>

<template>
  <!-- звук іде окремо (аудіо-елементи в CallMedia), тому відео без звуку -->
  <video ref="el" autoplay playsinline muted class="size-full object-cover" :class="kind === 'local' && '-scale-x-100'" />
</template>
