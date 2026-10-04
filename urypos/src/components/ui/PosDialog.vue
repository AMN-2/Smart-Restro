<template>
  <!--
    The one dialog every screen uses.

    Before this there were a dozen hand-built modals, each `fixed inset-0
    mt-20 bg-muted` with a stray close icon and `text-left` headings, so they
    sat at different heights, ignored Escape, and broke in Arabic. This one is
    teleported to <body> (above the chrome), centred, closes on Escape and on
    the backdrop, and lays its footer out with logical properties.
  -->
  <Teleport to="body">
    <div v-if="open" class="pos-overlay z-50 overflow-y-auto" @click.self="dismissible && $emit('close')">
      <div class="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4" @click.self="dismissible && $emit('close')">
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          class="w-full rounded-t-3xl border border-border bg-card shadow-raised outline-none animate-scale-in sm:rounded-2xl"
          :class="sizeClass"
        >
          <header class="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div class="min-w-0">
              <h2 class="pos-title">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
            </div>
            <button
              v-if="dismissible"
              type="button"
              class="pos-icon-btn -me-2 -mt-2"
              :aria-label="$t('common.close')"
              @click="$emit('close')"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div class="px-5 pb-5 pt-4 sm:px-6">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="flex flex-col-reverse gap-2 border-t border-border bg-muted/50 px-5 py-4 sm:flex-row sm:justify-end sm:rounded-b-2xl sm:px-6"
            :style="{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
export default {
  name: "PosDialog",
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    /** sm: confirmations · md: forms · lg: payment and wide content. */
    size: { type: String, default: "md" },
    /** False for dialogs that must be answered (no ✕, no backdrop close). */
    dismissible: { type: Boolean, default: true },
  },
  emits: ["close"],
  data() { return { previousFocus: null }; },
  computed: {
    sizeClass() {
      return { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-2xl" }[this.size] || "sm:max-w-md";
    },
  },
  watch: {
    open: {
      immediate: true,
      handler(isOpen) {
        if (isOpen) {
          this.previousFocus = document.activeElement;
          document.addEventListener("keydown", this.onKeydown);
          this.$nextTick(() => this.$refs.panel && this.$refs.panel.focus());
        } else {
          document.removeEventListener("keydown", this.onKeydown);
          if (this.previousFocus?.isConnected) this.previousFocus.focus();
        }
      },
    },
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.onKeydown);
  },
  methods: {
    onKeydown(event) {
      const panel = this.$refs.panel;
      if (!panel) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== panel) return;
      if (event.key === "Escape" && this.dismissible) {
        event.preventDefault();
        this.$emit("close");
      }
      if (event.key === "Tab") {
        const nodes = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
      }
    },
  },
};
</script>
