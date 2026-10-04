<template>
  <!--
    "This order changed on another device" while the cart holds unsent
    edits, so neither side's work is overwritten without a word.
  -->
  <div
    v-if="table.remoteChange"
    role="alert"
    class="mb-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3.5 text-sm text-foreground animate-fade-in"
  >
    <svg class="mt-0.5 h-5 w-5 shrink-0 text-warning" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M5.6 15A7 7 0 0 0 18 17.4M18.4 9A7 7 0 0 0 6 6.6" />
    </svg>
    <div class="min-w-0 flex-1">
      <p class="font-bold">{{ $t('live.changed_elsewhere_title') }}</p>
      <p class="mt-0.5 text-muted-foreground">{{ $t('live.changed_elsewhere_body') }}</p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button type="button" class="pos-btn-primary pos-btn-sm" @click="table.refreshOpenOrder({ force: true })">
          {{ $t('live.reload_order') }}
        </button>
        <button type="button" class="pos-btn-ghost pos-btn-sm" @click="table.remoteChange = null">
          {{ $t('live.keep_mine') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { useTableStore } from "@/stores/Table.js";

export default {
  name: "RemoteChangeBanner",
  setup() {
    return { table: useTableStore() };
  },
};
</script>
