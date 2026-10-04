<template>
  <header class="pos-page-header">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-bold text-foreground">{{ $t('pos.opening_entry') }}</h1>
      <span v-if="posOpen.getBadgeText()" :class="badge">{{ statusText }}</span>
    </div>
    <div class="flex gap-2">
      <button v-if="posOpen.posOpencreation" type="button" class="pos-btn-primary" @click="posOpen.savePosOpening()">
        {{ $t('common.save') }}
      </button>
      <button v-if="posOpen.posOpenSaved" type="button" class="pos-btn-primary" @click="posOpen.showSumbitPosOpenModal()">
        {{ $t('common.submit') }}
      </button>
    </div>
  </header>

  <div class="space-y-5">
    <section class="pos-card p-4 sm:p-5">
      <p class="pos-section-title">{{ $t('pos.period_details') }}</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <span class="pos-form-label">{{ $t('pos.period_start') }}</span>
          <date-picker v-model:value="posOpen.startDate" :default-value="new Date()" type="datetime" />
        </div>
        <div>
          <label for="postingDate" class="pos-form-label">{{ $t('pos.posting_date') }}</label>
          <input id="postingDate" v-model="posOpen.postingDate" readonly class="pos-input bg-muted/60" type="text" />
        </div>
      </div>
    </section>

    <section class="pos-card p-4 sm:p-5">
      <p class="pos-section-title">{{ $t('pos.user_details') }}</p>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label for="company" class="pos-form-label">{{ $t('pos.company') }}</label>
          <input id="company" type="text" class="pos-input" v-model="invoiceData.company" required />
        </div>
        <div>
          <label for="cashier" class="pos-form-label">{{ $t('pos.cashier') }}</label>
          <input id="cashier" type="text" class="pos-input" v-model="invoiceData.cashier" required />
        </div>
        <div>
          <label for="posProfile" class="pos-form-label">{{ $t('pos.profile') }}</label>
          <input id="posProfile" type="text" class="pos-input" v-model="invoiceData.posProfile" required />
        </div>
        <div>
          <label for="branch" class="pos-form-label">{{ $t('pos.branch') }}</label>
          <input id="branch" type="text" class="pos-input" v-model="invoiceData.branch" required />
        </div>
      </div>
    </section>

    <section class="pos-card overflow-hidden">
      <p class="pos-section-title px-4 pt-4 sm:px-5">{{ $t('pos.opening_balance_details') }}</p>
      <div class="overflow-x-auto">
        <table class="pos-table">
          <thead>
            <tr>
              <th scope="col">{{ $t('payment.mode') }}</th>
              <th scope="col" class="w-48 text-end">{{ $t('pos.opening_amount') }}</th>
              <th scope="col" class="w-14"><span class="sr-only">{{ $t('common.delete') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(mode, index) in invoiceData.modeOfPaymentList" :key="mode.mode_of_payment">
              <th scope="row" class="whitespace-nowrap px-4 py-2.5 text-start font-semibold text-foreground">{{ mode.mode_of_payment }}</th>
              <td>
                <input
                  type="number"
                  inputmode="decimal"
                  :aria-label="$t('pos.opening_amount')"
                  v-model="mode.opening_amount"
                />
              </td>
              <td class="text-end">
                <button
                  type="button"
                  class="pos-icon-btn h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  :aria-label="$t('common.delete')"
                  @click="posOpen.deleteRow(index)"
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
  </div>

  <PosDialog
    :open="posOpen.showSumbitPosOpen"
    :title="$t('common.confirm')"
    :description="$t('pos.confirm_submit', { name: posOpen.posOpenEntryName || '' })"
    size="sm"
    @close="posOpen.showSumbitPosOpen = false"
  >
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="posOpen.showSumbitPosOpen = false">{{ $t('common.no') }}</button>
      <button type="button" class="pos-btn-primary" @click="posOpen.sumbitPosOpening()">{{ $t('common.submit') }}</button>
    </template>
  </PosDialog>
</template>

<script>
import { useInvoiceDataStore } from "@/stores/invoiceData.js";
import { posOpening } from "@/stores/posOpening.js";
import PosDialog from "./ui/PosDialog.vue";
import DatePicker from "vue-datepicker-next";
import "vue-datepicker-next/index.css";

export default {
  name: "posOpen",
  components: { DatePicker, PosDialog },
  setup() {
    return { invoiceData: useInvoiceDataStore(), posOpen: posOpening() };
  },
  computed: {
    badge() {
      return this.posOpen.getBadgeType() === "red" ? "pos-badge-danger" : "pos-badge-warning";
    },
    statusText() {
      const text = this.posOpen.getBadgeText();
      return { Draft: this.$t("status.draft"), Open: this.$t("status.open") }[text] || text;
    },
  },
  mounted() {
    this.posOpen.setFormattedDate();
  },
};
</script>
