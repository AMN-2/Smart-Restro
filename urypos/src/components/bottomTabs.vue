<template>
  <!--
    Floor navigation, and the order's progress at the same time.

    The separate step strip ("1 Table · 2 Customer · 3 Menu · 4 Cart") is
    gone; the bar now carries what it used to say. Each tab shows where the
    order stands — the open table, the customer, a tick once that part is
    done, the number of lines in the cart — so one bar both navigates and
    summarises.

    Written once, placed twice: a bottom bar on a phone, a side rail on a
    tablet. Navigation is done in code after the tab's guard passes, so a
    tab that is not ready yet explains why instead of flashing open.
  -->
  <template v-if="!tabClick.isLoginPage">
    <!-- Phone -->
    <nav class="pos-tabbar" :aria-label="$t('nav.primary')">
      <div class="mx-auto grid h-16 max-w-xl" :style="{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }">
        <a
          v-for="tab in tabs"
          :key="'bar-' + tab.path"
          :href="'/urypos' + tab.path"
          class="pos-tab press"
          :class="[isActive(tab.path) && 'pos-tab-active', tab.disabled && 'opacity-40']"
          :aria-current="isActive(tab.path) ? 'page' : undefined"
          :aria-disabled="tab.disabled || undefined"
          :aria-label="tab.hint ? `${tab.label}: ${tab.hint}` : tab.label"
          @click.prevent="go(tab)"
        >
          <span v-if="isActive(tab.path)" class="absolute inset-x-3 top-0 h-0.5 rounded-b bg-primary" aria-hidden="true"></span>

          <span class="relative">
            <svg class="h-6 w-6" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path v-for="(d, i) in tab.paths" :key="i" :d="d" fill-rule="evenodd" clip-rule="evenodd" />
            </svg>
            <span v-if="tab.badge" :key="'b' + tab.badge" :class="badgeClass">{{ tab.badge > 99 ? '99+' : tab.badge }}</span>
            <span v-else-if="tab.done" :class="doneClass" aria-hidden="true">
              <svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" /></svg>
            </span>
          </span>

          <!-- The table number / customer replaces the generic word once
               chosen: it is what a waiter actually needs to see. -->
          <span class="max-w-full truncate" :class="tab.hint && 'font-bold text-foreground bidi-isolate'">
            {{ tab.hint || tab.label }}
          </span>
        </a>
      </div>
    </nav>

    <!-- Tablet -->
    <nav class="pos-rail" :aria-label="$t('nav.primary')">
      <a
        v-for="tab in tabs"
        :key="'rail-' + tab.path"
        :href="'/urypos' + tab.path"
        class="pos-tab press"
        :class="[isActive(tab.path) && 'pos-tab-active', tab.disabled && 'opacity-40']"
        :aria-current="isActive(tab.path) ? 'page' : undefined"
        :aria-disabled="tab.disabled || undefined"
        @click.prevent="go(tab)"
      >
        <span v-if="isActive(tab.path)" class="absolute inset-y-2 start-0 w-1 rounded-e bg-primary" aria-hidden="true"></span>

        <span class="relative">
          <svg class="h-7 w-7" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path v-for="(d, i) in tab.paths" :key="i" :d="d" fill-rule="evenodd" clip-rule="evenodd" />
          </svg>
          <span v-if="tab.badge" :key="'b' + tab.badge" :class="badgeClass">{{ tab.badge > 99 ? '99+' : tab.badge }}</span>
          <span v-else-if="tab.done" :class="doneClass" aria-hidden="true">
            <svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" /></svg>
          </span>
        </span>

        <!-- Two lines allowed: Arabic labels like «سجل الطلبات» outgrow 6rem. -->
        <span class="line-clamp-2 max-w-full text-center leading-tight">{{ tab.label }}</span>
        <span
          v-if="tab.hint"
          class="max-w-full truncate rounded-md bg-muted px-1.5 text-[11px] font-bold text-foreground bidi-isolate"
        >{{ tab.hint }}</span>
      </a>
    </nav>
  </template>
