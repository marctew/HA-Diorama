import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { distance, polygonArea, polygonPerimeter } from "../core/geometry";
import { commit, moveVertices, setWallLength, setWallThickness } from "../core/plan";
import { roomPolygon } from "../core/rooms";
import type { Floor, Room } from "../core/scene";
import {
  formatArea,
  formatLength,
  lengthForInput,
  parseLength,
  type UnitSystem,
} from "../core/units";
import { themeStyles } from "../shared/theme";
import type { HassArea, HomeAssistant } from "../types/hass";
import { icon } from "./icons";
import type { Selection } from "./selection";

export const FLOOR_STYLES: readonly { id: string; name: string }[] = [
  { id: "default", name: "Plain" },
  { id: "wood_light", name: "Light wood" },
  { id: "wood_dark", name: "Dark wood" },
  { id: "tile", name: "Tile" },
  { id: "carpet", name: "Carpet" },
  { id: "concrete", name: "Concrete" },
];

export const WALL_COLOURS: readonly string[] = [
  "#e8e4dc",
  "#f5f5f0",
  "#d9cfc1",
  "#c8d5cb",
  "#c5d3e0",
  "#e3c9c9",
  "#e8dba8",
  "#8a8f98",
];

/** The panel on the right: what is selected, and its settings. */
@customElement("diorama-inspector")
export class DioramaInspector extends LitElement {
  @property({ attribute: false }) floor?: Floor;
  @property({ attribute: false }) selection?: Selection;
  @property({ attribute: false }) hass?: HomeAssistant;
  @property() units: UnitSystem = "metric";

  protected override render(): TemplateResult | typeof nothing {
    const floor = this.floor;
    const selection = this.selection;
    if (!floor || !selection) return nothing;
    const count = selection.vertices.length + selection.walls.length;
    if (selection.room !== null) {
      const room = floor.rooms.find((candidate) => candidate.id === selection.room);
      if (room) return this.renderRoom(floor, room);
    }
    if (count > 1) return this.renderSeveral(count);
    if (selection.walls.length === 1) return this.renderWall(floor, selection.walls[0]);
    if (selection.vertices.length === 1) return this.renderVertex(floor, selection.vertices[0]);
    return this.renderFloor(floor);
  }

  private renderRoom(floor: Floor, room: Room): TemplateResult {
    const polygon = roomPolygon(floor, room);
    const areaName = room.area_id ? this.hass?.areas[room.area_id]?.name : undefined;
    return html`
      <h2>Room</h2>
      <label>
        <span>Name</span>
        <input
          type="text"
          maxlength="100"
          .value=${room.name}
          placeholder=${areaName ?? "Kitchen, hall..."}
          @change=${(event: Event) => this.updateRoom(room, { name: value(event).trim() })}
        />
      </label>
      <label>
        <span>Home Assistant area</span>
        <select @change=${(event: Event) => this.setArea(room, value(event))}>
          <option value="" ?selected=${room.area_id === null}>None</option>
          ${this.renderAreaOptions(room.area_id)}
        </select>
      </label>
      <p class="help">Linking an area lets Diorama offer you the devices in this room.</p>
      <label>
        <span>Floor finish</span>
        <select @change=${(event: Event) => this.updateRoom(room, { floor_style: value(event) })}>
          ${FLOOR_STYLES.map(
            (style) =>
              html`<option value=${style.id} ?selected=${style.id === room.floor_style}>
                ${style.name}
              </option>`,
          )}
        </select>
      </label>
      <div class="field">
        <span>Wall colour</span>
        <div class="swatches">
          ${WALL_COLOURS.map(
            (colour) => html`
              <button
                class="swatch ${colour === room.wall_colour.toLowerCase() ? "current" : ""}"
                style="background: ${colour}"
                title=${colour}
                aria-label="Wall colour ${colour}"
                aria-pressed=${colour === room.wall_colour.toLowerCase()}
                @click=${() => this.updateRoom(room, { wall_colour: colour })}
              ></button>
            `,
          )}
          <input
            type="color"
            title="Another colour"
            aria-label="Another wall colour"
            .value=${room.wall_colour}
            @change=${(event: Event) => this.updateRoom(room, { wall_colour: value(event) })}
          />
        </div>
      </div>
      <dl>
        <dt>Floor area</dt>
        <dd>${formatArea(polygonArea(polygon), this.units)}</dd>
        <dt>Around the walls</dt>
        <dd>${formatLength(polygonPerimeter(polygon), this.units)}</dd>
      </dl>
    `;
  }

