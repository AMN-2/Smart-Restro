<template>
  <!-- Previous / page / next. Arrows flip in RTL via `rtl-flip`. -->
  <nav v-if="hasPrevious || hasNext" class="mt-6 flex items-center justify-center gap-2" :aria-label="$t('common.pagination')">
    <button type="button" class="pos-btn-ghost pos-btn-sm" :disabled="!hasPrevious" @click="$emit('previous')">
      <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
      </svg>
      {{ $t('common.previous') }}
    </button>
    <span class="min-w-[4.5rem] text-center text-sm font-bold tabular-nums text-muted-foreground">
      {{ totalPages ? $t('common.page_of', { page, total: totalPages }) : page }}
    </span>
    <button type="button" class="pos-btn-ghost pos-btn-sm" :disabled="!hasNext" @click="$emit('next')">
      {{ $t('common.next') }}
      <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
      </svg>
    </button>
  </nav>
</template>

<script>
export default {
  name: "PosPagination",
  props: {
    page: { type: Number, required: true },
    /** Omit when the total is unknown (server-side "is there a next page"). */
    totalPages: { type: Number, default: 0 },
    hasNext: { type: Boolean, default: false },
  },
  emits: ["previous", "next"],
  computed: {
    hasPrevious() {
      return this.page > 1;
    },
  },
};
</script>
