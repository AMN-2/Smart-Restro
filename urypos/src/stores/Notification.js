import { defineStore } from "pinia";
import { t } from "../i18n";

const DURATION_MS = 3000;
const MAX_VISIBLE = 3;

/** One live region for every toast, created on first use. */
function toastRegion() {
  let region = document.getElementById("pos-toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "pos-toast-region";
    region.className = "pos-toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Toasts.
 *
 * These used to be a fixed 400×65px green box pinned to the right edge (the
 * wrong side in Arabic) that removed itself after 900ms — too fast to read,
 * and every toast looked like a success, errors included. They now share
 * one stacked region, use the design tokens, stay long enough to read, and
 * take a tone: "success" (default), "error" or "info".
 */
export const useNotifications = defineStore("notification", {
  state: () => ({}),
  actions: {
    createNotification(message, tone = "success") {
      if (!message) return;
      const region = toastRegion();

      while (region.children.length >= MAX_VISIBLE) {
        region.firstElementChild.remove();
      }

      const toast = document.createElement("div");
      toast.className = `pos-toast pos-toast-${tone}`;

      const dot = document.createElement("span");
      dot.className = "pos-toast-dot";
      dot.setAttribute("aria-hidden", "true");

      // Text, never markup: messages can carry server or item data.
      const text = document.createElement("p");
      text.className = "min-w-0 flex-1";
      text.textContent = message;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "-me-1 -mt-0.5 rounded-md px-1.5 text-base leading-none text-muted-foreground hover:bg-muted";
      close.setAttribute("aria-label", t("common.close"));
      close.textContent = "✕";

      const dismiss = () => toast.remove();
      close.addEventListener("click", dismiss);

      toast.append(dot, text, close);
      region.appendChild(toast);
      setTimeout(dismiss, tone === "error" ? DURATION_MS * 1.6 : DURATION_MS);
    },
  },
});
