<template>
  <!-- Cashier: which order this is — a new one, or an existing invoice. -->
  <div v-if="auth.cashier" class="mb-4 flex items-center gap-2 text-sm">
    <span class="font-semibold text-muted-foreground">{{ $t('order.title') }}</span>
    <svg class="h-3 w-3 text-muted-foreground rtl-flip" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 6 10" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m1 9 4-4-4-4" />
    </svg>
    <span class="pos-badge-accent bidi-isolate">
      {{ recentOrders.orderNumber === 'New' ? $t('order.new') : recentOrders.orderNumber }}
    </span>
  </div>
</template>

<script>
import { useAuthStore } from "@/stores/Auth.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";

export default {
  name: "orderInfo",
  setup() {
    return { auth: useAuthStore(), recentOrders: usetoggleRecentOrder() };
  },
};
</script>
