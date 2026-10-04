<template>
  <!--
    Menu toolbar: one search field and one row of filter chips.

    Courses were a dropdown beside two identical red buttons ("Priority",
    "All") whose only difference when active was a faint ring. A chip row
    shows every course at once, marks the live filter plainly, and is one
    tap to change — the same pattern as the cashier POS.
  -->
  <div class="pos-sticky-toolbar space-y-3">
    <div class="pos-search">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        class="pos-input"
        :placeholder="$t('menu.item_search')"
        :value="menu.searchTerm"
        autocapitalize="none"
        autocomplete="off"
        @input="menu.handleSearchInput"
      />
    </div>

    <div v-if="menu.selectedOrderType !== 'Aggregators'" class="pos-chip-row" :aria-label="$t('menu.select_course')">
      <button
        type="button"
        class="pos-chip press"
        :class="isAllActive && 'pos-chip-active'"
        :aria-pressed="isAllActive"
        @click="menu.showAllItems(); menu.currentPage = 1"
      >
        {{ $t('common.all') }}
      </button>

      <button
        v-if="menu.showPriority"
        type="button"
        class="pos-chip press"
        :class="menu.priority && 'pos-chip-active'"
        :aria-pressed="menu.priority"
        @click="menu.priority ? menu.showAllItems() : menu.showSpecialItems(); menu.currentPage = 1"
      >
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.83-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12L2.98 8.72c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" />
        </svg>
        {{ $t('order.priority') }}
      </button>

      <button
        v-for="course in menu.course"
        :key="course.name"
        type="button"
        class="pos-chip press"
        :class="menu.selectedCourse === course.name && 'pos-chip-active'"
        :aria-pressed="menu.selectedCourse === course.name"
        @click="selectCourse(course.name)"
      >
        {{ course.name }}
      </button>
    </div>
  </div>
</template>

<script>
import { useMenuStore } from "@/stores/Menu.js";

export default {
  name: "Search",
  setup() {
    return { menu: useMenuStore() };
  },
  computed: {
    isAllActive() {
      return !this.menu.selectedCourse && !this.menu.priority;
    },
  },
  methods: {
    /** Tapping the active course again clears it. */
    selectCourse(name) {
      this.menu.selectedCourse = this.menu.selectedCourse === name ? "" : name;
      this.menu.displayAll = false;
      this.menu.currentPage = 1;
    },
  },
};
</script>
