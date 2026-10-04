<template>
  <PosBusy :show="table.openingTable" :label="$t('order.updating')" />
  <!--
    Where am I, and what am I looking at.

    Rooms are chips rather than a dropdown: a waiter switches rooms all
    shift, and a chip row shows every room at once and takes one tap. A
    long list of rooms scrolls sideways instead of wrapping.
  -->
  <section class="mb-5 space-y-3">
    <div v-if="table.rooms.length" class="pos-chip-row" role="tablist" :aria-label="$t('tables.select_room')">
      <button
        v-for="room in table.rooms"
        :key="room.name"
        type="button"
        role="tab"
        class="pos-chip press"
        :class="table.selectedRoom === room.name && 'pos-chip-active'"
        :aria-selected="table.selectedRoom === room.name"
        @click="selectRoom(room.name)"
      >
        {{ room.name }}
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="pos-segment" role="group" :aria-label="$t('tables.title')">
        <button
          v-for="option in tableTypeOptions"
          :key="String(option.takeaway)"
          type="button"
          class="pos-segment-item press"
          :class="table.isTakeaeay === option.takeaway && 'pos-segment-item-active'"
          :aria-pressed="table.isTakeaeay === option.takeaway"
          @click="table.isTakeaeay !== option.takeaway && table.toggleTableTypeSwitch()"
        >
          {{ option.label }}
        </button>
      </div>

      <!-- "Occupied only" is how a busy floor is worked: free tables are
           noise while orders are being chased. Remembered per device. -->
      <button
        v-if="roomTables.length"
        type="button"
        class="pos-chip press"
        :class="occupiedOnly && 'pos-chip-active'"
        :aria-pressed="occupiedOnly ? 'true' : 'false'"
        @click="toggleOccupiedOnly"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
        </svg>
        {{ $t('tables.occupied_only') }}
        <span class="pos-chip-count">{{ counts.occupied + counts.attention }}</span>
      </button>

      <!-- At-a-glance counts for the room on screen. -->
      <div v-if="roomTables.length" class="ms-auto flex flex-wrap items-center gap-2">
        <span class="pos-badge-success">{{ $t('tables.free_count', { count: counts.free }) }}</span>
        <span class="pos-badge-warning">{{ $t('tables.occupied_count', { count: counts.occupied }) }}</span>
        <span v-if="counts.attention" class="pos-badge-danger">
          {{ $t('tables.attention_count', { count: counts.attention }) }}
        </span>
      </div>
    </div>
  </section>

  <div
    v-if="visibleTables.length"
    class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
  >
    <TableTile v-for="(tile, i) in visibleTables" :key="tile.name" :table="tile" :index="i" />
  </div>

  <PosEmpty
    v-else-if="occupiedOnly && roomTables.length"
    :title="$t('tables.no_occupied_title')"
    :body="$t('tables.no_occupied_body')"
  >
    <button type="button" class="pos-btn-secondary" @click="toggleOccupiedOnly">
      {{ $t('tables.show_all_tables') }}
    </button>
  </PosEmpty>

  <PosEmpty
    v-else
    :title="table.isTakeaeay ? $t('tables.none_takeaway_title') : $t('tables.none_title')"
    :body="table.selectedRoom
      ? (table.isTakeaeay ? $t('tables.none_takeaway_for_room') : $t('tables.none_for_room'))
      : $t('tables.pick_room_hint')"
  >
    <template #icon>
      <svg class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    </template>
  </PosEmpty>

  <!-- Table transfer: move an open order to a free table. -->
  <PosDialog
    :open="table.showModal"
    :title="$t('tables.table_transfer')"
    :description="$t('tables.transfer_hint', { table: table.tableName })"
    @close="table.showModal = false"
  >
    <div class="space-y-4">
      <div>
        <span class="pos-form-label">{{ $t('tables.current_table') }}</span>
        <p class="rounded-xl bg-muted px-3.5 py-2.5 text-base font-bold text-foreground">{{ table.tableName }}</p>
      </div>
      <div class="relative" data-autocomplete>
        <label for="newTable" class="pos-form-label">{{ $t('tables.new_table') }}</label>
        <input
          id="newTable"
          type="text"
          class="pos-input"
          autocomplete="off"
          :placeholder="$t('tables.search_free_table')"
          v-model="table.newTable"
          @focus="table.showTable = true; table.tableSearch()"
        />
        <div v-if="table.showTable && table.searchTable.length" class="pos-menu" role="listbox">
          <button
            v-for="option in table.searchTable"
            :key="option.name"
            type="button"
            role="option"
            class="pos-menu-item"
            @click="table.selectTable(option)"
          >
            {{ option.name }}
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="table.showModal = false">{{ $t('common.cancel') }}</button>
      <button
        type="button"
        class="pos-btn-primary"
        :disabled="!table.newTable"
        @click="table.showModal = false; table.tableTransfer()"
      >
        {{ $t('tables.transfer') }}
      </button>
    </template>
  </PosDialog>

  <!-- Merge two free tables. -->
  <PosDialog
    :open="table.showModalMergeFree"
    :title="$t('tables.merge_with', { table: table.mergeSourceTable })"
    @close="table.showModalMergeFree = false"
  >
    <label for="mergeSelect" class="pos-form-label">{{ $t('tables.select_to_merge') }}</label>
    <select id="mergeSelect" class="pos-select" v-model="table.selectedMergedTable">
      <option value="" disabled>{{ $t('tables.select_table') }}</option>
      <option v-for="option in table.transferTable" :key="option.name" :value="option.name">{{ option.name }}</option>
    </select>
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="table.showModalMergeFree = false">{{ $t('common.cancel') }}</button>
      <button
        type="button"
        class="pos-btn-primary"
        :disabled="!table.selectedMergedTable"
        @click="table.showModalMergeFree = false; table.mergeFreeTablesAction()"
      >
        {{ $t('tables.merge_tables') }}
      </button>
    </template>
  </PosDialog>

  <!-- Hand an open table to another captain. -->
  <PosDialog
    :open="table.showModalCaptainTransfer"
    :title="$t('tables.captain_transfer')"
    @close="table.showModalCaptainTransfer = false"
  >
    <div class="space-y-4">
      <div>
        <span class="pos-form-label">{{ $t('tables.current_captain') }}</span>
        <p class="rounded-xl bg-muted px-3.5 py-2.5 text-base font-bold text-foreground">{{ table.currentCaptain || '—' }}</p>
      </div>
      <div class="relative" data-autocomplete>
        <label for="newCaptain" class="pos-form-label">{{ $t('tables.new_captain') }}</label>
        <input
          id="newCaptain"
          type="text"
          class="pos-input"
          autocomplete="off"
          :placeholder="$t('tables.search_captain')"
          v-model="table.newCaptain"
          @focus="table.showCaptain = true; table.fetchCaptain()"
        />
        <div v-if="table.showCaptain && table.searchCaptian.length" class="pos-menu" role="listbox">
          <button
            v-for="captain in table.searchCaptian"
            :key="captain.name"
            type="button"
            role="option"
            class="pos-menu-item"
            @click="table.selectcaptain(captain)"
          >
            {{ captain.name }}
          </button>
        </div>
      </div>
    </div>
    <template #footer>
      <button type="button" class="pos-btn-ghost" @click="table.showModalCaptainTransfer = false">{{ $t('common.cancel') }}</button>
      <button
        type="button"
        class="pos-btn-primary"
        :disabled="!table.newCaptain"
        @click="table.showModalCaptainTransfer = false; table.captianTransfer()"
      >
        {{ $t('tables.transfer') }}
      </button>
    </template>
  </PosDialog>
