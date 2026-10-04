<template>
  <orderInfo />

  <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <!--
      Who the order is for. Four loose full-width inputs with icons pinned
      to the left (wrong side in Arabic) became one card of labelled fields,
      with the guest count as a stepper — the thing a waiter changes most.
    -->
    <section class="pos-card space-y-5 p-4 sm:p-5">
      <div class="relative" data-autocomplete>
        <label for="customerSearch" class="pos-form-label">{{ $t('customer.title') }}</label>
        <div class="pos-search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="customerSearch"
            type="search"
            class="pos-input"
            autocomplete="off"
            :placeholder="$t('customer.search')"
            :value="customers.search"
            :disabled="customerLocked"
            @input="customers.handleSearchInput"
            @focus="customers.searchCustomer()"
          />
        </div>
        <p v-if="customerLocked && customers.search" class="mt-1.5 text-xs text-muted-foreground">
          {{ $t('customer.locked_hint') }}
        </p>

        <div v-if="customers.showCustomers && customers.showAddNewCustomer && !customerLocked" class="pos-menu" role="listbox">
          <button
            v-for="customer in customers.customer"
            :key="customer.name"
            type="button"
            role="option"
            class="pos-menu-item"
            @click="customers.selectCustomer(customer)"
          >
            {{ customer.name }}
            <small v-if="customer.mobile_number || customer.content" class="bidi-isolate">
              {{ customer.mobile_number || customers.extractName(customer.content) }}
            </small>
          </button>
          <button
            type="button"
            class="pos-menu-item flex-row items-center justify-start gap-2 text-primary"
            @click="customers.showCustomers = false; customers.newCustomerData(customers.search)"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            {{ customers.search ? $t('customer.create_named', { name: customers.search }) : $t('customer.create_new') }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label for="mobileNumber" class="pos-form-label">{{ $t('customer.mobile') }}</label>
          <input
            id="mobileNumber"
            type="tel"
            class="pos-input bg-muted/60 bidi-isolate"
            readonly
            :value="customers.newCustomerMobileNo || recentOrders.mobileNumber || table.mobileNumber"
            :placeholder="$t('customer.mobile_auto')"
          />
        </div>

        <div>
          <span class="pos-form-label">{{ $t('customer.guests') }}</span>
          <div class="pos-stepper w-full">
            <button type="button" class="press" :disabled="pax <= 1" :aria-label="$t('cart.decrease')" @click="setPax(pax - 1)">&minus;</button>
            <input
              id="numberOfPax"
              type="number"
              inputmode="numeric"
              min="1"
              class="pos-stepper-value flex-1 bg-card text-center focus:outline-none"
              :placeholder="$t('cart.pax')"
              v-model="customers.numberOfPax"
              :aria-label="$t('customer.guests')"
              @input="customers.validateInput"
            />
            <button type="button" class="press" :disabled="pax >= 999" :aria-label="$t('cart.increase')" @click="setPax(pax + 1)">+</button>
          </div>
        </div>

      </div>

      <button type="button" class="pos-btn-primary pos-btn-lg w-full sm:w-auto" @click="tabClick.clickMenuTab() && $router.push('/Menu')">
        {{ $t('customer.continue_to_menu') }}
        <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </section>

    <!-- What this customer usually orders. -->
    <section v-if="favourites.length" class="pos-card overflow-hidden">
      <header class="border-b border-border bg-muted/60 px-4 py-3">
        <p class="pos-label">{{ $t('menu.favourite_items') }}</p>
      </header>
      <ul class="divide-y divide-border">
        <li v-for="(item, index) in favourites" :key="index" class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span class="min-w-0 truncate font-semibold text-foreground">{{ item.item_name }}</span>
          <span class="pos-badge-neutral tabular-nums">× {{ item.qty }}</span>
        </li>
      </ul>
    </section>
  </div>

  <PosDialog
    :open="customers.showModalNewCustomer"
    :title="$t('customer.new')"
    @close="customers.showModalNewCustomer = false"
  >
    <div class="space-y-4">
      <div>
        <label for="newCustomer" class="pos-form-label">{{ $t('customer.name') }} *</label>
        <input id="newCustomer" type="text" class="pos-input" v-model="customers.newCustomer" />
      </div>
      <div>
        <label for="newMobile" class="pos-form-label">{{ $t('customer.mobile') }} *</label>
        <input id="newMobile" type="tel" inputmode="tel" class="pos-input bidi-isolate" v-model="customers.newCustomerMobileNo" />
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="relative" data-autocomplete>
          <label for="customerGroup" class="pos-form-label">{{ $t('customer.group') }}</label>
          <input
            id="customerGroup"
            type="text"
            class="pos-input"
            autocomplete="off"
            v-model="customers.customerGroup"
            @focus="customers.showCustomersGroup = true; customers.pickCustomerGroup()"
          />
          <div v-if="customers.showCustomersGroup && customers.customerGroupList.length" class="pos-menu" role="listbox">
            <button
              v-for="group in customers.customerGroupList"
              :key="group.name"
              type="button"
              role="option"
              class="pos-menu-item"
              @click="customers.selectCustomerGroup(group)"
            >
              {{ group.name }}
            </button>
          </div>
        </div>
        <div class="relative" data-autocomplete>
          <label for="territory" class="pos-form-label">{{ $t('customer.territory') }}</label>
          <input
            id="territory"
            type="text"
            class="pos-input"
            autocomplete="off"
            v-model="customers.customerTerritory"
            @focus="customers.showCustomersTerritory = true; customers.pickCustomerTerritory()"
          />
          <div v-if="customers.showCustomersTerritory && customers.customerTerritoryList.length" class="pos-menu" role="listbox">
            <button
              v-for="territory in customers.customerTerritoryList"
              :key="territory.name"
              type="button"
              role="option"
              class="pos-menu-item"
              @click="customers.selectCustomerTerritory(territory)"
            >
              {{ territory.name }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="customers.showModalNewCustomer = false">{{ $t('common.cancel') }}</button>
      <button type="button" class="pos-btn-primary" @click="customers.addNewCustomer()">{{ $t('common.save') }}</button>
    </template>
  </PosDialog>
</template>

<script>
import orderInfo from "./orderInfo.vue";
import PosDialog from "./ui/PosDialog.vue";
import { useCustomerStore } from "@/stores/Customer.js";
import { useAuthStore } from "@/stores/Auth.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";
import { useMenuStore } from "@/stores/Menu.js";
import { useTableStore } from "@/stores/Table.js";
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { tabFunctions } from "@/stores/bottomTabs.js";

export default {
  name: "Customer",
  components: { orderInfo, PosDialog },
  setup() {
    return {
      table: useTableStore(),
      customers: useCustomerStore(),
      auth: useAuthStore(),
      recentOrders: usetoggleRecentOrder(),
      menu: useMenuStore(),
      invoiceData: useInvoiceDataStore(),
      tabClick: tabFunctions(),
    };
  },
  computed: {
    /** An aggregator order, or one reopened from the log, keeps its customer. */
    customerLocked() {
      return this.menu.selectedOrderType === "Aggregators" || this.recentOrders.previousOrderdCustomer !== "";
    },
    pax() {
      return parseInt(this.customers.numberOfPax, 10) || 0;
    },
    favourites() {
      return Array.isArray(this.customers.customerFavouriteItems) ? this.customers.customerFavouriteItems : [];
    },
  },
  mounted() {
    document.addEventListener("click", this.closeMenus);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.closeMenus);
  },
  methods: {
    setPax(value) {
      this.customers.numberOfPax = Math.min(999, Math.max(1, value));
    },
    closeMenus(event) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-autocomplete]")) return;
      this.customers.showCustomers = false;
      this.customers.showCustomersGroup = false;
      this.customers.showCustomersTerritory = false;
    },
  },
};
</script>
