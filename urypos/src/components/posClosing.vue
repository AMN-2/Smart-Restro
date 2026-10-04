<template>
  <header class="pos-page-header">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-bold text-foreground">{{ $t('pos.closing_entry') }}</h1>
      <span v-if="posClose.getBadgeText()" :class="badge">{{ statusText }}</span>
    </div>
    <div class="flex gap-2">
      <button v-if="posClose.posClosing" type="button" class="pos-btn-primary" @click="posClose.savePosClosing()">
        {{ $t('common.save') }}
      </button>
      <button v-if="posClose.posCloseSaved" type="button" class="pos-btn-primary" @click="posClose.showSumbitPosCloseModal()">
        {{ $t('common.submit') }}
      </button>
    </div>
  </header>

  <div class="space-y-5">
    <section class="pos-card p-4 sm:p-5">
      <p class="pos-section-title">{{ $t('pos.period_details') }}</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label for="startDate" class="pos-form-label">{{ $t('pos.period_start') }}</label>
          <input id="startDate" v-model="posClose.startDate" readonly class="pos-input bg-muted/60" type="text" />
        </div>
        <div>
          <label for="postingDate" class="pos-form-label">{{ $t('pos.posting_date') }}</label>
          <input id="postingDate" v-model="posClose.postingDate" readonly class="pos-input bg-muted/60" type="text" />
        </div>
        <div>
          <span class="pos-form-label">{{ $t('pos.period_end') }}</span>
          <date-picker v-model:value="posClose.periodEndDate" :default-value="new Date()" type="datetime" />
        </div>
        <div>
          <span class="pos-form-label">{{ $t('pos.posting_time') }}</span>
          <date-picker v-model:value="posClose.postingTime" :default-value="posClose.postingTime" type="time" />
        </div>
        <div class="relative md:col-span-2" data-autocomplete>
          <label for="posOpen" class="pos-form-label">{{ $t('pos.opening_entry') }}</label>
          <input
            id="posOpen"
            type="text"
            class="pos-input"
            autocomplete="off"
            v-model="posClose.selectedPosOpenEntry"
            @click="posClose.selectPosOpen()"
            required
          />
          <div v-if="posClose.showPosOpen && posClose.posOpenEntries.length" class="pos-menu" role="listbox">
            <button
              v-for="entry in posClose.posOpenEntries"
              :key="entry.name"
              type="button"
              role="option"
              class="pos-menu-item"
              @click="posClose.selectPos(entry)"
            >
              {{ entry.name }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="pos-card p-4 sm:p-5">
      <p class="pos-section-title">{{ $t('pos.user_details') }}</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label for="company" class="pos-form-label">{{ $t('pos.company') }}</label>
          <input id="company" type="text" class="pos-input" v-model="invoiceData.company" required />
        </div>
        <div>
          <label for="posProfile" class="pos-form-label">{{ $t('pos.profile') }}</label>
          <input id="posProfile" type="text" class="pos-input" v-model="invoiceData.posProfile" required />
        </div>
        <div>
          <label for="cashier" class="pos-form-label">{{ $t('pos.cashier') }}</label>
          <input id="cashier" type="text" class="pos-input" v-model="posClose.cashier" required />
        </div>
      </div>
    </section>

    <section v-if="posClose.openingBalance.length > 0" class="pos-card overflow-hidden">
      <div class="px-4 pt-4 sm:px-5">
        <p class="pos-section-title mb-1">{{ $t('payment.modes') }}</p>
        <p class="mb-3 text-sm text-muted-foreground">{{ $t('payment.reconciliation') }}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="pos-table">
          <thead>
            <tr>
              <th scope="col">{{ $t('payment.mode') }}</th>
              <th scope="col" class="w-44 text-end">{{ $t('pos.opening_amount') }}</th>
              <th scope="col" class="w-44 text-end">{{ $t('pos.closing_amount') }}</th>
              <th scope="col" class="w-14"><span class="sr-only">{{ $t('common.delete') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(mode, index) in posClose.openingBalance" :key="mode.mode_of_payment">
              <th scope="row" class="whitespace-nowrap px-4 py-2.5 text-start font-semibold text-foreground">{{ mode.mode_of_payment }}</th>
              <td><input type="number" inputmode="decimal" :aria-label="$t('pos.opening_amount')" v-model="mode.opening_amount" /></td>
              <td><input type="number" inputmode="decimal" :aria-label="$t('pos.closing_amount')" v-model.number="mode.closing_amount" /></td>
              <td class="text-end">
                <button
                  type="button"
                  class="pos-icon-btn h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  :aria-label="$t('common.delete')"
                  @click="posClose.deleteRow(index)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pos-card p-4 sm:p-5">
      <p class="pos-section-title">{{ $t('totals.title') }}</p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label for="grandTotal" class="pos-form-label">{{ $t('totals.grand_total') }}</label>
          <input id="grandTotal" type="text" class="pos-input tabular-nums" v-model="posClose.grandTotal" required />
        </div>
        <div>
          <label for="netTotal" class="pos-form-label">{{ $t('totals.net_total') }}</label>
          <input id="netTotal" type="text" class="pos-input tabular-nums" v-model="posClose.netTotal" required />
        </div>
        <div>
          <label for="totalInvoices" class="pos-form-label">{{ $t('totals.total_invoices') }}</label>
          <input id="totalInvoices" type="text" class="pos-input tabular-nums" v-model="posClose.totalInvoices" required />
        </div>
        <div>
          <label for="totalQty" class="pos-form-label">{{ $t('totals.total_quantity') }}</label>
          <input id="totalQty" type="text" class="pos-input tabular-nums" v-model="posClose.totalQty" required />
        </div>
      </div>
    </section>
  </div>

  <PosDialog
    :open="posClose.showSumbitPosclose"
    :title="$t('common.confirm')"
    :description="$t('pos.confirm_submit', { name: posClose.posClosingEntry || '' })"
    size="sm"
    @close="posClose.showSumbitPosclose = false"
  >
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="posClose.showSumbitPosclose = false">{{ $t('common.no') }}</button>
      <button type="button" class="pos-btn-primary" @click="posClose.sumbitPosClosing()">{{ $t('common.submit') }}</button>
    </template>
  </PosDialog>
</template>

<script>
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { posClosing } from "@/stores/posClosing.js";
import PosDialog from "./ui/PosDialog.vue";
import DatePicker from "vue-datepicker-next";
import "vue-datepicker-next/index.css";

export default {
  name: "posClose",
  components: { DatePicker, PosDialog },
  setup() {
    return { invoiceData: useInvoiceDataStore(), posClose: posClosing() };
  },
  computed: {
    badge() {
      return this.posClose.getBadgeType() === "red" ? "pos-badge-danger" : "pos-badge-accent";
    },
    statusText() {
      const text = this.posClose.getBadgeText();
      return { Draft: this.$t("status.draft"), Submitted: this.$t("status.submitted") }[text] || text;
    },
  },
  mounted() {
    this.posClose.setFormattedDate();
    document.addEventListener("click", this.closeMenus);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.closeMenus);
  },
  methods: {
    closeMenus(event) {
      const target = event.target;
      if (target instanceof Element && !target.closest("[data-autocomplete]")) this.posClose.showPosOpen = false;
    },
  },
};
</script>
