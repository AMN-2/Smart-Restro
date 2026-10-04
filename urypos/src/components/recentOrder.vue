<template>

  <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
    <!-- The log. -->
    <section class="pos-card overflow-hidden">
      <header class="space-y-3 border-b border-border p-4">
        <h1 class="pos-title">{{ $t('order.recent_orders') }}</h1>
        <div class="pos-search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="orderSearch"
            type="search"
            class="pos-input"
            autocomplete="off"
            :placeholder="$t('order.search_placeholder')"
            v-model="recentOrders.searchOrder"
            @input="recentOrders.handleSearchInput"
          />
        </div>
        <div class="pos-chip-row -mx-4 px-4 sm:-mx-4 sm:px-4" :aria-label="$t('status.filter')">
          <button
            v-for="status in statuses"
            :key="status.value"
            type="button"
            class="pos-chip press"
            :class="recentOrders.selectedStatus === status.value && 'pos-chip-active'"
            :aria-pressed="recentOrders.selectedStatus === status.value"
            @click="selectStatus(status.value)"
          >
            {{ status.label }}
          </button>
        </div>
      </header>

      <ul v-if="recentOrders.filteredOrders.length" class="divide-y divide-border">
        <li v-for="(order, index) in recentOrders.filteredOrders" :key="order.name">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors duration-fast hover:bg-muted/60"
            :class="recentOrders.setBackground === index && 'bg-secondary/60 hover:bg-secondary/60'"
            @click="openOrder(order, index)"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate text-sm font-bold text-foreground bidi-isolate">{{ order.name }}</span>
                <span v-if="order.status" :class="statusBadge(order.status)">{{ statusLabel(order.status) }}</span>
              </span>
              <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                {{ order.restaurant_table || order.order_type }}
                <template v-if="order.customer"> · {{ order.customer }}</template>
                <template v-if="order.mobile_number"> · <span class="bidi-isolate">{{ order.mobile_number }}</span></template>
              </span>
            </span>
            <span class="shrink-0 text-end">
              <span class="pos-money block text-sm text-foreground">{{ money(order.grand_total) }}</span>
              <span class="block text-xs tabular-nums text-muted-foreground">{{ recentOrders.getFormattedTime(order.posting_time) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <PosEmpty v-else :title="$t('order.none_title')" :body="$t('order.none_body')" />

      <div class="border-t border-border px-4 pb-4">
        <PosPagination
          :page="recentOrders.currentPage"
          :has-next="Boolean(recentOrders.next)"
          @previous="recentOrders.previousPageClick()"
          @next="recentOrders.nextPageClick()"
        />
      </div>
    </section>

    <!-- The selected order. -->
    <section v-if="recentOrders.showOrder && order" ref="detail" class="pos-card overflow-hidden animate-fade-in">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div class="min-w-0">
          <p class="pos-label bidi-isolate">{{ order.name }}</p>
          <h2 class="truncate text-xl font-bold text-foreground">{{ order.customer || order.restaurant_table || order.order_type }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            <span v-if="order.mobile_number" class="bidi-isolate">{{ order.mobile_number }} · </span>
            {{ recentOrders.postingDate }}
          </p>
          <p v-if="order.waiter" class="mt-0.5 text-sm text-muted-foreground">
            {{ $t('tables.waiter') }}: <span class="font-semibold text-foreground">{{ order.waiter }}</span>
          </p>
        </div>
        <div class="text-end">
          <p class="pos-money text-2xl text-foreground">
            {{ money(order.status === 'Draft' ? '0.00' : order.grand_total) }}
          </p>
          <span v-if="order.status" class="mt-1 inline-flex" :class="statusBadge(order.status)">{{ statusLabel(order.status) }}</span>
        </div>
      </header>

      <div class="space-y-5 p-4 sm:p-5">
        <div>
          <p class="pos-section-title">{{ $t('menu.items') }}</p>
          <ul class="divide-y divide-border rounded-xl border border-border">
            <li
              v-for="(line, i) in recentOrders.recentOrderListItems"
              :key="i"
              class="flex items-center gap-3 px-3.5 py-2.5 text-sm"
            >
              <span class="min-w-0 flex-1 truncate font-semibold text-foreground">{{ line.item_name }}</span>
              <span class="shrink-0 tabular-nums text-muted-foreground">× {{ line.qty }}</span>
              <span class="pos-money w-24 shrink-0 text-end text-foreground">{{ money(line.amount) }}</span>
            </li>
          </ul>
        </div>

        <div>
          <p class="pos-section-title">{{ $t('totals.title') }}</p>
          <dl class="space-y-1.5 rounded-xl bg-muted/60 p-3.5 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('totals.net_total') }}</dt>
              <dd class="pos-money text-foreground">{{ money(recentOrders.netTotal) }}</dd>
            </div>
            <div v-for="(tax, i) in recentOrders.texDetails" :key="i" class="flex justify-between gap-3">
              <dt class="text-muted-foreground">{{ tax.description }}</dt>
              <dd class="pos-money text-foreground">{{ money(tax.rate) }}</dd>
            </div>
            <div v-if="recentOrders.additionalPiscountPercentage" class="flex justify-between gap-3">
              <dt class="text-muted-foreground">{{ $t('payment.discount_line', { pct: recentOrders.additionalPiscountPercentage }) }}</dt>
              <dd class="pos-money text-success">− {{ money(recentOrders.discountAmount) }}</dd>
            </div>
            <div class="flex justify-between gap-3 border-t border-border pt-2 text-base">
              <dt class="font-bold text-foreground">{{ $t('totals.grand_total') }}</dt>
              <dd class="pos-money text-foreground">
                {{ money(recentOrders.totalAmount > 0 ? recentOrders.totalAmount : recentOrders.grandTotal) }}
              </dd>
            </div>
          </dl>
        </div>

        <!--
          Ordering only. Taking payment and cancelling orders are not part of
          this interface; they happen at the cashier POS.
        -->
        <div v-if="isOpenOrder" class="flex flex-wrap gap-2">
          <button
            type="button"
            class="pos-btn-primary flex-1"
            :disabled="recentOrders.orderType === 'Aggregators'"
            @click="recentOrders.editOrder()"
          >
            {{ $t('order.add_items') }}
          </button>
          <button v-if="canBill && canCloseTable" type="button" class="pos-btn-ghost flex-1" @click="recentOrders.showCloseTableModal()">
            {{ $t('order.close_table') }}
          </button>
        </div>
        <p v-if="isOpenOrder" class="flex items-center gap-2 rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm text-secondary-foreground">
          <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path stroke-linecap="round" d="M12 8v4m0 4h.01" />
          </svg>
          {{ $t('order.cashier_only_hint') }}
        </p>
      </div>
    </section>

    <section v-else class="pos-card hidden lg:block">
      <PosEmpty :title="$t('order.pick_title')" :body="$t('order.pick_body')">
        <template #icon>
          <svg class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
          </svg>
        </template>
      </PosEmpty>
    </section>
  </div>

  <!-- Close table without printing: settles the bill and frees the floor. -->
  <PosDialog
    :open="canBill && recentOrders.closeTableFlag"
    :title="$t('order.close_table_title')"
    :description="$t('order.close_table_body')"
    @close="recentOrders.closeTableFlag = false"
  >
    <div class="mb-4 rounded-xl bg-muted px-4 py-3">
      <p class="pos-label">{{ $t('tables.title') }}</p>
      <p class="text-base font-bold text-foreground">{{ recentOrders.restaurantTable }}</p>
    </div>
    <label for="closeReason" class="pos-form-label">{{ $t('order.reason') }}</label>
    <input
      id="closeReason"
      type="text"
      class="pos-input"
      :placeholder="$t('order.close_table_reason_hint')"
      v-model="recentOrders.closeTableReason"
    />
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="recentOrders.closeTableFlag = false">{{ $t('common.no') }}</button>
      <button
        type="button"
        class="pos-btn-primary"
        :disabled="recentOrders.closingTable || !recentOrders.closeTableReason.trim()"
        @click="recentOrders.closeTable()"
      >
        {{ recentOrders.closingTable ? $t('order.closing') : $t('order.close_table') }}
      </button>
    </template>
  </PosDialog>

</template>

<script>
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { useAuthStore } from "@/stores/Auth.js";
import PosDialog from "./ui/PosDialog.vue";
import PosEmpty from "./ui/PosEmpty.vue";
import PosPagination from "./ui/PosPagination.vue";

const STATUS_KEYS = {
  All: "all",
  Draft: "draft",
  Unbilled: "unbilled",
  "Recently Paid": "recently_paid",
  Paid: "paid",
  Consolidated: "consolidated",
  Return: "return",
};

export default {
  name: "RecentOrder",
  components: { PosDialog, PosEmpty, PosPagination },
  setup() {
    return {
      recentOrders: usetoggleRecentOrder(),
      invoiceData: useInvoiceDataStore(),
      auth: useAuthStore(),
    };
  },
  computed: {
    order() {
      return this.recentOrders.selectedOrder;
    },
    /**
     * Closing a table out is billing: `auth.cashier` means "holds a billing
     * role on this POS Profile". The server enforces the same rule
     * (`_require_settle_permission` in ury_order.py).
     */
    canBill() {
      return Boolean(this.auth.cashier);
    },
    statuses() {
      const list = ["All", "Draft", "Unbilled"];
      if (this.auth.viewAllStatus === 0 && this.invoiceData.paidLimit > 0) list.push("Recently Paid");
      if (this.auth.viewAllStatus === 1) list.push("Paid", "Consolidated", "Return");
      return list.map((value) => ({ value, label: this.$t("status." + STATUS_KEYS[value]) }));
    },
    /**
     * Still open, so items can be added. Read from the order itself as well
     * as the filter, so a draft under "All orders" is treated as open.
     */
    isDraft() {
      return this.recentOrders.selectedStatus === "Draft" || (this.order && this.order.status === "Draft");
    },
    isOpenOrder() {
      return this.isDraft || this.recentOrders.selectedStatus === "Unbilled";
    },
    /**
     * Whether this order is still holding a table: attached to one, bill not
     * closed out, not cancelled. Otherwise the table is already free.
     */
    canCloseTable() {
      const order = this.order;
      if (!order) return false;
      return Boolean(
        this.recentOrders.restaurantTable && this.recentOrders.invoicePrinted === 0 && order.status !== "Cancelled"
      );
    },
  },
  mounted() {
    this.recentOrders.handleStatusChange();
  },
  methods: {
    money(value) {
      return `${this.invoiceData.currency || ""} ${value ?? ""}`.trim();
    },
    statusLabel(status) {
      const key = STATUS_KEYS[status];
      return key ? this.$t("status." + key) : status;
    },
    statusBadge(status) {
      if (status === "Paid" || status === "Consolidated") return "pos-badge-success";
      if (status === "Draft") return "pos-badge-warning";
      if (status === "Return" || status === "Cancelled") return "pos-badge-danger";
      return "pos-badge-neutral";
    },
    selectStatus(value) {
      if (this.recentOrders.selectedStatus === value) return;
      this.recentOrders.selectedStatus = value;
      this.recentOrders.showOrder = false;
      this.recentOrders.setBackground = null;
      this.recentOrders.handleStatusChange();
    },
    openOrder(order, index) {
      this.recentOrders.viewRecentOrder(order);
      this.recentOrders.setBackground = index;
      // On a phone the detail is below the list; bring it into view.
      if (window.innerWidth < 1024) {
        this.$nextTick(() => {
          const el = this.$refs.detail;
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  },
};
</script>
