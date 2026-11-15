import { css, html, LitElement, nothing, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fixtureVisual } from "../core/bindings";
import { bindableEntities, type EntityChoice } from "../core/fixtures";
import type { Floor } from "../core/scene";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon, KIND_GLYPHS, KIND_NAMES } from "./icons";

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
          ? html`<p class="empty">Nothing that can be placed was found in Home Assistant.</p>`
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
          ? html`Click in the plan to place it. On furniture that suits it (a lamp for a light,
              the TV for a media player) it becomes that. A light or switch stays picked, to click
              each fitting it works. <kbd>Esc</kbd> stops.`
          : "Pick a device, then click where it is in the plan. A door or window takes its sensor or blind when you select it."}
      </p>
    `;
  }

  private renderSection(
    title: string,
    choices: EntityChoice[],
    hideWhenEmpty: boolean,
  ): TemplateResult | typeof nothing {
    if (choices.length === 0 && hideWhenEmpty) return nothing;
    // How many times each is on the floor already: one switch may work
    // eight downlights, and each of them can be placed.
    const placed = new Map<string, number>();
    for (const fixture of this.floor?.fixtures ?? []) {
      placed.set(fixture.entity_id, (placed.get(fixture.entity_id) ?? 0) + 1);
    }
    // Not yet on the floor first.
    const ordered = [...choices].sort(
      (a, b) => Number(placed.has(a.entity_id)) - Number(placed.has(b.entity_id)),
    );
    return html`
      <h3>${title}</h3>
      ${choices.length === 0
        ? html`<p class="note">Nothing to place in this area.</p>`
        : ordered.map((choice) => this.renderRow(choice, placed.get(choice.entity_id) ?? 0))}
    `;
  }

  private renderRow(choice: EntityChoice, placed: number): TemplateResult {
    const picked = this.picked === choice.entity_id;
    const visual = fixtureVisual(choice.kind, this.hass?.states[choice.entity_id]);
    const [r, g, b] = visual.colour.map((channel) => Math.round(channel * 255));
    return html`
      <button
        class="row ${picked ? "picked" : ""}"
        title="${KIND_NAMES[choice.kind]}: ${choice.entity_id}${placed > 0
          ? `. On the plan ${placed === 1 ? "once" : `${placed} times`} already`
          : ""}"
        aria-pressed=${picked}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("device-pick", {
              detail: { entityId: picked ? undefined : choice.entity_id, kind: choice.kind },
            }),
          )}
      >
        <svg
          class="dot ${visual.available ? (visual.on ? "on" : "off") : "missing"}"
          viewBox="-11 -11 22 22"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <circle r="10" style=${visual.on ? `fill: rgb(${r} ${g} ${b})` : ""} />
          ${svg`${KIND_GLYPHS[choice.kind]}`}
        </svg>
        <span class="name">${choice.name}</span>
        ${visual.available && visual.label
          ? html`<span class="reading">${visual.label}</span>`
          : nothing}
        ${placed > 0
          ? html`<span class="placed">${placed > 1 ? html`<span>${placed}</span>` : nothing}${icon("check")}</span>`
          : nothing}
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
      }
      .dot circle {
        fill: color-mix(in srgb, var(--diorama-text) 40%, var(--card-background-color, #fff));
      }
      .dot path {
        fill: none;
        stroke: #fff;
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .dot.on path {
        stroke: rgba(0, 0, 0, 0.72);
      }
      .dot.missing circle {
        fill: none;
        stroke: color-mix(in srgb, var(--diorama-text) 45%, transparent);
        stroke-width: 1.5;
        stroke-dasharray: 3 2.5;
      }
      .dot.missing path {
        stroke: color-mix(in srgb, var(--diorama-text) 55%, transparent);
      }
      .reading {
        flex: none;
        color: var(--diorama-text-muted);
        font-variant-numeric: tabular-nums;
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .placed {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 12px;
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
