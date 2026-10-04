<template>
  <!--
    "Something is happening, wait." The old version was bare text on a
    half-transparent border colour, which read as a broken page rather than
    as progress.
  -->
  <Teleport to="body">
    <div v-if="show" class="pos-overlay z-[70] flex items-center justify-center p-4" role="status" aria-live="polite">
      <div class="pos-card flex items-center gap-3 px-5 py-4 animate-scale-in">
        <svg class="h-5 w-5 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        <span class="text-sm font-bold text-foreground">{{ label }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script>
export default {
  name: "PosBusy",
  props: {
    show: { type: Boolean, default: false },
    label: { type: String, default: "" },
  },
};
</script>