</template>

<script>
import { useTableStore } from "@/stores/Table.js";
import { useAuthStore } from "@/stores/Auth.js";
import PosBusy from "./ui/PosBusy.vue";
import TableTile from "./TableTile.vue";
import PosDialog from "./ui/PosDialog.vue";
import PosEmpty from "./ui/PosEmpty.vue";

const OCCUPIED_ONLY_KEY = "urypos_tables_occupied_only";

function readOccupiedOnly() {
  try {
    return localStorage.getItem(OCCUPIED_ONLY_KEY) === "1";
  } catch (e) {
    return false;
  }
}

export default {
  name: "Table",
  components: { PosBusy, TableTile, PosDialog, PosEmpty },
  setup() {
    return {
      table: useTableStore(),
      auth: useAuthStore(),
    };
  },
  data() {
    return { occupiedOnly: readOccupiedOnly() };
  },
  computed: {
    tableTypeOptions() {
      return [
        { takeaway: false, label: this.$t("tables.dine_in") },
        { takeaway: true, label: this.$t("tables.takeaway") },
      ];
    },
    /**
     * Every order here starts from a table, for cashiers and captains alike;
     * the server takes "Dine In" or "Take Away" from the table itself.
     */
    roomTables() {
      return this.table.isTakeaeay ? this.table.takeAway : this.table.filteredTables;
    },
    visibleTables() {
      return this.occupiedOnly ? this.roomTables.filter((tile) => tile.occupied === 1) : this.roomTables;
    },
    counts() {
      const result = { free: 0, occupied: 0, attention: 0 };
      for (const tile of this.roomTables) {
        if (tile.occupied !== 1) result.free += 1;
        else if (this.table.getBadgeType(tile) === "red") result.attention += 1;
        else result.occupied += 1;
      }
      return result;
    },
  },
  mounted() {
    document.addEventListener("click", this.closeMenus);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.closeMenus);
  },
  methods: {
    toggleOccupiedOnly() {
      this.occupiedOnly = !this.occupiedOnly;
      try {
        localStorage.setItem(OCCUPIED_ONLY_KEY, this.occupiedOnly ? "1" : "0");
      } catch (e) {
        /* blocked storage: the toggle still works for this visit */
      }
    },
    selectRoom(name) {
      if (this.table.selectedRoom === name) return;
      this.table.selectedRoom = name;
      this.table.handleRoomChange();
    },
    /** Tile menus and autocompletes close when the tap lands elsewhere. */
    closeMenus(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-table-menu]")) this.table.hideDropdown();
      if (!target.closest("[data-autocomplete]")) {
        this.table.showTable = false;
        this.table.showCaptain = false;
      }
    },
  },
};
</script>
