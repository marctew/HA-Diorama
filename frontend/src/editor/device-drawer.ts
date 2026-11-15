import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fixtureVisual } from "../core/bindings";
import { bindableEntities, type EntityChoice } from "../core/fixtures";
import type { Floor } from "../core/scene";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";

/** The devices that can go on the floor: first those in the areas its rooms
 * are linked to, room by room, then the rest. Pick one, then click in the
 * plan. Fires `device-pick` with the entity id (or undefined to stop) and
 * `device-close`. */
@customElement("diorama-device-drawer")
export class DioramaDeviceDrawer extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) floor?: Floor;
  /** The entity being placed, if any. */
  @property() picked?: string;

  @state() private query = "";
  @state() private showOthers = false;

  protected override render(): TemplateResult {
    const hass = this.hass;
    const floor = this.floor;
    const all = hass ? bindableEntities(hass) : [];
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (choice: EntityChoice) =>
      words.every((word) => `${choice.name} ${choice.entity_id}`.toLowerCase().includes(word));
    const found = all.filter(matches);

    // One section per linked area, under the name of the room (or rooms) in it.
    const sections: { title: string; choices: EntityChoice[] }[] = [];
    const linked = new Set<string>();
    for (const room of floor?.rooms ?? []) {
      if (!room.area_id || linked.has(room.area_id)) continue;
      linked.add(room.area_id);
      const title = room.name || hass?.areas[room.area_id]?.name || "Unnamed room";
      sections.push({ title, choices: found.filter((choice) => choice.area_id === room.area_id) });
    }
    const others = found.filter((choice) => !choice.area_id || !linked.has(choice.area_id));
    const searching = words.length > 0;

    return html`
      <header>
        <h2>Devices</h2>
        <button
          class="icon"
          title="Close"
          aria-label="Close the device list"
          @click=${() => this.dispatchEvent(new CustomEvent("device-close"))}
        >
          ${icon("close")}
        </button>
      </header>
      <input
        type="search"
        placeholder="Search by name"
        aria-label="Search devices"
        .value=${this.query}
        @input=${(event: Event) => (this.query = (event.target as HTMLInputElement).value)}
      />
      <div class="list">
        ${all.length === 0
          ? html`<p class="empty">
              No lights or switches were found in Home Assistant. Other kinds of device are not
              supported yet.
            </p>`
          : nothing}
        ${sections.map((section) => this.renderSection(section.title, section.choices, searching))}
        ${linked.size === 0 && all.length > 0 && !searching
          ? html`<p class="note">
              Link a room to a Home Assistant area (select the room, then choose its area) and its
              devices are listed here first.
            </p>`
          : nothing}
        ${others.length === 0
          ? nothing
          : searching || this.showOthers || linked.size === 0
            ? this.renderSection(linked.size === 0 ? "All devices" : "Elsewhere", others, true)
            : html`<button class="more" @click=${() => (this.showOthers = true)}>
                Show ${others.length} from other areas
              </button>`}
        ${searching && found.length === 0
          ? html`<p class="empty">Nothing matches "${this.query}".</p>`
          : nothing}
      </div>
      <p class="help">
        ${this.picked
          ? html`Click in the plan to place it. On a lamp, it becomes that lamp. <kbd>Esc</kbd>
              stops.`
          : "Pick a device, then click where it is in the plan."}
      </p>
    `;
  }

  private renderSection(
    title: string,
    choices: EntityChoice[],
    hideWhenEmpty: boolean,
  ): TemplateResult | typeof nothing {
    if (choices.length === 0 && hideWhenEmpty) return nothing;
    const placed = new Set(this.floor?.fixtures.map((fixture) => fixture.entity_id));
    // Not yet on the floor first.
    const ordered = [...choices].sort(
      (a, b) => Number(placed.has(a.entity_id)) - Number(placed.has(b.entity_id)),
    );
    return html`
      <h3>${title}</h3>
      ${choices.length === 0
        ? html`<p class="note">No lights or switches in this area.</p>`
        : ordered.map((choice) => this.renderRow(choice, placed.has(choice.entity_id)))}
    `;
  }

  private renderRow(choice: EntityChoice, placed: boolean): TemplateResult {
    const picked = this.picked === choice.entity_id;
    const visual = fixtureVisual(choice.kind, this.hass?.states[choice.entity_id]);
    const [r, g, b] = visual.colour.map((channel) => Math.round(channel * 255));
    return html`
      <button
        class="row ${picked ? "picked" : ""}"
        title=${choice.entity_id}
        ?disabled=${placed}
        aria-pressed=${picked}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("device-pick", {
              detail: { entityId: picked ? undefined : choice.entity_id },
            }),
          )}
      >
        <span
          class="dot ${visual.available ? (visual.on ? "on" : "off") : "missing"}"
          style=${visual.on ? `background: rgb(${r} ${g} ${b})` : ""}
        ></span>
        <span class="name">${choice.name}</span>
        ${placed ? html`<span class="placed">${icon("check")}</span>` : nothing}
      </button>
    `;
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        min-height: 0;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 14px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
        color: var(--diorama-text);
        font-size: 13px;
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 8px 6px 16px;
      }
      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
      }
      h3 {
        margin: 14px 4px 4px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--diorama-text-muted);
      }
      h3:first-child {
        margin-top: 4px;
      }
      button.icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      button.icon:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      input {
        box-sizing: border-box;
        height: 36px;
        margin: 0 12px 4px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 8px 8px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
        width: 100%;
        min-height: 36px;
        padding: 4px 8px;
        border: 1.5px solid transparent;
        border-radius: 8px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .row:hover:not(:disabled) {
        background: color-mix(in srgb, var(--diorama-text) 7%, transparent);
      }
      .row.picked {
        border-color: var(--diorama-accent);
        background: color-mix(in srgb, var(--diorama-accent) 14%, transparent);
      }
      .row:disabled {
        color: var(--diorama-text-muted);
        cursor: default;
      }
      .dot {
        flex: none;
        box-sizing: border-box;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--diorama-text) 35%, transparent);
      }
      .dot.on {
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18);
      }
      .dot.missing {
        background: none;
        border: 1.5px dashed color-mix(in srgb, var(--diorama-text) 45%, transparent);
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .placed {
        display: grid;
        color: var(--diorama-text-muted);
      }
      .more {
        width: 100%;
        height: 34px;
        margin-top: 10px;
        border: 1px dashed var(--divider-color, rgba(0, 0, 0, 0.25));
        border-radius: 8px;
        background: none;
        color: var(--diorama-text-muted);
        font: inherit;
        cursor: pointer;
      }
      .empty,
      .note {
        margin: 6px 4px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      .empty {
        margin: 24px 8px;
        text-align: center;
      }
      .help {
        margin: 0;
        padding: 10px 14px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        font-size: 12px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      kbd {
        padding: 1px 5px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 4px;
        font: inherit;
        font-size: 11px;
        color: var(--diorama-text);
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-device-drawer": DioramaDeviceDrawer;
  }
}
