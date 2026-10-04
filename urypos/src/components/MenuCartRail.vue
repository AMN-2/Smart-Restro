<template>
  <aside class="menu-cart-rail" :aria-label="$t('cart.title')">
    <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <p class="pos-label">{{ $t('order.title') }}</p>
        <h2 class="text-base font-bold text-foreground">{{ ticketTitle }}</h2>
      </div>
      <span class="pos-badge-accent">{{ $t('cart.items_count', { count: menu.cart.length }) }}</span>
    </header>

    <div v-if="menu.cart.length" class="menu-cart-lines">
      <div v-for="line in menu.cart" :key="line.item" class="menu-cart-line">
        <button type="button" class="min-w-0 flex-1 text-start" @click="menu.showModal(line)">
          <span class="line-clamp-2 text-sm font-semibold text-foreground">{{ line.item_name }}</span>
          <span class="pos-money mt-0.5 block text-xs text-muted-foreground">{{ money(line.rate * line.qty) }}</span>
        </button>
        <div class="pos-stepper shrink-0">
          <button type="button" class="press" :disabled="Boolean(recentOrders.restaurantTable) || !canRemove" :aria-label="$t('cart.decrease')" @click="menu.decrementItemQuantity(line)">&minus;</button>
          <span class="pos-stepper-value">{{ Number(line.qty) }}</span>
          <button type="button" class="press" :aria-label="$t('cart.increase')" @click="menu.incrementItemQuantity(line)">+</button>
        </div>
      </div>
    </div>

    <div v-else class="grid flex-1 place-items-center px-6 py-12 text-center">
      <div>
        <span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary">
          <svg class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M2 3h2.5l2.2 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.55L21 7H6"/></svg>
        </span>
        <p class="mt-3 text-sm font-bold text-foreground">{{ $t('cart.empty_title') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ $t('cart.empty_body') }}</p>
      </div>
    </div>

    <footer v-if="menu.cart.length" class="mt-auto border-t border-border bg-muted/50 p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-sm font-semibold text-muted-foreground">{{ $t('totals.grand_total') }}</span>
        <strong class="pos-money text-xl text-foreground">{{ money(menu.grand_total) }}</strong>
      </div>
      <router-link to="/Cart" class="pos-btn-primary pos-btn-lg w-full">
        {{ $t('cart.review_order') }}
        <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
      </router-link>
    </footer>
  </aside>
</template>

<script>
import { useMenuStore } from "@/stores/Menu.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { useAuthStore } from "@/stores/Auth.js";
import { useTableStore } from "@/stores/Table.js";
import { useCustomerStore } from "@/stores/Customer.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";

export default {
  name: "MenuCartRail",
  setup() {
    return {
      menu: useMenuStore(),
      invoiceData: useInvoiceDataStore(),
      auth: useAuthStore(),
      table: useTableStore(),
      customers: useCustomerStore(),
      recentOrders: usetoggleRecentOrder(),
    };
  },
  computed: {
    canRemove() { return this.recentOrders.editPrintedInvoice === 0 || this.auth.removeTableOrderItem === 1; },
    ticketTitle() {
      return this.table.selectedTable || this.recentOrders.restaurantTable || this.customers.search || this.$t("order.new");
    },
  },
  methods: {
    money(value) { return `${this.invoiceData.currency || ""} ${Number(value || 0).toFixed(2)}`.trim(); },
  },
};
</script>
