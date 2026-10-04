<template>
  <!-- Store-driven yes/no confirmation, on the shared dialog. -->
  <PosDialog
    :open="Boolean(modal.isOpen)"
    :title="modal.title || $t('common.confirm')"
    size="sm"
    :dismissible="false"
  >
    <p class="whitespace-pre-line text-sm text-foreground">{{ modal.message }}</p>
    <template #footer>
      <button v-if="modal.showCancelButton" type="button" class="pos-btn-ghost" @click="modal.handleCancel">
        {{ $t('common.no') }}
      </button>
      <button type="button" class="pos-btn-primary" @click="modal.handleConfirm">{{ $t('common.yes') }}</button>
    </template>
  </PosDialog>
</template>

<script>
import { defineComponent } from "vue";
import { useNotificationModal } from "../stores/NotificationModal";
import PosDialog from "./ui/PosDialog.vue";

export default defineComponent({
  name: "NotificationModal",
  components: { PosDialog },
  setup() {
    return { modal: useNotificationModal() };
  },
});
</script>
