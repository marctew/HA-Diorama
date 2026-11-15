// Loaded on every Home Assistant page, so it stays small: the element users
// put on a dashboard, with no Lit and no renderer. The real card is fetched
// the first time one is shown.

import {
  aspectRatioValue,
  CARD_TYPE,
  DEFAULT_CARD_CONFIG,
  parseCardConfig,
  type CardConfig,
} from "../core/card-config";
import type { DioramaCardView } from "../card/card-view";
import type { HomeAssistant } from "../types/hass";

class DioramaCard extends HTMLElement {
  private _config?: CardConfig;
  private _hass?: HomeAssistant;
  private _view?: DioramaCardView;
  private _loading = false;

  static getStubConfig(): Record<string, unknown> {
    return { view: "house" };
  }

  /** The card's settings in the dashboard editor, fetched when first needed. */
  static async getConfigElement(): Promise<HTMLElement> {
    await import("../card/card-editor");
    return document.createElement("diorama-card-editor");
  }

  setConfig(raw: unknown): void {
    this._config = parseCardConfig(raw);
    this.update();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (this._view) this._view.hass = hass;
  }

  /** Masonry view: height in units of 50 pixels, for a column about 500 wide. */
  getCardSize(): number {
    const ratio = aspectRatioValue((this._config ?? DEFAULT_CARD_CONFIG).aspect_ratio);
    return Math.max(1, Math.ceil(500 / ratio / 50));
  }

  /** Sections view: the height follows the width through aspect_ratio. */
  getGridOptions(): Record<string, number | string> {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback(): void {
    this.style.display = "block";
    void this.load();
  }

  private async load(): Promise<void> {
    if (this._view || this._loading) return;
    this._loading = true;
    try {
      await import("../card/card-view");
      this._view = document.createElement("diorama-card-view");
      this.update();
      this.replaceChildren(this._view);
    } catch (error) {
      console.error("Diorama: the card could not be loaded", error);
      this.textContent = "Diorama could not be loaded. Reload the page to try again.";
    } finally {
      this._loading = false;
    }
  }

  private update(): void {
    if (!this._view) return;
    this._view.config = this._config;
    this._view.hass = this._hass;
  }
}

function register(): void {
  if (customElements.get(CARD_TYPE)) return;
  customElements.define(CARD_TYPE, DioramaCard);
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "Diorama",
    description: "Your house in 3D: the whole house, one floor or one room.",
    preview: true,
    documentationURL: "https://github.com/marctew/HA-Diorama",
  });
  console.info(`%c DIORAMA %c ${__DIORAMA_VERSION__} `, "background:#03a9f4;color:#fff", "");
}

// Home Assistant replaces the browser's custom element registry with its own
// when its app starts, and only looks for cards in that one. This module is
// loaded alongside the app and can run first, so wait until Home Assistant has
// defined its root element before defining ours. Checked in a real instance:
// defining straight away leaves the card as "Custom element doesn't exist".
if (document.querySelector("home-assistant")) {
  void customElements.whenDefined("home-assistant").then(register);
} else {
  register();
}
