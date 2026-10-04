<template>
  <PosBusy :show="invoiceData.invoiceUpdating" :label="$t('order.updating')" />

  <orderInfo />
  <RemoteChangeBanner />

  <PosEmpty v-if="menu.cart.length === 0" :title="$t('cart.empty_title')" :body="$t('cart.empty_body')">
    <template #icon>
      <svg class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M2 3h2.5l2.2 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.55L21 7H6" />
      </svg>
    </template>
    <router-link to="/Menu" class="pos-btn-primary">{{ $t('menu.open_menu') }}</router-link>
  </PosEmpty>

  <div v-else class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <!--
      The ticket. Each line carries its own stepper now, so correcting a
      quantity no longer means opening a dialog; tapping the line opens the
      quantity and kitchen-note editor for anything finer.
    -->
    <section class="pos-card overflow-hidden">
      <header class="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3">
        <div class="min-w-0">
          <p class="pos-label">{{ ticketLabel }}</p>
          <p class="truncate text-base font-bold text-foreground">{{ ticketTitle }}</p>
        </div>
        <span class="pos-badge-accent shrink-0">{{ $t('cart.items_count', { count: menu.cart.length }) }}</span>
      </header>

      <ul class="divide-y divide-border">
        <li
          v-for="(line, index) in menu.cart"
          :key="line.item"
          class="flex items-center gap-3 px-4 py-3 animate-fade-in"
        >
          <button type="button" class="min-w-0 flex-1 text-start" @click="menu.showModal(line)">
            <span class="block text-base font-semibold leading-snug text-foreground">{{ line.item_name }}</span>
            <span v-if="line.comment" class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <svg class="h-3 w-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h8M8 14h5M21 12c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4-.8L3 20l1.3-3.9A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
              </svg>
              <span class="truncate">{{ line.comment }}</span>
            </span>
            <!-- Phones get the line total alone; the working shows from sm up. -->
            <span class="mt-0.5 block text-sm tabular-nums text-muted-foreground">
              <span class="hidden sm:inline">{{ money(line.rate) }} × {{ Number(line.qty) }} = </span>
              <strong class="pos-money text-foreground">{{ money(lineTotal(line)) }}</strong>
            </span>
          </button>

          <div class="pos-stepper shrink-0">
            <button
              type="button"
              class="press"
              :disabled="Boolean(recentOrders.restaurantTable) || !canRemove"
              :aria-label="$t('cart.decrease')"
              @click="menu.decrementItemQuantity(line)"
            >&minus;</button>
            <span class="pos-stepper-value">{{ Number(line.qty) }}</span>
            <button type="button" class="press" :aria-label="$t('cart.increase')" @click="menu.incrementItemQuantity(line)">+</button>
          </div>

          <button
            type="button"
            class="pos-icon-btn text-destructive hover:bg-destructive/10 hover:text-destructive"
            :disabled="Boolean(recentOrders.restaurantTable) || !canRemove"
            :aria-label="$t('common.delete')"
            :title="$t('common.delete')"
            @click="canRemove && menu.removeItemFromCart(index)"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
            </svg>
          </button>
        </li>
      </ul>

      <footer class="flex items-center justify-between border-t-2 border-border bg-muted/60 px-4 py-3.5">
        <span class="text-sm font-bold uppercase tracking-wider text-muted-foreground">{{ $t('totals.grand_total') }}</span>
        <span class="pos-money text-2xl text-foreground">{{ money(total) }}</span>
      </footer>
    </section>

    <aside class="space-y-4">
      <div class="pos-card space-y-4 p-4">
        <div>
          <label for="comments" class="pos-form-label">{{ $t('order.order_note') }}</label>
          <textarea
            id="comments"
            rows="2"
            class="pos-input h-auto py-2.5"
            :placeholder="$t('order.order_note_hint')"
            v-model="menu.comments"
          ></textarea>
        </div>
      </div>

      <!-- Who and where this ticket belongs to, read-only. -->
      <details v-if="details.length" class="pos-card group overflow-hidden">
        <summary class="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between px-4 text-sm font-bold text-foreground">
          {{ $t('common.additional_details') }}
          <svg class="h-4 w-4 text-muted-foreground transition-transform duration-fast group-open:rotate-180" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <dl class="divide-y divide-border border-t border-border">
          <div v-for="row in details" :key="row.label" class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd class="truncate font-semibold text-foreground bidi-isolate">{{ row.value }}</dd>
          </div>
        </dl>
      </details>

    </aside>
  </div>

  <!-- Room for the send bar. -->
  <div v-if="showSend" class="h-24" aria-hidden="true"></div>

  <!-- The one action this screen exists for. -->
  <div v-if="showSend" class="pos-actionbar">
    <div class="mx-auto flex max-w-7xl items-center gap-3">
      <div class="min-w-0 flex-1">
        <span class="block truncate text-xs font-semibold text-muted-foreground">{{ ticketTitle }}</span>
        <span class="pos-money block text-lg text-foreground">{{ money(total) }}</span>
      </div>
      <router-link to="/Menu" class="pos-btn-ghost pos-btn-lg hidden shrink-0 sm:inline-flex">
        {{ $t('cart.add_more') }}
      </router-link>
      <button type="button" class="pos-btn-primary pos-btn-lg shrink-0" @click="invoiceData.invoiceCreation()">
        <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        {{ $t(invoiceData.submitLabelKey) }}
      </button>
    </div>
  </div>

  <ItemDialog />

