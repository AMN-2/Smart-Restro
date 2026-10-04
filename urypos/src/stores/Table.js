import { defineStore } from "pinia";
import router from "../router";
import { useMenuStore } from "./Menu.js";
import { useInvoiceDataStore } from "./invoiceData.js";
import { useAuthStore } from "./Auth.js";
import { useCustomerStore } from "./Customer.js";
import { useNotifications } from "./Notification.js";
import { useAlert } from "./Alert.js";
import frappe from "./frappeSdk.js";
import { usetoggleRecentOrder } from "./recentOrder.js";
import { t } from "../i18n";


/** Counting order, "T2" before "T10", for every table list on the floor. */
function sortTablesByName(tables) {
  return [...(tables || [])].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" })
  );
}

export const useTableStore = defineStore("table", {
  state: () => ({
    tables: [],
    selectedTable: null,
    previousOrderdItem: [],
    invoiceNo: "",
    takeAwayTable: 0,
    alert: useAlert(),
    previousOrder: [],
    previousOrderdCustomer: "",
    invoiceData: useInvoiceDataStore(),
    grandTotal: "",
    notification: useNotifications(),
    selectedOption: "",
    isTakeAway: "",
    mobileNumber: "",
    showModal: false,
    showModalMergeFree: false,
    mergeSourceTable: "",
    selectedMergedTable: "",
    isTakeaeay: false,
    newTable: "",
    showTable: false,
    transferTable: [],
    menu: useMenuStore(),
    tableMenu: [],
    menuRoom: null,
    openingTable: false,
    roomRequest: 0,
    activeDropdown: null,
    currentCaptain: null,
    tableName: "",
    showModalCaptainTransfer: false,
    showCaptain: false,
    cashier: null,
    captain: [],
    previousWaiter: null,
    newCaptain: "",
    invoicePrinted: "",
    auth: useAuthStore(),
    call: frappe.call(),
    customers: useCustomerStore(),
    db: frappe.db(),
    totalMinutes: null,
    invoiceNumber: null,
    modifiedTime: null,
    selectedRoom: null,
    orderModified: null,
    menuName: null,
    rooms: [],
    recentOrders: usetoggleRecentOrder(),
    // The open order changed on another device while this one holds unsent
    // edits; drives RemoteChangeBanner. See refreshOpenOrder().
    remoteChange: null,
  }),
  getters: {
    filteredTables(state) {
      return state.tables.filter((table) => table.is_take_away === 0);
    },
    takeAway(state) {
      return state.tables.filter((table) => table.is_take_away === 1);
    },
    searchTable() {
      return this.transferTable.filter((table) => {
        return table.name.toLowerCase().includes(this.newTable.toLowerCase());
      });
    },
    searchCaptian() {
      return this.captain.filter((ordeTakers) => {
        return ordeTakers.name
          .toLowerCase()
          .includes(this.newCaptain.toLowerCase());
      });
    },
    toggleTableType(state) {
      return state.isTakeaeay ? "translateX(215%)" : "translateX(0)";
    },
    tableTypeLabel(state) {
      return state.isTakeaeay ? "Takeaway" : "Table";
    },
    tableTypeClass(state) {
      return state.isTakeaeay ? "text-left ml-1" : "text-center ml-2";
    },
  },
  actions: {
    fetchRoom() {
      this.selectedOption = "Table";
      if (this.invoiceData.multipleCashier) {
        this.call.get("ury.ury_pos.api.getRoom").then((result) => {
          this.rooms = result.message;
          const selectedRoom = localStorage.getItem("selectedRoom");
          if (
            selectedRoom !== null &&
            selectedRoom !== "" &&
            selectedRoom !== "null"
          ) {
            this.selectedRoom = selectedRoom;
            this.handleRoomChange();
          }

        });
      } else {
        this.db
          .getDocList("URY Room", {
            fields: ["name", "branch"],
            filters: [["branch", "like", this.invoiceData.branch]],
            limit: 0,
          })
          .then((docs) => {
            this.rooms = docs;
            const selectedRoom = localStorage.getItem("selectedRoom");
            if (
              selectedRoom !== null &&
              selectedRoom !== "" &&
              selectedRoom !== "null"
            ) {
              this.selectedRoom = selectedRoom;
              this.handleRoomChange();
            } else {
              this.db
                .getDocList("URY Restaurant", {
                  fields: ["branch", "default_room"],
                  filters: [["branch", "like", this.invoiceData.branch]],
                })
                .then((docs) => {
                  let room = docs.find((room) => room.default_room);
                  this.selectedRoom = room ? room.default_room : null;

                  this.handleRoomChange();
                });
            }

          })
          .catch((error) => console.error(error));
      }
    },
    async handleRoomChange() {
      localStorage.setItem("selectedRoom", this.selectedRoom);
      await this.fetchTable();
      await this.getMenu();
      if (this.invoiceData.multipleCashier) {
        this.getCashier()
      }
    },
    getCashier() {
      const getCashier = {
        room: this.selectedRoom,
      };
      this.call.get("ury.ury_pos.api.getCashier", getCashier).then((result) => {
        this.cashier = result.message
      });
    },
    fetchTable() {
      const room = this.selectedRoom;
      return this.db
        .getDocList("URY Table", {
          fields: [
            "name",
            "occupied",
            "latest_invoice_time",
            "is_take_away",
            "restaurant_room",
            "table_shape",
            "no_of_seats",
            "layout_x",
            "layout_y",
            "minimum_seating",
            "merged_with"
          ],
          filters: [["restaurant_room", "=", this.selectedRoom]],
          limit: 0,
        })
        .then((tables) => {
          if (room !== this.selectedRoom) return;
          this.tables = sortTablesByName(tables);
        });
    },
    async getMenu() {
      const room = this.selectedRoom;
      const request = ++this.roomRequest;
      try {
        const result = await this.call.get("ury.ury_pos.api.getRestaurantMenu", {
          room, pos_profile: this.invoiceData.posProfile,
        });
        if (request !== this.roomRequest || room !== this.selectedRoom) return false;
        this.tableMenu = Array.isArray(result.message?.items) ? result.message.items : [];
        this.menuRoom = room;
        this.menuName = result.message?.name;
        this.orderModified = result.message?.modified_time;
        this.menu.items = this.tableMenu;
        this.menu.showPriority = this.tableMenu.some(item => Number(item.special_dish) === 1);
        this.menu.course = [...new Set(this.tableMenu.map(item => item.course).filter(Boolean))].map(name => ({ name }));
        return true;
      } catch (error) {
        this.notification.createNotification(t("menu.load_failed"), "error");
        return false;
      }
    },
    toggleTableTypeSwitch() {
      this.isTakeaeay = !this.isTakeaeay;
    },
    tableSearch() {
      this.db
        .getDocList("URY Table", {
          filters: [["occupied", "like", "0%"]],
          limit: 0,
        })
        .then((table) => {
          this.transferTable = sortTablesByName(table);
        })
        .catch((error) => {
          console.error(error);
        });
    },
    openMergeFreeModal(table) {
      if (table.occupied === 1) {
        return;
      }
      this.mergeSourceTable = table.name;
      this.selectedMergedTable = "";
      this.showModalMergeFree = true;
      this.db
        .getDocList("URY Table", {
          filters: [["occupied", "like", "0%"], ["name", "!=", this.mergeSourceTable], ["restaurant_room", "=", this.selectedRoom]],
          limit: 0,
        })
        .then((tableList) => {
          this.transferTable = sortTablesByName(tableList);
        })
        .catch((error) => {
          console.error(error);
        });
    },
    async mergeFreeTablesAction() {
      try {
        await this.call.post(
          "ury.ury.doctype.ury_order.ury_order.merge_free_tables",
          {
            table1: this.mergeSourceTable,
            table2: this.selectedMergedTable
          }
        );
        this.fetchTable();
      } catch (error) {
        console.error("Failed to merge tables:", error);
      }
    },
    fetchCaptain() {
      this.db
        .getDocList("User", {
          fields: ["name"],
          limit: 0,
        })
        .then((docs) => {
          this.captain = docs;
        })
        .catch((error) => console.error(error));
    },
    async toggleDropdown(index) {
      this.tableName = index;
      if (this.activeDropdown === index) {
        this.activeDropdown = null;
      } else {
        this.activeDropdown = index;
      }
      await this.invoiceNumberFetching();
    },
    hideDropdown() {
      this.activeDropdown = null;
    },
    selectTable(tables) {
      this.newTable = tables.name;
      this.showTable = false;
    },
    selectcaptain(captain) {
      this.newCaptain = captain.name;
      this.showCaptain = false;
    },
    getTimeDifference(table) {
      const now = new Date();
      let tableTime = "00:00:00";
      if (table && table.occupied === 1 && table.latest_invoice_time) {
        tableTime = table.latest_invoice_time;
      }
      const [tableHours, tableMinutes, tableSeconds] = tableTime.split(":");
      const tableDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        tableHours,
        tableMinutes,
        tableSeconds
      );
      const timeDifferenceInMs = now - tableDate;
      const secondsDifference = Math.floor(timeDifferenceInMs / 1000);
      const minutesDifference = Math.floor(secondsDifference / 60);
      const hoursDifference = Math.floor(minutesDifference / 60);
      const formattedTimeDifference = `${hoursDifference}:${minutesDifference % 60
        }`;
      return formattedTimeDifference;
    },
    getBadgeType(table) {
      if (table.occupied != 1 && table.name !== this.selectedTable) {
        return "green";
      } else if (table.name === this.selectedTable) {
        return "default";
      } else if (table.occupied === 1 && table.name !== this.selectedTable) {
        const timeDifference = this.getTimeDifference(table);
        const [hours, minutes] = timeDifference.split(":");
        const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);
        if (totalMinutes > this.invoiceData.tableAttention) {
          return "red";
        } else {
          return "yellow";
        }
      }
    },
    getBadgeText(table) {
      if (table.occupied != 1 && table.name !== this.selectedTable) {
        return "Free";
      } else if (table.name === this.selectedTable) {
        return "Active";
      } else if (table.occupied === 1 && table.name !== this.selectedTable) {
        const timeDifference = this.getTimeDifference(table);
        const [hours, minutes] = timeDifference.split(":");
        const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);
        if (totalMinutes > this.invoiceData.tableAttention) {
          return "Attention";
        } else {
          return "Occupied";
        }
      }
    },
    /**
     * Open a table and load its order into the cart. `silent` is the live
     * reload from another device: no "order loaded" toast and no jump to the
     * menu — the waiter stays on the screen they are on.
     */
    async addToSelectedTables(table, { silent = false, destination = "/Menu" } = {}) {
      if (this.openingTable || this.invoiceData.invoiceUpdating || this.auth.restrictTableOrder) return false;
      this.openingTable = true;
      try {
        // Load both resources before changing the current ticket. Failure must
        // not clear an unsent cart or route to an empty/stale order.
        const room = table.restaurant_room || this.selectedRoom;
        const [menuResult, orderResult] = await Promise.all([
          this.call.get("ury.ury_pos.api.getRestaurantMenu", {
            room, pos_profile: this.invoiceData.posProfile,
          }),
          this.call.get("ury.ury.doctype.ury_order.ury_order.get_order_invoice", { table: table.name }),
        ]);
        const order = orderResult.message || {};
        if (order.name && !this.auth.hasAccess && !this.auth.cashier && this.auth.sessionUser !== order.waiter) {
          await this.alert.createAlert(t("common.notice"), t("tables.assigned_to", { name: order.waiter || "" }), t("common.ok"));
          return false;
        }
        const items = (menuResult.message?.items || []).map(item => ({ ...item, qty: 0 }));
        const previousItems = Array.isArray(order.items) ? order.items : [];
        const cart = previousItems.map(previous => {
          const item = items.find(row => row.item === previous.item_code) || {
            item: previous.item_code, item_name: previous.item_name, rate: previous.rate,
          };
          Object.assign(item, { rate: previous.rate, qty: Number(previous.qty), comment: previous.comment || "" });
          return item;
        });
        this.remoteChange = null;
        this.selectedTable = table.name;
        this.selectedRoom = room;
        this.menuRoom = room;
        this.takeAwayTable = Number(table.is_take_away) === 1 ? 1 : 0;
        this.isTakeAway = this.takeAwayTable ? "Take Away" : "Dine In";
        this.previousOrder = order;
        this.invoiceNo = order.name || "";
        this.invoicePrinted = Number(order.invoice_printed || 0);
        this.modifiedTime = order.modified;
        this.previousWaiter = order.waiter;
        this.grandTotal = order.grand_total || 0;
        this.mobileNumber = order.mobile_number || "";
        this.previousOrderdItem = previousItems;
        this.previousOrderdCustomer = order.customer || "";
        this.tableMenu = items;
        this.menuName = menuResult.message?.name;
        this.orderModified = menuResult.message?.modified_time;
        this.menu.items = items;
        this.menu.cart = cart;
        this.menu.comments = order.custom_comments || "";
        this.menu.selectedOrderType = order.order_type || this.isTakeAway;
        this.menu.selectedAggregator = null;
        this.menu.showPriority = items.some(item => Number(item.special_dish) === 1);
        this.menu.course = [...new Set(items.map(item => item.course).filter(Boolean))].map(name => ({ name }));
        if (!silent) this.menu.showAllItems();
        this.menu.currentPage = 1;
        // The previous invoice from the log must never leak into this table.
        this.invoiceData.invoiceNumber = this.invoiceNo;
        this.recentOrders.invoiceNumber = "";
        this.recentOrders.draftInvoice = "";
        this.recentOrders.restaurantTable = "";
        this.recentOrders.previousOrderdCustomer = "";
        this.recentOrders.pastOrderType = "";
        this.recentOrders.pastOrderdItem = [];
        this.recentOrders.modifiedTime = "";
        this.recentOrders.editPrintedInvoice = this.invoicePrinted;
        this.customers.search = order.customer || "";
        this.customers.numberOfPax = order.no_of_pax || "";
        this.customers.newCustomerMobileNo = order.mobile_number || "";
        this.customers.customerFavouriteItems = [];
        if (order.customer) this.customers.fectchCustomerFavouriteItem();
        if (!silent) {
          if (order.name) this.notification.createNotification(t("order.past_order_loaded"), "info");
          await router.push(destination);
        }
        return true;
      } catch (error) {
        this.notification.createNotification(t("menu.load_failed"), "error");
        return false;
      } finally {
        this.openingTable = false;
      }
    },
    /** Does the cart hold anything not yet sent for the open table? */
    isOpenOrderDirty() {
      const cart = this.menu.cart || [];
      if (!this.invoiceNo) return cart.length > 0;
      const totals = (rows, key) =>
        rows.reduce((acc, row) => {
          const code = row[key];
          if (code) acc[code] = (acc[code] || 0) + Number(row.qty || 0);
          return acc;
        }, {});
      const now = totals(cart, "item");
      const sent = totals(this.previousOrderdItem || [], "item_code");
      const codes = new Set([...Object.keys(now), ...Object.keys(sent)]);
      for (const code of codes) {
        if ((now[code] || 0) !== (sent[code] || 0)) return true;
      }
      if ((this.menu.comments || "") !== (this.previousOrder?.custom_comments || "")) return true;
      for (const line of cart) {
        const previous = (this.previousOrderdItem || []).find(row => row.item_code === line.item);
        if ((line.comment || "") !== (previous?.comment || "")) return true;
      }
      return false;
    },

    /**
     * The open table's order changed on another device. With nothing unsent
     * it is re-read in place; with unsent edits the banner asks first
     * (`force` is its "load latest"). If the order is gone — paid, cancelled,
     * moved — the waiter is told and taken back to the tables.
     */
    async refreshOpenOrder({ force = false } = {}) {
      const tableName = this.selectedTable;
      if (!tableName || this.openingTable || this.invoiceData.invoiceUpdating) return "ignored";
      if (!force && this.isOpenOrderDirty()) {
        this.remoteChange = { at: Date.now() };
        return "conflict";
      }
      this.remoteChange = null;
      let order = {};
      try {
        const res = await this.call.get(
          "ury.ury.doctype.ury_order.ury_order.get_order_invoice",
          { table: tableName }
        );
        order = res.message || {};
      } catch (error) {
        console.error(error);
        return "ignored";
      }
      if (this.invoiceNo && !order.name) {
        this.notification.createNotification(t("live.order_closed", { table: tableName }), "info");
        this.selectedTable = null;
        this.invoiceNo = "";
        this.previousOrderdItem = [];
        this.menu.cart.splice(0, this.menu.cart.length);
        (this.tableMenu || []).forEach((item) => { item.qty = ""; });
        this.customers.search = "";
        this.customers.numberOfPax = "";
        this.fetchTable();
        router.push("/Table");
        return "closed";
      }
      const tile =
        this.tables.find((row) => row.name === tableName) ||
        { name: tableName, is_take_away: this.takeAwayTable };
      if (!await this.addToSelectedTables(tile, { silent: true })) return "ignored";
      this.notification.createNotification(t("live.order_refreshed"), "info");
      return "reloaded";
    },

    routeToCart(table) {
      return this.addToSelectedTables(table, { destination: "/Cart" });
    },
    routeToMenu(table) {
      return this.addToSelectedTables(table);
    },
    async invoiceNumberFetching() {
      const tableInvoiceNumber = {
        table: this.tableName,
      };
      try {
        const result = await this.call.get(
          "ury.ury.doctype.ury_order.ury_order.get_order_invoice",
          tableInvoiceNumber
        );
        this.invoiceNumber = result.message.name;
        this.currentCaptain = result.message.waiter;
      } catch (error) {
        console.error(error._server_messages);
      }
    },
    tableTransfer: async function () {
      await this.invoiceNumberFetching();
      const transferTable = {
        table: this.tableName,
        newTable: this.newTable,
        invoice: this.invoiceNumber,
      };
      this.call
        .post(
          "ury.ury.doctype.ury_order.ury_order.table_transfer",
          transferTable
        )
        .then(() => {
          window.location.reload();
        })
        .catch((error) => {
          if (error._server_messages) {
            this.newTable = "";
            const messages = JSON.parse(error._server_messages);
            const message = JSON.parse(messages[0]);
            this.alert.createAlert("Message", message.message, "OK");
          }
        });
    },
    captianTransfer: async function () {
      await this.invoiceNumberFetching();
      if (this.invoiceNumber) {
        const transferCaptain = {
          currentCaptain: this.currentCaptain,
          newCaptain: this.newCaptain,
          invoice: this.invoiceNumber,
        };
        this.call
          .post(
            "ury.ury.doctype.ury_order.ury_order.captain_transfer",
            transferCaptain
          )
          .then(() =>
            this.notification.createNotification(
              "Captain Transferred Successfully"
            )
          )
          .then(() => window.location.reload())
          .catch((error) => {
            if (error._server_messages) {
              const messages = JSON.parse(error._server_messages);
              const message = JSON.parse(messages[0]);
              this.alert.createAlert("Message", message.message, "OK");
            }
          });
      }
    },
  },
});
