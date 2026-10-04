<template>
  <div class="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in">
    <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
      <slot name="icon">
        <svg class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6m16 0v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4m16 0h-4l-1 2h-6l-1-2H4" />
        </svg>
      </slot>
    </div>
    <p class="pos-title">{{ title }}</p>
    <p v-if="body" class="mt-1 max-w-sm text-sm text-muted-foreground">{{ body }}</p>
    <div v-if="$slots.default" class="mt-5"><slot /></div>
  </div>
</template>

<script>
export default {
  name: "PosEmpty",
  props: {
    title: { type: String, required: true },
    body: { type: String, default: "" },
  },
};
</script>