</template>

<script>
import { useAuthStore } from "@/stores/Auth.js";
import { tabFunctions } from "@/stores/bottomTabs.js";
import { isInvoiceNavigationBlocked } from "@/router/invoiceNavigation.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { useMenuStore } from "@/stores/Menu.js";
import { useTableStore } from "@/stores/Table.js";
import { useCustomerStore } from "@/stores/Customer.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";

/** Icon path data, kept out of the template so the markup stays readable. */
const ICONS = {
  tables: [
    "M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  ],
  menu: [
    "M9 2a1 1 0 000 2h2a1 1 0 100-2H9z",
    "M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z",
  ],
  customer: ["M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"],
  cart: [
    "M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  ],
  orders: [
    "M14.066 0H7v5a2 2 0 0 1-2 2H0v11a1.97 1.97 0 0 0 1.934 2h12.132A1.97 1.97 0 0 0 16 18V2a1.97 1.97 0 0 0-1.934-2Zm-3 15H4.828a1 1 0 0 1 0-2h6.238a1 1 0 0 1 0 2Zm0-4H4.828a1 1 0 0 1 0-2h6.238a1 1 0 1 1 0 2Z",
    "M5 5V.13a2.96 2.96 0 0 0-1.293.749L.879 3.707A2.98 2.98 0 0 0 .13 5H5Z",
  ],
};

export default {
  name: "BottomTabs",
  setup() {
    return {
      auth: useAuthStore(),
      tabClick: tabFunctions(),
      invoiceData: useInvoiceDataStore(),
      menu: useMenuStore(),
      table: useTableStore(),
      customers: useCustomerStore(),
      recentOrders: usetoggleRecentOrder(),
    };
  },
  computed: {
    badgeClass() {
      return "absolute -end-2 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground tabular-nums animate-check-in";
    },
    doneClass() {
      return "absolute -end-1.5 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-card animate-check-in";
    },

    /** Lines, not units: "four things to send" is what a waiter reads. */
    cartCount() {
      return (this.menu.cart || []).length;
    },

    /** The table this order belongs to. */
    seatHint() {
      return this.table.selectedTable || this.recentOrders.restaurantTable || "";
    },

    customerHint() {
      const name = this.customers.search;
      const pax = parseInt(this.customers.numberOfPax, 10);
      if (name) return name;
      return pax > 0 ? this.$t("customer.pax_count", { count: pax }) : "";
    },

    tabs() {
      const list = [
        {
          path: "/Table",
          label: this.$t("tables.title"),
          paths: ICONS.tables,
          hint: this.seatHint,
          done: Boolean(this.seatHint),
        },
        {
          path: "/Menu",
          label: this.$t("menu.title"),
          paths: ICONS.menu,
          guard: () => this.tabClick.clickMenuTab(),
        },
        {
          path: "/Customer",
          label: this.$t("customer.title"),
          paths: ICONS.customer,
          hint: this.customerHint,
          done: Boolean(this.customerHint),
          guard: () => this.tabClick.checkActiveTable(),
        },
        {
          path: "/Cart",
          label: this.$t("cart.title"),
          paths: ICONS.cart,
          badge: this.cartCount,
          guard: () => this.tabClick.checkActiveTable(),
        },
      ];

      if (this.auth.cashier) {
        list.push({ path: "/recentOrder", label: this.$t("order.order_log"), paths: ICONS.orders });
      }

      // One rule decides what an open amendment blocks, shared with the
      // router guard (`router/invoiceNavigation.js`, UX-24).
      return list.map((tab) => ({
        ...tab,
        disabled: isInvoiceNavigationBlocked(this.invoiceData.invoiceUpdating, tab.path),
      }));
    },
  },
  methods: {
    isActive(path) {
      const current = this.tabClick.currentTab;
      return current === path || (path === "/Table" && current === "/");
    },

    go(tab) {
      if (tab.disabled || this.isActive(tab.path)) return;
      if (tab.guard && !tab.guard()) return;
      this.$router.push(tab.path);
    },
  },
};
</script>
