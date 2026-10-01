<script setup lang="ts">
/** Картка (дизайн: компонент Card): градієнт card-top → card-bottom, рамка line, радіус 28. Відступи задає викликач класом (у дизайні за замовчуванням 18 12 10 12). */
</script>

<template>
  <div class="card rounded-[28px] border border-line"><slot /></div>
</template>

<style scoped>
.card {
  background: linear-gradient(160deg, var(--card-top), var(--card-bottom));
}
</style>
