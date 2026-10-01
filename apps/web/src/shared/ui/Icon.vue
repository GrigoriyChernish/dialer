<script setup lang="ts">
import {
  ArrowLeftRight,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Loader,
  LogOut,
  Mic,
  MonitorSmartphone,
  Moon,
  MicOff,
  Pause,
  Pencil,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Search,
  SearchX,
  SignalLow,
  Sun,
  TriangleAlert,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from '@lucide/vue';

// ті самі іконки lucide, що в design/dialer.pen
const ICONS = {
  phone: Phone,
  arrowLeftRight: ArrowLeftRight,
  phoneCall: PhoneCall,
  chevronRight: ChevronRight,
  bell: Bell,
  moon: Moon,
  sun: Sun,
  monitorSmartphone: MonitorSmartphone,
  pencil: Pencil,
  phoneOutgoing: PhoneOutgoing,
  phoneIncoming: PhoneIncoming,
  phoneOff: PhoneOff,
  phoneMissed: PhoneMissed,
  x: X,
  pause: Pause,
  mic: Mic,
  micOff: MicOff,
  wifiOff: WifiOff,
  loader: Loader,
  signalLow: SignalLow,
  video: Video,
  videoOff: VideoOff,
  chevronLeft: ChevronLeft,
  logOut: LogOut,
  users: Users,
  search: Search,
  searchX: SearchX,
  circleX: CircleX,
  triangleAlert: TriangleAlert,
};
export type IconName = keyof typeof ICONS;
defineProps<{ name: IconName }>();
</script>

<template>
  <!-- розмір за замовчуванням 24 (атрибут lucide); менші задає викликач класом size-*, як у дизайні: 16, 18, 12 -->
  <component :is="ICONS[name]" aria-hidden="true" />
</template>
