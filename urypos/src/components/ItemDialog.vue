<template>
  <!--
    Quantity and kitchen note for one line. Menu and Cart each carried their
    own copy of this form; there is one now, opened by `menu.showModal(item)`.
  -->
  <PosDialog
    :open="open"
    :title="menu.item && menu.item.item_name ? menu.item.item_name : $t('common.enter_details')"
    size="sm"
    @close="close"
  >
    <div class="space-y-4">
      <div>
        <span class="pos-form-label">{{ $t('menu.quantity') }}</span>
        <div class="pos-stepper w-full">
          <button type="button" class="press" :disabled="qtyLocked || current <= 1" :aria-label="$t('cart.decrease')" @click="step(-1)">&minus;</button>
          <input
            id="itemQuantity"
            type="number"
            inputmode="numeric"
            min="1"
            class="pos-stepper-value flex-1 bg-card text-center focus:outline-none"
            v-model.number="menu.quantity"
            :readonly="qtyLocked"
            :aria-label="$t('menu.quantity')"
          />
          <button type="button" class="press" :disabled="qtyLocked" :aria-label="$t('cart.increase')" @click="step(1)">+</button>
        </div>
        <p v-if="qtyLocked" class="mt-1.5 text-xs text-muted-foreground">{{ $t('cart.qty_locked') }}</p>
      </div>

      <div>
        <label for="itemComments" class="pos-form-label">{{ $t('order.kitchen_note') }}</label>
        <textarea
          id="itemComments"
          rows="2"
          class="pos-input h-auto py-2.5"
          :placeholder="$t('order.kitchen_note_hint')"
          v-model="menu.itemComments"
        ></textarea>
      </div>
    </div>

    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="close">{{ $t('common.cancel') }}</button>
      <button type="button" class="pos-btn-primary" :disabled="!(current > 0)" @click="menu.addToCartAndUpdateQty()">
        {{ $t('common.save') }}
      </button>
    </template>
  </PosDialog>
</template>

<script>
import PosDialog from "./ui/PosDialog.vue";
import { useMenuStore } from "@/stores/Menu.js";
import { useAuthStore } from "@/stores/Auth.js";
import { usetoggleRecentOrder } from "@/stores/recentOrder.js";

export default {
  name: "ItemDialog",
  components: { PosDialog },
  setup() {
    return { menu: useMenuStore(), auth: useAuthStore(), recentOrders: usetoggleRecentOrder() };
  },
  computed: {
    open() {
      return Boolean(this.menu.showDialog || this.menu.showDialogCart);
    },
    current() {
      return Number(this.menu.quantity) || 0;
    },
    /** A printed bill can only be reduced by a role allowed to remove items. */
    qtyLocked() {
      return (
        Boolean(this.recentOrders.restaurantTable) ||
        (this.recentOrders.editPrintedInvoice === 1 && this.auth.removeTableOrderItem === 0)
      );
    },
  },
  methods: {
    step(delta) {
      this.menu.quantity = Math.max(1, this.current + delta);
    },
    close() {
      this.menu.showDialog = false;
      this.menu.showDialogCart = false;
    },
  },
};
</script>
