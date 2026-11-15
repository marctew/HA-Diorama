import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DioramaApi, errorMessage, isConflict } from "../core/api";
import { nextFloor, outerWalls } from "../core/floors";
import { newId } from "../core/ids";
import { commit } from "../core/plan";
import type { Camera, FloorMeta, House, HouseInput } from "../core/scene";
import "../editor/editor";
import "../editor/floors-dialog";
import { icon } from "../editor/icons";
import { HouseController } from "../shared/house-controller";
import { roomIllustration } from "../shared/illustration";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant, PanelInfo } from "../types/hass";

/** The Diorama page in the sidebar. A panel owns its whole page, so it draws
 * its own header and the button that opens the sidebar on narrow screens. */
@customElement("diorama-panel")
export class DioramaPanel extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ type: Boolean, reflect: true }) narrow = false;
  @property({ attribute: false }) route?: { prefix: string; path: string };
  @property({ attribute: false }) panel?: PanelInfo;

  /** The floor being edited; the first one until another is chosen. */
  @state() private floorId?: string;
  @state() private adding = false;
  @state() private addError?: string;
  @state() private floorsOpen = false;
  /** A change to the house is being saved. */
  @state() private saving = false;
  @state() private houseError?: string;

  private readonly houseController = new HouseController(this);

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass")) this.houseController.setHass(this.hass);
  }

  protected override render(): TemplateResult {
    const { house } = this.houseController;
    const floors = house?.floors ?? [];
    const current = floors.find((floor) => floor.id === this.floorId) ?? floors[0];
    return html`
      <header>
        ${this.showMenuButton()
          ? html`
              <button class="icon" aria-label="Open the sidebar" @click=${this.toggleSidebar}>
                ${icon("menu")}
              </button>
            `
          : nothing}
        <h1>Diorama</h1>
        ${floors.length > 1
          ? html`
              <select
                aria-label="Floor"
                @change=${(event: Event) =>
                  (this.floorId = (event.target as HTMLSelectElement).value)}
              >
                ${floors.map(
                  (floor) =>
                    html`<option value=${floor.id} ?selected=${floor.id === current?.id}>
                      ${floor.name}
                    </option>`,
                )}
              </select>
            `
          : current
            ? html`<span class="floor-name">${current.name}</span>`
            : nothing}
        ${current && !this.narrow
          ? html`<button class="text" @click=${() => (this.floorsOpen = true)}>
              ${icon("layers")} Floors
            </button>`
          : nothing}
      </header>
      <main>
        ${current
          ? html`<diorama-editor
              .hass=${this.hass}
              .floorId=${current.id}
              .house=${house}
              ?narrow=${this.narrow}
              @cameras-change=${(event: CustomEvent<{ cameras: Camera[] }>) =>
                this.saveHouse((now) => ({ ...now, cameras: event.detail.cameras }))}
            ></diorama-editor>`
          : this.renderEmpty()}
      </main>
      ${this.floorsOpen
        ? html`<diorama-floors-dialog
            .house=${house}
            .hass=${this.hass}
            .error=${this.houseError}
            ?busy=${this.saving}
            @floors-close=${() => {
              this.floorsOpen = false;
              this.houseError = undefined;
            }}
            @floors-change=${(event: CustomEvent<{ floors: FloorMeta[] }>) =>
              this.saveHouse((now) => ({ ...now, floors: event.detail.floors }))}
            @floors-add=${(event: CustomEvent<{ copyOutline: boolean }>) =>
              this.addFloor(event.detail.copyOutline)}
            @floors-delete=${(event: CustomEvent<{ id: string }>) =>
              this.deleteFloor(event.detail.id)}
          ></diorama-floors-dialog>`
        : nothing}
    `;
  }

  private renderEmpty(): TemplateResult {
    const { house, error } = this.houseController;
    const version = this.panel?.config?.version;
    return html`
      <div class="empty">
        ${roomIllustration()}
        ${error
          ? html`<p class="error" role="alert">${error}</p>`
          : !house
            ? html`<p>Loading...</p>`
            : html`
                <h2>Start with a floor</h2>
                <p>
                  Draw the walls of one floor from above. Rooms appear as you close them off, and
                  you can link each one to a Home Assistant area.
                </p>
                <button class="primary" ?disabled=${this.adding} @click=${this.addFirstFloor}>
                  Add a floor
                </button>
                ${this.addError ? html`<p class="error" role="alert">${this.addError}</p>` : nothing}
              `}
        ${version ? html`<p class="version">Version ${version}</p>` : nothing}
      </div>
    `;
  }

  private addFirstFloor(): Promise<void> {
    return this.addFloor(false);
  }

  /** Save a change to the house: its floor list, or its saved views. Returns
   * the house as saved, or undefined if it could not be. */
  private async saveHouse(change: (house: House) => HouseInput): Promise<House | undefined> {
    const house = this.houseController.house;
    if (!this.hass || !house || this.saving) return undefined;
    this.saving = true;
    this.houseError = undefined;
    try {
      const saved = await new DioramaApi(this.hass).saveHouse(change(house), house.revision);
      this.houseController.adopt(saved);
      return saved;
    } catch (error) {
      this.houseError = isConflict(error)
        ? "The house was changed somewhere else. It has been loaded again: please repeat that."
        : errorMessage(error);
      void this.houseController.reload();
      return undefined;
    } finally {
      this.saving = false;
    }
  }

  /** Add a floor on top of the house, optionally starting from the outside
   * walls of the floor below it. */
  private async addFloor(copyOutline: boolean): Promise<void> {
    const house = this.houseController.house;
    if (!this.hass || !house || this.adding) return;
    this.adding = true;
    this.addError = undefined;
    const api = new DioramaApi(this.hass);
    try {
      const top = house.floors.reduce<FloorMeta | undefined>(
        (highest, floor) => (!highest || floor.elevation > highest.elevation ? floor : highest),
        undefined,
      );
      const below = top ? await api.getFloor(top.id) : undefined;
      const id = newId("f");
      const saved = await this.saveHouse((now) => ({
        ...now,
        floors: [...now.floors, { id, ...nextFloor(now.floors, below?.wall_height) }],
      }));
      if (!saved) {
        this.addError = this.houseError;
        return;
      }
      if (copyOutline && below) {
        const outline = outerWalls(below);
        if (outline.walls.length > 0) {
          const fresh = await api.getFloor(id);
          await api.saveFloor(commit({ ...fresh, ...outline, wall_height: below.wall_height }));
        }
      }
      this.floorId = id;
    } catch (error) {
      this.addError = errorMessage(error);
      this.houseError = this.addError;
    } finally {
      this.adding = false;
    }
  }

  private async deleteFloor(id: string): Promise<void> {
    if (!this.hass || this.saving) return;
    this.saving = true;
    this.houseError = undefined;
    try {
      this.houseController.adopt(await new DioramaApi(this.hass).deleteFloor(id));
      if (this.floorId === id) this.floorId = undefined;
    } catch (error) {
      this.houseError = errorMessage(error);
    } finally {
      this.saving = false;
    }
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
        /* Home Assistant gives a panel no height of its own. */
        height: 100vh;
        height: 100dvh;
        background: var(--primary-background-color, #fafafa);
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
      }
      header {
        flex: none;
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
      button.text {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        margin-left: 8px;
        padding: 0 12px 0 8px;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
        border-radius: 999px;
        background: none;
        color: inherit;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .floor-name {
        margin-left: 4px;
        padding: 3px 10px;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
        border-radius: 999px;
        font-size: 13px;
      }
      header select {
        height: 32px;
        margin-left: 4px;
        padding: 0 8px;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
        border-radius: 8px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 13px;
      }
      header select option {
        color: var(--primary-text-color, #000);
        background: var(--card-background-color, #fff);
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
      button:focus-visible,
      select:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: -4px;
      }
      main {
        flex: 1;
        display: flex;
        min-height: 0;
      }
      diorama-editor {
        flex: 1;
        min-width: 0;
      }
      .empty {
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 10px;
        max-width: 440px;
        margin: auto;
        padding: 24px;
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
      button.primary {
        height: 40px;
        margin-top: 8px;
        padding: 0 20px;
        border: 0;
        border-radius: 10px;
        background: var(--diorama-accent);
        color: var(--text-primary-color, #fff);
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
      button.primary:focus-visible {
        outline: 2px solid var(--diorama-text);
        outline-offset: 2px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .error {
        color: var(--error-color, #db4437);
      }
      .version {
        margin-top: 12px;
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
