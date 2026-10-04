/**
 * Wires live floor updates (floorSync.js) into the waiter POS stores.
 *
 * One subscription for the whole app, started from App.vue:
 * - the tables grid re-reads its room;
 * - the open table's order reloads, or raises the "changed elsewhere" banner
 *   if the waiter has unsent edits, or closes if it was paid/cancelled/moved;
 * - the order log re-reads its page and the open order.
 */
import router from "../router";
import { useAuthStore } from "../stores/Auth.js";
import { useTableStore } from "../stores/Table.js";
import { useInvoiceDataStore } from "../stores/invoiceData.js";
import { usetoggleRecentOrder } from "../stores/recentOrder.js";
import { useNotifications } from "../stores/Notification.js";
import { t } from "../i18n";
import { floorUpdateTouches, isOwnEcho, subscribeFloorUpdates } from "./floorSync.js";

let unsubscribe = null;

export function startLiveFloor() {
  if (unsubscribe) return unsubscribe;
  const auth = useAuthStore();
  const table = useTableStore();
  const invoiceData = useInvoiceDataStore();
  const recentOrders = usetoggleRecentOrder();
  const notification = useNotifications();

  unsubscribe = subscribeFloorUpdates(
    async (update) => {
      if (!auth.userAuth || router.currentRoute.value.path === "/login") return;

      // Tables grid.
      if (table.selectedRoom) table.fetchTable();

      // The open table's order.
      if (
        table.selectedTable &&
        !invoiceData.invoiceUpdating &&
        floorUpdateTouches(update, { invoice: table.invoiceNo, tables: [table.selectedTable] }) &&
        !isOwnEcho(update, auth.sessionUser)
      ) {
        await table.refreshOpenOrder();
      }

      // Order log.
      if (router.currentRoute.value.path === "/recentOrder") {
        const openName = recentOrders.selectedOrder && recentOrders.selectedOrder.name;
        const outcome = await recentOrders.refreshLive(update);
        if (outcome === "closed") {
          notification.createNotification(t("live.order_left_list", { order: openName || "" }), "info");
        }
      }
    },
    { branch: () => invoiceData.branch || null }
  );
  return unsubscribe;
}
