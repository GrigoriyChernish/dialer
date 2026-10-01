<script setup lang="ts">
import { ChevronLeft, Loader, LogOut, Mic, MicOff, Pause, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, SignalLow, Video, VideoOff, WifiOff, X } from '@lucide/vue';

// ті самі іконки lucide, що в design/dialer.pen
const ICONS = { phone: Phone, phoneOutgoing: PhoneOutgoing, phoneIncoming: PhoneIncoming, phoneOff: PhoneOff, phoneMissed: PhoneMissed, x: X, pause: Pause, mic: Mic, micOff: MicOff, wifiOff: WifiOff, loader: Loader, signalLow: SignalLow, video: Video, videoOff: VideoOff, chevronLeft: ChevronLeft, logOut: LogOut };
export type IconName = keyof typeof ICONS;
defineProps<{ name: IconName }>();
</script>

<template>
  <!-- розмір за замовчуванням 24 (атрибут lucide); менші задає викликач класом size-*, як у дизайні: 16, 18, 12 -->
  <component :is="ICONS[name]" aria-hidden="true" />
</template>