  private renderAreaOptions(current: string | null): TemplateResult[] {
    const areas = Object.values(this.hass?.areas ?? {}).sort((a, b) => a.name.localeCompare(b.name));
    const floors = this.hass?.floors ?? {};
    const option = (area: HassArea) =>
      html`<option value=${area.area_id} ?selected=${area.area_id === current}>${area.name}</option>`;
    const grouped = new Map<string, HassArea[]>();
    for (const area of areas) {
      const group = (area.floor_id && floors[area.floor_id]?.name) || "";
      grouped.set(group, [...(grouped.get(group) ?? []), area]);
    }
    const result: TemplateResult[] = [];
    // An area that has since been deleted in Home Assistant still shows.
    if (current && !areas.some((area) => area.area_id === current)) {
      result.push(html`<option value=${current} selected>${current} (no longer exists)</option>`);
    }
    if (grouped.size <= 1) return [...result, ...areas.map(option)];
    for (const [group, members] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
      result.push(
        html`<optgroup label=${group || "No floor"}>${members.map(option)}</optgroup>`,
      );
    }
    return result;
  }

  private renderWall(floor: Floor, wallId: string): TemplateResult | typeof nothing {
    const wall = floor.walls.find((candidate) => candidate.id === wallId);
    const a = wall && floor.vertices.find((vertex) => vertex.id === wall.a);
    const b = wall && floor.vertices.find((vertex) => vertex.id === wall.b);
    if (!wall || !a || !b) return nothing;
    const length = distance(a, b);
    return html`
      <h2>Wall</h2>
      <label>
        <span>Length (${this.units === "metric" ? "m" : "ft"})</span>
        <input
          type="text"
          inputmode="decimal"
          .value=${lengthForInput(length, this.units)}
          @change=${(event: Event) => {
            const metres = parseLength(value(event), this.units);
            if (metres === undefined) (event.target as HTMLInputElement).value = lengthForInput(length, this.units);
            else this.edit(setWallLength(floor, wall.id, metres));
          }}
        />
      </label>
      <p class="help">The end with fewer walls attached moves.</p>
      <label>
        <span>Thickness (cm)</span>
        <input
          type="number"
          min="2"
          max="100"
          step="1"
          .value=${String(Math.round(wall.thickness * 100))}
          @change=${(event: Event) => {
            const centimetres = Number(value(event));
            if (centimetres >= 2 && centimetres <= 100) {
              this.edit(setWallThickness(floor, wall.id, centimetres / 100));
            }
          }}
        />
      </label>
      ${this.renderDelete("Delete wall")}
    `;
  }

  private renderVertex(floor: Floor, vertexId: string): TemplateResult | typeof nothing {
    const vertex = floor.vertices.find((candidate) => candidate.id === vertexId);
    if (!vertex) return nothing;
    const field = (axis: "x" | "y", label: string) => html`
      <label>
        <span>${label} (m)</span>
        <input
          type="number"
          step="0.05"
          .value=${String(Number(vertex[axis].toFixed(3)))}
          @change=${(event: Event) => {
            const metres = Number(value(event));
            if (!Number.isFinite(metres) || Math.abs(metres) > 1000) return;
            const to = { x: vertex.x, y: vertex.y, [axis]: metres };
            this.edit(commit(moveVertices(floor, new Map([[vertex.id, to]]))));
          }}
        />
      </label>
    `;
    return html`
      <h2>Corner</h2>
      <div class="pair">${field("x", "Across")}${field("y", "Down")}</div>
      ${this.renderDelete("Delete corner")}
    `;
  }

  private renderSeveral(count: number): TemplateResult {
    return html`
      <h2>${count} selected</h2>
      <p class="help">Drag any of them to move them together.</p>
      ${this.renderDelete("Delete selected")}
    `;
  }

