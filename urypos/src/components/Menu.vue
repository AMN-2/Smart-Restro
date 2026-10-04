<template>
  <orderInfo />
  <RemoteChangeBanner />
  <div class="menu-workspace">
    <div class="min-w-0">
      <Search />

  <div
    v-if="menu.paginatedItems.length > 0"
    class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4"
  >
    <!--
      A menu item, built like the cashier POS card: picture, name, price,
      then the one control. Once an item is on the ticket the card turns
      amber and carries its count, so a long order can be checked while
      scrolling rather than only from the cart.
    -->
    <article
      v-for="(item, itemIndex) in menu.paginatedItems"
      :key="item.item"
      :style="{ '--i': itemIndex }"
      class="pos-card pos-product-card relative flex flex-col overflow-hidden animate-fade-in-up stagger-fast transition-colors duration-fast"
      :class="item.qty ? 'border-accent ring-1 ring-accent/60' : ''"
    >
      <span
        v-if="item.qty"
        class="absolute end-2 top-2 z-10 inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-accent px-1.5 text-sm font-bold tabular-nums text-accent-foreground shadow-card animate-check-in"
      >
        {{ item.qty }}
      </span>

      <div v-if="auth.viewItemImage" class="w-full overflow-hidden bg-muted" :class="item.item_image ? 'aspect-[4/3]' : 'aspect-[16/7]'">
        <img
          v-if="item.item_image"
          :src="menu.getFullImagePath(item.item_image)"
          :alt="item.item_name"
          loading="lazy"
          class="h-full w-full object-cover"
        />
        <!-- No photo: initials drawn locally, never a remote placeholder. -->
        <div v-else class="flex h-full w-full items-center justify-center bg-secondary">
          <span class="text-3xl font-bold text-primary/70">{{ menu.itemNameExtract(item.item_name) }}</span>
        </div>
      </div>

      <div class="flex flex-1 flex-col p-3">
        <h2 class="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-foreground">
          {{ item.item_name }}
        </h2>
        <p class="pos-money mt-1 text-base text-primary">{{ money(item.rate) }}</p>

        <div class="mt-auto pt-3">
          <button
            v-if="!item.qty"
            type="button"
            class="pos-btn-ghost press w-full"
            @click="item.showInput = true; menu.addToCart(item)"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            {{ $t('common.add') }}
          </button>

          <div v-else class="pos-stepper w-full">
            <button
              type="button"
              class="press"
              :disabled="Boolean(recentOrders.restaurantTable) || !canRemove"
              :aria-label="$t('cart.decrease')"
              @click="menu.decrementItemQuantity(item)"
            >&minus;</button>
            <button
              type="button"
              class="pos-stepper-value flex-1"
              :aria-label="$t('cart.edit_line')"
              @click="menu.showModal(item)"
            >{{ item.qty }}</button>
            <button
              type="button"
              class="press"
              :aria-label="$t('cart.increase')"
              @click="menu.incrementItemQuantity(item)"
            >+</button>
          </div>
        </div>
      </div>
    </article>
  </div>

  <PosEmpty
    v-else
    :title="menu.items.length === 0 ? $t('menu.items_not_found') : $t('menu.no_match_title')"
    :body="menu.items.length === 0 ? $t('menu.items_not_found_hint') : $t('menu.no_match_body')"
  >
    <template #icon>
      <svg class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </template>
    <button v-if="menu.items.length" type="button" class="pos-btn-ghost" @click="resetFilters">
      {{ $t('menu.clear_filters') }}
    </button>
  </PosEmpty>

  <PosPagination
    v-if="menu.paginatedItems.length > 0"
    :page="menu.currentPage"
    :total-pages="menu.totalPages"
    :has-next="menu.currentPage < menu.totalPages"
    @previous="goToPage(menu.currentPage - 1)"
    @next="goToPage(menu.currentPage + 1)"
  />
    </div>
    <MenuCartRail class="hidden xl:flex" />
  </div>

  <!-- Room for the order bar, so the last row of cards is never under it. -->
  <div v-if="menu.cart.length" class="h-24 xl:hidden" aria-hidden="true"></div>

  <!--
    The ticket, always one glance away.

    Taking an order used to mean hopping to the Cart step to check what was
    on it and what it came to. The running count and total now ride along
    the bottom of the menu, and one tap goes to review and send.
  -->
  <div v-if="menu.cart.length" class="pos-actionbar animate-fade-in-up xl:hidden">
    <div class="mx-auto flex max-w-7xl items-center gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
          <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
          </svg>
          <span class="absolute -end-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
            {{ menu.cart.length }}
          </span>
        </span>
        <span class="min-w-0">
          <span class="block truncate text-xs font-semibold text-muted-foreground">
            {{ $t('cart.items_count', { count: menu.cart.length }) }}
          </span>
          <span class="pos-money block text-lg text-foreground">{{ money(menu.grand_total) }}</span>
        </span>
      </div>
      <router-link to="/Cart" class="pos-btn-primary pos-btn-lg shrink-0">
        {{ $t('cart.review_order') }}
        <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </router-link>
    </div>
  </div>

  <ItemDialog />
</template>

<script>
import Search from "./Search.vue";
import MenuCartRail from "./MenuCartRail.vue";
import orderInfo from "./orderInfo.vue";
import ItemDialog from "./ItemDialog.vue";
import RemoteChangeBanner from "./RemoteChangeBanner.vue";
import PosEmpty from "./ui/PosEmpty.vue";
import PosPagination from "./ui/PosPagination.vue";
import { useMenuStore } from "@/stores/Menu.js";
import { useAuthStore } from "@/stores/Auth.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";

export default {
  name: "Menu",
  components: { Search, MenuCartRail, orderInfo, ItemDialog, PosEmpty, PosPagination, RemoteChangeBanner },
  setup() {
    return {
      menu: useMenuStore(),
      auth: useAuthStore(),
      recentOrders: usetoggleRecentOrder(),
      invoiceData: useInvoiceDataStore(),
    };
  },
  computed: {
    /**
     * Whether this till may take items back off a ticket. Drives both the
     * disabled look and the guard, so the two cannot disagree.
     */
    canRemove() {
      return this.recentOrders.editPrintedInvoice === 0 || this.auth.removeTableOrderItem === 1;
    },
  },
  mounted() {
    window.scrollTo(0, 0);
  },
  methods: {
    money(value) {
      return `${this.invoiceData.currency || ""} ${value ?? ""}`.trim();
    },
    goToPage(page) {
      this.menu.currentPage = page;
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    resetFilters() {
      this.menu.showAllItems();
      this.menu.currentPage = 1;
    },
  },
};
</script>