</template>

<script>
import orderInfo from "./orderInfo.vue";
import ItemDialog from "./ItemDialog.vue";
import RemoteChangeBanner from "./RemoteChangeBanner.vue";
import PosBusy from "./ui/PosBusy.vue";
import PosEmpty from "./ui/PosEmpty.vue";
import { useMenuStore } from "@/stores/Menu.js";
import { useTableStore } from "@/stores/Table.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { useAuthStore } from "@/stores/Auth.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";
import { useCustomerStore } from "@/stores/Customer.js";

export default {
  name: "Cart",
  components: { orderInfo, ItemDialog, PosBusy, PosEmpty, RemoteChangeBanner },
  setup() {
    return {
      menu: useMenuStore(),
      table: useTableStore(),
      invoiceData: useInvoiceDataStore(),
      auth: useAuthStore(),
      recentOrders: usetoggleRecentOrder(),
      customers: useCustomerStore(),
    };
  },
  computed: {
    /** See Menu.vue: drives the disabled look and the guard together. */
    canRemove() {
      return this.recentOrders.editPrintedInvoice === 0 || this.auth.removeTableOrderItem === 1;
    },
    showSend() {
      return this.menu.cart.length > 0 && this.invoiceData.showUpdateButtton === true;
    },
    total() {
      return this.menu.grand_total || this.table.grandTotal || this.invoiceData.grandTotal;
    },
    ticketLabel() {
      return this.$t("tables.title");
    },
    ticketTitle() {
      const where =
        this.table.selectedTable || this.recentOrders.restaurantTable || this.recentOrders.pastOrderType;
      const who = this.customers.search;
      return [where, who].filter(Boolean).join(" · ") || this.$t("order.title");
    },
    details() {
      const waiter =
        this.table.previousWaiter ?? this.recentOrders.recentWaiter ?? this.invoiceData.waiter;
      return [
        { label: this.$t("order.invoice"), value: this.table.invoiceNo || this.invoiceData.invoiceNumber },
        { label: this.$t("tables.waiter"), value: waiter },
        { label: this.$t("pos.profile"), value: this.invoiceData.posProfile },
        { label: this.$t("pos.cashier"), value: this.invoiceData.cashier },
      ].filter((row) => row.value);
    },
  },
  mounted() {
    window.scrollTo(0, 0);
  },
  methods: {
    money(value) {
      return `${this.invoiceData.currency || ""} ${value ?? ""}`.trim();
    },
    lineTotal(line) {
      return ((parseFloat(line.rate) || 0) * (Number(line.qty) || 0)).toFixed(2);
    }
  },
};
</script>
