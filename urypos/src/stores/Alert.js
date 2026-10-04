import { defineStore } from "pinia";
import { t } from "../i18n";

/**
 * Blocking message with one button, resolved when it is acknowledged.
 *
 * Kept as plain DOM (the stores call it outside any component), but drawn
 * with the same classes as `PosDialog`. It used to be a white box offset by
 * `ml-64`/`md:ml-96` with a blue Tailwind-default button, which sat
 * off-centre on a tablet and outside the screen in Arabic.
 */
export const useAlert = defineStore("alert", {
  state: () => ({
    okButtonClicked: false,
  }),
  actions: {
    createAlert(title, message, buttonText) {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "pos-overlay z-[80] overflow-y-auto";

        const frame = document.createElement("div");
        frame.className = "flex min-h-full items-end justify-center sm:items-center sm:p-4";

        const panel = document.createElement("div");
        panel.className =
          "w-full rounded-t-3xl border border-border bg-card shadow-raised animate-scale-in sm:max-w-sm sm:rounded-2xl";
        panel.setAttribute("role", "alertdialog");
        panel.setAttribute("aria-modal", "true");

        const body = document.createElement("div");
        body.className = "px-5 pb-5 pt-5 sm:px-6";

        // Text, never markup: alert values can come from the server.
        const heading = document.createElement("h2");
        heading.className = "pos-title";
        heading.textContent = title === "Message" || !title ? t("common.notice") : title;

        const text = document.createElement("p");
        text.className = "mt-2 whitespace-pre-line text-sm text-muted-foreground";
        text.textContent = message;

        const footer = document.createElement("div");
        footer.className = "flex justify-end border-t border-border bg-muted/50 px-5 py-4 sm:rounded-b-2xl sm:px-6";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "pos-btn-primary min-w-[6rem]";
        button.textContent = !buttonText || /^ok$/i.test(buttonText) ? t("common.ok") : buttonText;

        const close = () => {
          document.removeEventListener("keydown", onKey);
          overlay.remove();
          this.okButtonClicked = true;
          resolve();
        };
        const onKey = (event) => {
          if (event.key === "Escape" || event.key === "Enter") {
            event.preventDefault();
            close();
          }
        };

        button.addEventListener("click", close);
        document.addEventListener("keydown", onKey);

        body.append(heading, text);
        footer.appendChild(button);
        panel.append(body, footer);
        frame.appendChild(panel);
        overlay.appendChild(frame);
        document.body.appendChild(overlay);
        button.focus();
      });
    },
  },
});
