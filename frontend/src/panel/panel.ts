import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { describeFloors } from "../core/api";
import { HouseController } from "../shared/house-controller";
import { roomIllustration } from "../shared/illustration";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant, PanelInfo } from "../types/hass";

const MENU_ICON = "M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z";

/** The Diorama page in the sidebar. A panel owns its whole page, so it draws
 * its own header and the button that opens the sidebar on narrow screens. */
@customElement("diorama-panel")
export class DioramaPanel extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ type: Boolean, reflect: true }) narrow = false;
  @property({ attribute: false }) route?: { prefix: string; path: string };
  @property({ attribute: false }) panel?: PanelInfo;

  private readonly houseController = new HouseController(this);

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass")) this.houseController.setHass(this.hass);
  }

  protected override render(): TemplateResult {
    const version = this.panel?.config?.version;
    return html`
      <header>
        ${this.showMenuButton()
          ? html`
              <button class="icon" aria-label="Open the sidebar" @click=${this.toggleSidebar}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${MENU_ICON} /></svg>
              </button>
            `
          : nothing}
        <h1>Diorama</h1>
      </header>
      <main>
        <div class="empty">
          ${roomIllustration()}
          <h2>Your house goes here</h2>
          <p>
            This is where you will draw your floors and rooms, add furniture and place your
            devices. The editor is not built yet.
          </p>
          ${this.renderHouse()}
          ${version ? html`<p class="version">Version ${version}</p>` : nothing}
        </div>
      </main>
    `;
  }

  private renderHouse(): TemplateResult | typeof nothing {
    const { house, error } = this.houseController;
    if (error) return html`<p class="status error" role="alert">${error}</p>`;
    if (!house) return nothing;
    return html`<p class="status">${house.settings.name} · ${describeFloors(house)}</p>`;
  }

  private showMenuButton(): boolean {
    return this.narrow || this.hass?.dockedSidebar === "always_hidden";
  }

  private toggleSidebar(): void {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--primary-background-color, #fafafa);
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
      }
      header {
        display: flex;
        align-items: center;
        gap: 4px;
        box-sizing: border-box;
        height: var(--header-height, 56px);
        padding: 0 16px;
        background: var(--app-header-background-color, var(--diorama-accent));
        color: var(--app-header-text-color, #fff);
        border-bottom: 1px solid var(--divider-color, transparent);
      }
      :host([narrow]) header {
        padding: 0 4px;
      }
      h1 {
        margin: 0 8px;
        font-size: 20px;
        font-weight: 400;
      }
      button.icon {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      button.icon:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: -4px;
      }
      button.icon svg {
        width: 24px;
        height: 24px;
        fill: currentColor;
      }
      main {
        flex: 1;
        display: grid;
        place-items: center;
        overflow: auto;
        padding: 24px;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 8px;
        max-width: 420px;
        text-align: center;
      }
      .empty svg {
        width: 220px;
        max-width: 70%;
        height: auto;
        margin-bottom: 8px;
      }
      h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 400;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: var(--diorama-text-muted);
      }
      .status {
        margin-top: 8px;
        padding: 6px 14px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 999px;
        font-size: 0.875rem;
        color: var(--diorama-text);
      }
      .status.error {
        border-color: var(--error-color, #db4437);
        border-radius: 12px;
        color: var(--error-color, #db4437);
      }
      .version {
        margin-top: 8px;
        font-size: 0.8125rem;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-panel": DioramaPanel;
  }
}
