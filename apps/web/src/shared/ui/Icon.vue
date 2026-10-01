<script setup lang="ts">
import { Loader, Mic, MicOff, Pause, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, SignalLow, WifiOff, X } from '@lucide/vue';

// ті самі іконки lucide, що в design/dialer.pen
const ICONS = { phone: Phone, phoneOutgoing: PhoneOutgoing, phoneIncoming: PhoneIncoming, phoneOff: PhoneOff, phoneMissed: PhoneMissed, x: X, pause: Pause, mic: Mic, micOff: MicOff, wifiOff: WifiOff, loader: Loader, signalLow: SignalLow };
defineProps<{ name: keyof typeof ICONS }>();
</script>

<template>
  <component :is="ICONS[name]" class="size-6" aria-hidden="true" />
</template>
