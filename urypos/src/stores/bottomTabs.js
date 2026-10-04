import { defineStore } from "pinia";
import { useAuthStore } from "./Auth.js";
import router from "../router";
import { useAlert } from "./Alert.js";
import { useTableStore } from "./Table.js";
import { useMenuStore } from "./Menu.js";
import { usetoggleRecentOrder } from "./recentOrder.js";
import { t } from "../i18n";

/**
 * Navigation guards for the bottom bar / rail.
 *
 * Each check answers whether the tab may open *before* navigating. They used
 * to alert and then let the router-link navigate anyway, so the screen
 * flashed open and the alert bounced the user back to Tables.
 */
export const tabFunctions = defineStore("tabClick", {
  state: () => ({
    auth: useAuthStore(),
    alert: useAlert(),
    menu: useMenuStore(),
    table: useTableStore(),
    recentOrders: usetoggleRecentOrder(),
  }),
  getters: {
    isLoginPage() {
      return router.currentRoute.value.path === "/login";
    },
    currentTab() {
      return router.currentRoute.value.path;
    },
  },
  actions: {
    /** Explain why, then send the user to where the missing choice is made. */
    block(titleKey, bodyKey) {
      this.alert.createAlert(t(titleKey), t(bodyKey), t("common.ok")).then(() => {
        if (router.currentRoute.value.path !== "/Table") router.push("/Table");
      });
      return false;
    },
    /**
     * Every order starts from a table — there is no separate order type to
     * pick. An order reopened from the log (`restaurantTable`, or a past
     * takeaway/delivery order being edited) already has its place.
     */
    checkActiveTable() {
      if (this.table.selectedTable || this.recentOrders.restaurantTable || this.recentOrders.pastOrderType) {
        return true;
      }
      return this.block("nav.no_table_title", "nav.no_table_body");
    },
    clickMenuTab() {
      return this.checkActiveTable();
    },
  },
});
