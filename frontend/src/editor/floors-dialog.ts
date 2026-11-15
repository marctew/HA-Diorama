import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { FloorMeta, House } from "../core/scene";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";

/** The floors of the house: name them, set how high each is, link them to
 * Home Assistant's floors, put them in order, add and delete.
 *
 * It changes nothing itself. It fires `floors-change` with the new list,
 * `floors-add` (with `copyOutline` if the new floor should start from the
 * walls of the one below), `floors-delete` with an id, and `floors-close`. */
@customElement("diorama-floors-dialog")
export class DioramaFloorsDialog extends LitElement {
  @property({ attribute: false }) house?: House;
  @property({ attribute: false }) hass?: HomeAssistant;
  /** A change is being saved: wait before making another. */
  @property({ type: Boolean }) busy = false;
  @property() error?: string;

  /** The floor that "Delete" has been pressed on once. */
  @state() private confirming?: string;
  @state() private copyOutline = true;

  protected override render(): TemplateResult {
    const floors = this.house?.floors ?? [];
    return html`
      <div class="backdrop" @click=${this.close}></div>
      <section role="dialog" aria-modal="true" aria-label="Floors">
        <header>
          <h2>Floors</h2>
          <button class="icon" title="Close" aria-label="Close" @click=${this.close}>
            ${icon("close")}
          </button>
        </header>
        <div class="list">
          <div class="row head">
            <span>Name</span><span>Height of its floor (m)</span><span>Home Assistant floor</span
            ><span></span>
          </div>
          ${floors.map((floor, index) => this.renderRow(floor, index, floors.length))}
        </div>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <footer>
          <label class="check">
            <input
              type="checkbox"
              .checked=${this.copyOutline}
              ?disabled=${floors.length === 0}
              @change=${(event: Event) =>
                (this.copyOutline = (event.target as HTMLInputElement).checked)}
            />
            <span>Start a new floor from the outside walls of the one below</span>
          </label>
          <button class="primary" ?disabled=${this.busy} @click=${this.add}>
            ${icon("plus")} Add a floor
          </button>
        </footer>
      </section>
    `;
  }

  private renderRow(floor: FloorMeta, index: number, count: number): TemplateResult {
    const haFloors = Object.values(this.hass?.floors ?? {}).sort((a, b) => a.name.localeCompare(b.name));
    const confirming = this.confirming === floor.id;
    return html`
      <div class="row">
        <input
          type="text"
          maxlength="100"
          aria-label="Name"
          .value=${floor.name}
          ?disabled=${this.busy}
          @change=${(event: Event) => {
            const name = (event.target as HTMLInputElement).value.trim();
            if (name) this.change(floor.id, { name });
            else (event.target as HTMLInputElement).value = floor.name;
          }}
        />
        <input
          type="number"
          step="0.1"
          aria-label="Height of its floor"
          .value=${String(floor.elevation)}
          ?disabled=${this.busy}
          @change=${(event: Event) => {
            const elevation = Number((event.target as HTMLInputElement).value);
            if (Number.isFinite(elevation) && Math.abs(elevation) <= 100) {
              this.change(floor.id, { elevation });
            }
          }}
        />
        <select
          aria-label="Home Assistant floor"
          ?disabled=${this.busy}
          @change=${(event: Event) =>
            this.change(floor.id, {
              ha_floor_id: (event.target as HTMLSelectElement).value || null,
            })}
        >
          <option value="" ?selected=${!floor.ha_floor_id}>None</option>
          ${haFloors.map(
            (ha) =>
              html`<option value=${ha.floor_id} ?selected=${ha.floor_id === floor.ha_floor_id}>
                ${ha.name}
              </option>`,
          )}
        </select>
        <span class="buttons">
          <button
            class="icon"
            title="Move up the list"
            aria-label="Move ${floor.name} up"
            ?disabled=${this.busy || index === 0}
            @click=${() => this.move(floor.id, -1)}
          >
            ${icon("up")}
          </button>
          <button
            class="icon"
            title="Move down the list"
            aria-label="Move ${floor.name} down"
            ?disabled=${this.busy || index === count - 1}
            @click=${() => this.move(floor.id, 1)}
          >
            ${icon("down")}
          </button>
          ${confirming
            ? html`<button
                class="danger"
                ?disabled=${this.busy}
                @click=${() => {
                  this.confirming = undefined;
                  this.dispatchEvent(new CustomEvent("floors-delete", { detail: { id: floor.id } }));
                }}
                @blur=${() => (this.confirming = undefined)}
              >
                Delete it all
              </button>`
            : html`<button
                class="icon"
                title="Delete this floor and everything on it"
                aria-label="Delete ${floor.name}"
                ?disabled=${this.busy}
                @click=${() => (this.confirming = floor.id)}
              >
                ${icon("trash")}
              </button>`}
        </span>
      </div>
    `;
  }

  private change(id: string, patch: Partial<FloorMeta>): void {
    const floors = (this.house?.floors ?? []).map((floor) =>
      floor.id === id ? { ...floor, ...patch } : floor,
    );
    this.dispatchEvent(new CustomEvent("floors-change", { detail: { floors } }));
  }

  private move(id: string, by: -1 | 1): void {
    const floors = [...(this.house?.floors ?? [])];
    const from = floors.findIndex((floor) => floor.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= floors.length) return;
    [floors[from], floors[to]] = [floors[to], floors[from]];
    this.dispatchEvent(new CustomEvent("floors-change", { detail: { floors } }));
  }

  private add(): void {
    this.dispatchEvent(
      new CustomEvent("floors-add", { detail: { copyOutline: this.copyOutline } }),
    );
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent("floors-close"));
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
        font-size: 14px;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.42);
      }
      section {
        position: relative;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        width: min(760px, 100%);
        max-height: 100%;
        border-radius: 18px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 12px 8px 24px;
      }
      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
      }
      .list {
        overflow-y: auto;
        padding: 4px 24px 8px;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) 150px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 5px 0;
      }
      .row.head {
        font-size: 12px;
        color: var(--diorama-text-muted);
      }
      input[type="text"],
      input[type="number"],
      select {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
        height: 38px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      .buttons {
        display: flex;
        align-items: center;
        min-width: 116px;
      }
      button.icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      button.icon:hover:not(:disabled) {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .danger {
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: var(--error-color, #db4437);
        color: #fff;
        font: inherit;
        font-size: 13px;
        white-space: nowrap;
        cursor: pointer;
      }
      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 24px 20px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .check {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--diorama-text-muted);
      }
      .check input {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--diorama-accent);
      }
      .primary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
        height: 40px;
        padding: 0 18px 0 12px;
        border: 0;
        border-radius: 10px;
        background: var(--diorama-accent);
        color: var(--text-primary-color, #fff);
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
      .error {
        margin: 0 24px 12px;
        color: var(--error-color, #db4437);
      }
      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-floors-dialog": DioramaFloorsDialog;
  }
}
