<template>
  <!--
    A table tile, shared by the dine-in grid and the takeaway grid (which used
    to be two diverging copies).

    Read from across a room: state is a coloured rail down the leading edge
    plus a word, the table name is the largest thing on the tile, and how
    long it has been seated sits right under it. Tapping the body of an
    occupied tile opens its order — the most common action on this screen.
  -->
  <article
    class="pos-card relative flex flex-col overflow-visible animate-fade-in-up stagger-fast"
    :class="isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'"
    :style="{ '--i': index }"
  >
    <span class="absolute inset-y-0 start-0 w-1.5 rounded-s-2xl" :class="rail" aria-hidden="true"></span>

    <header class="flex items-start justify-between gap-1 pe-1 ps-4 pt-3">
      <span :class="badge">
        <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>
        {{ $t('tables.state.' + state) }}
      </span>

      <!-- Secondary actions. Shown for every table: merge applies to a free
           one, transfers to an occupied one. It used to render only for free
           tables, which made both transfers unreachable. -->
      <div v-if="actions.length" class="relative" data-table-menu>
        <button
          type="button"
          class="pos-icon-btn h-9 w-9"
          :aria-label="$t('common.more_actions')"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          @click.stop="tableStore.toggleDropdown(table.name)"
        >
          <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </button>

        <div v-if="menuOpen" class="pos-menu end-0 start-auto w-52" role="menu">
          <button
            v-for="action in actions"
            :key="action.key"
            type="button"
            role="menuitem"
            class="pos-menu-item"
            @click.stop="runAction(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
    </header>

    <div
      class="flex-1 px-4 pt-1 text-center"
      :class="canOpenOrder && 'cursor-pointer'"
      @click="canOpenOrder && tableStore.routeToMenu(table)"
    >
      <TableScene :state="state" />
      <h2 class="flex items-center justify-center gap-1.5 text-2xl font-bold leading-tight text-foreground">
        <span class="truncate">{{ table.name }}</span>
        <svg
          v-if="table.merged_with"
          class="h-4 w-4 shrink-0 text-muted-foreground"
          fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          role="img"
          :aria-label="$t('tables.merged_table')"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </h2>

      <p
        v-if="isOccupied"
        class="mt-1 flex items-center justify-center gap-1 text-sm font-semibold tabular-nums bidi-isolate"
        :class="state === 'attention' ? 'text-destructive' : 'text-muted-foreground'"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path stroke-linecap="round" d="M12 7v5l3 2" />
        </svg>
        {{ elapsed }}
      </p>
      <p v-else class="mt-1 text-sm text-muted-foreground">
        {{ table.no_of_seats ? $t('tables.seats', { count: table.no_of_seats }) : '&nbsp;' }}
      </p>
    </div>

    <footer class="p-3">
      <button
        v-if="!isOccupied"
        type="button"
        class="pos-btn-primary w-full"
        :disabled="auth.restrictTableOrder"
        @click="!auth.restrictTableOrder && tableStore.addToSelectedTables(table)"
      >
        {{ $t('tables.open_table') }}
        <svg class="h-4 w-4 rtl-flip" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>

      <!-- Occupied: open the order. There is no "print bill" here any more;
           this interface sends no print commands. -->
      <button
        v-else
        type="button"
        class="pos-btn-ghost w-full"
        :disabled="auth.restrictTableOrder"
        @click="!auth.restrictTableOrder && tableStore.routeToCart(table)"
      >
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
          <path fill-rule="evenodd" clip-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        {{ $t('order.view_order') }}
      </button>
    </footer>
  </article>
</template>

<script>
import { useTableStore } from "@/stores/Table.js";
import { useAuthStore } from "@/stores/Auth.js";
import TableScene from "./TableScene.vue";

export default {
  name: "TableTile",
  components: { TableScene },
  props: {
    table: { type: Object, required: true },
    /** Position in the grid; only staggers the entrance animation. */
    index: { type: Number, default: 0 },
  },
  setup() {
    return {
      tableStore: useTableStore(),
      auth: useAuthStore(),
    };
  },
  computed: {
    isOccupied() {
      return this.table.occupied === 1;
    },
    isSelected() {
      return this.table.name === this.tableStore.selectedTable;
    },
    canOpenOrder() {
      return this.isOccupied && !this.auth.restrictTableOrder;
    },
    menuOpen() {
      return this.tableStore.activeDropdown === this.table.name;
    },
    /**
     * The store answers with a colour name ("green", "red", …) rather than a
     * state; it is mapped once here so the tile has one place deciding how a
     * state looks and what it is called.
     */
    state() {
      return (
        { green: "free", default: "active", yellow: "occupied", red: "attention" }[
          this.tableStore.getBadgeType(this.table)
        ] || "free"
      );
    },
    rail() {
      return {
        free: "bg-success",
        active: "bg-primary",
        occupied: "bg-warning",
        // The one state that needs a waiter to move; it pulses so it is
        // findable in a room of thirty tiles.
        attention: "bg-destructive animate-pulse-soft",
      }[this.state];
    },
    badge() {
      return {
        free: "pos-badge-success",
        active: "pos-badge-accent",
        occupied: "pos-badge-warning",
        attention: "pos-badge-danger",
      }[this.state];
    },
    /** `h:mm` — the store returns "1:5" for an hour and five minutes. */
    elapsed() {
      const [hours, minutes] = this.tableStore.getTimeDifference(this.table).split(":");
      return `${parseInt(hours, 10) || 0}:${String(parseInt(minutes, 10) || 0).padStart(2, "0")}`;
    },
    actions() {
      const list = [];
      if (!this.isOccupied) {
        list.push({ key: "merge", label: this.$t("tables.table_merge") });
      } else {
        list.push({ key: "transfer", label: this.$t("tables.table_transfer") });
        if (this.auth.hasAccess) {
          list.push({ key: "captain", label: this.$t("tables.captain_transfer") });
        }
      }
      return list;
    },
  },
  methods: {
    runAction(action) {
      const store = this.tableStore;
      store.hideDropdown();
      if (action.key === "merge") store.openMergeFreeModal(this.table);
      if (action.key === "transfer") {
        store.newTable = "";
        store.showModal = true;
      }
      if (action.key === "captain") {
        store.newCaptain = "";
        store.showModalCaptainTransfer = true;
      }
    },
  },
};
</script>