  private renderFloor(floor: Floor): TemplateResult {
    const rooms = floor.rooms.length;
    const total = floor.rooms.reduce(
      (sum, room) => sum + polygonArea(roomPolygon(floor, room)),
      0,
    );
    return html`
      <h2>Floor</h2>
      <label>
        <span>Wall height (m)</span>
        <input
          type="number"
          min="1.5"
          max="6"
          step="0.05"
          .value=${String(floor.wall_height)}
          @change=${(event: Event) => {
            const metres = Number(value(event));
            if (metres >= 1.5 && metres <= 6) this.edit({ ...floor, wall_height: metres });
          }}
        />
      </label>
      <dl>
        <dt>Rooms</dt>
        <dd>${rooms}</dd>
        <dt>Floor area</dt>
        <dd>${formatArea(total, this.units)}</dd>
      </dl>
      <h3>Drawing</h3>
      <ul class="tips">
        <li><kbd>W</kbd> draw walls, <kbd>V</kbd> select</li>
        <li>Click to place each corner; close the loop to make a room</li>
        <li>Type a length and press <kbd>Enter</kbd> for an exact wall</li>
        <li><kbd>Esc</kbd> or right-click ends a run of walls</li>
        <li>Hold <kbd>Alt</kbd> to switch snapping off</li>
        <li>Drag the background to move around, scroll to zoom</li>
        <li><kbd>Del</kbd> deletes, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes</li>
      </ul>
    `;
  }

  private renderDelete(label: string): TemplateResult {
    return html`
      <button class="danger" @click=${() => this.dispatchEvent(new CustomEvent("inspector-delete"))}>
        ${icon("trash")} ${label}
      </button>
    `;
  }

  private setArea(room: Room, areaId: string): void {
    const area = areaId ? this.hass?.areas[areaId] : undefined;
    this.updateRoom(room, {
      area_id: areaId || null,
      // A room with no name yet takes the area's.
      ...(area && !room.name ? { name: area.name } : {}),
    });
  }

  private updateRoom(room: Room, change: Partial<Room>): void {
    const floor = this.floor;
    if (!floor) return;
    this.edit({
      ...floor,
      rooms: floor.rooms.map((other) => (other.id === room.id ? { ...other, ...change } : other)),
    });
  }

  private edit(floor: Floor): void {
    if (floor !== this.floor) this.dispatchEvent(new CustomEvent("inspector-edit", { detail: { floor } }));
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: block;
        box-sizing: border-box;
        padding: 20px;
        overflow-y: auto;
        color: var(--diorama-text);
        font-size: 14px;
      }
      h2 {
        margin: 0 0 16px;
        font-size: 18px;
        font-weight: 500;
      }
      h3 {
        margin: 24px 0 8px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--diorama-text-muted);
      }
      label,
      .field {
        display: block;
        margin-bottom: 14px;
      }
      label > span,
      .field > span {
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
        color: var(--diorama-text-muted);
      }
      input[type="text"],
      input[type="number"],
      select {
        box-sizing: border-box;
        width: 100%;
        height: 38px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: inherit;
        font: inherit;
      }
      input:focus-visible,
      select:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .help {
        margin: -8px 0 14px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--diorama-text-muted);
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        align-items: center;
      }
      .swatch,
      input[type="color"] {
        box-sizing: border-box;
        flex: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 50%;
        cursor: pointer;
      }
      .swatch.current {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 2px;
      }
      input[type="color"] {
        overflow: hidden;
        background: none;
      }
      dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px 12px;
        margin: 20px 0 0;
        padding-top: 16px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      dt {
        color: var(--diorama-text-muted);
      }
      dd {
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
      .tips {
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: 13px;
        line-height: 1.5;
        color: var(--diorama-text-muted);
      }
      .tips li {
        margin-bottom: 6px;
      }
      kbd {
        padding: 1px 5px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 4px;
        font: inherit;
        font-size: 11px;
        color: var(--diorama-text);
      }
      .danger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        height: 36px;
        padding: 0 12px 0 8px;
        border: 1px solid color-mix(in srgb, var(--error-color, #db4437) 50%, transparent);
        border-radius: 8px;
        background: none;
        color: var(--error-color, #db4437);
        font: inherit;
        cursor: pointer;
      }
      .danger:hover {
        background: color-mix(in srgb, var(--error-color, #db4437) 10%, transparent);
      }
    `,
  ];
}

function value(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-inspector": DioramaInspector;
  }
}
