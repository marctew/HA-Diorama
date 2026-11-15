import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EMPTY_CATALOGUE, findModel, type Catalogue } from "../core/catalogue";
import { distance, polygonArea, polygonPerimeter } from "../core/geometry";
import { itemSize, resizeItem, ROTATE_STEP, updateItems } from "../core/items";
import { commit, moveVertices, setWallLength, setWallThickness } from "../core/plan";
import { roomPolygon } from "../core/rooms";
import {
  fixtureVisual,
  tapAction,
  tapChoices,
  type FixtureVisual,
  type TapAction,
} from "../core/bindings";
import { bindableEntities, MARKER_HEIGHT, updateFixtures } from "../core/fixtures";
import { updateOpening } from "../core/openings";
import type { Fixture, Floor, Item, Opening, Room } from "../core/scene";
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
import { selectionCount, type Selection } from "./selection";

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
  @property({ attribute: false }) catalogue: Catalogue = EMPTY_CATALOGUE;
  @property() units: UnitSystem = "metric";

  protected override render(): TemplateResult | typeof nothing {
    const floor = this.floor;
    const selection = this.selection;
    if (!floor || !selection) return nothing;
    const count = selectionCount(selection);
    if (selection.room !== null) {
      const room = floor.rooms.find((candidate) => candidate.id === selection.room);
      if (room) return this.renderRoom(floor, room);
    }
    if (count > 1) return this.renderSeveral(count, selection);
    if (selection.openings.length === 1) {
      const opening = floor.openings.find((candidate) => candidate.id === selection.openings[0]);
      if (opening) return this.renderOpening(floor, opening);
    }
    if (selection.fixtures.length === 1) {
      const fixture = floor.fixtures.find((candidate) => candidate.id === selection.fixtures[0]);
      if (fixture) return this.renderFixture(floor, fixture);
    }
    if (selection.items.length === 1) {
      const item = floor.items.find((candidate) => candidate.id === selection.items[0]);
      if (item) return this.renderItem(floor, item);
    }
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
      <label class="check">
        <input
          type="checkbox"
          .checked=${room.open}
          @change=${(event: Event) =>
            this.updateRoom(room, { open: (event.target as HTMLInputElement).checked })}
        />
        <span>Open to the floor below (no floor here)</span>
      </label>
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

  private renderSeveral(count: number, selection: Selection): TemplateResult {
    return html`
      <h2>${count} selected</h2>
      <p class="help">Drag any of them to move them together.</p>
      ${selection.items.length > 0 ? this.renderItemActions() : nothing}
      ${this.renderDelete("Delete selected")}
    `;
  }

  private renderItem(floor: Floor, item: Item): TemplateResult {
    const model = findModel(this.catalogue, item.model);
    const room = floor.rooms.find((candidate) => candidate.id === item.room);
    const change = (patch: Partial<Item>) =>
      this.edit(updateItems(floor, new Set([item.id]), () => patch));
    const number = (
      label: string,
      current: number,
      step: number,
      apply: (value: number) => void,
      limit = 1000,
    ) => html`
      <label>
        <span>${label}</span>
        <input
          type="number"
          step=${step}
          .value=${String(Number(current.toFixed(3)))}
          @change=${(event: Event) => {
            const entered = Number(value(event));
            if (value(event) !== "" && Number.isFinite(entered) && Math.abs(entered) <= limit) {
              apply(entered);
            }
          }}
        />
      </label>
    `;
    const dimensions = itemSize(item, model);
    const stretched = item.scale !== 1 || item.stretch.some((factor) => factor !== 1);
    const support = floor.items.find((candidate) => candidate.id === item.on);
    const size = (label: string, axis: "width" | "depth" | "height") => html`
      <label>
        <span>${label} (${this.units === "metric" ? "m" : "ft"})</span>
        <input
          type="text"
          inputmode="decimal"
          .value=${lengthForInput(dimensions[axis], this.units)}
          @change=${(event: Event) => {
            const metres = parseLength(value(event).trim(), this.units);
            const patch = metres === undefined ? {} : resizeItem(item, model, axis, metres);
            if (patch.stretch) change(patch);
            else (event.target as HTMLInputElement).value = lengthForInput(dimensions[axis], this.units);
          }}
        />
      </label>
    `;
    return html`
      <h2>${model?.name ?? "Unknown furniture"}</h2>
      ${model
        ? nothing
        : html`<p class="help">
            The catalogue has no model called ${item.model}. It is shown as a grey box.
          </p>`}
      <div class="pair">
        ${number("Across (m)", item.x, 0.05, (x) => change({ x }))}
        ${number("Down (m)", item.y, 0.05, (y) => change({ y }))}
      </div>
      <div class="pair">
        ${number("Turned (degrees)", item.rotation, ROTATE_STEP, (rotation) => change({ rotation }), 720)}
        ${number(
          "Off the floor (m)",
          item.z,
          0.05,
          // Set by hand, it no longer follows what it was standing on.
          (z) => {
            if (z >= 0) change({ z, on: null });
          },
          6,
        )}
      </div>
      <div class="trio">
        ${size("Width", "width")}${size("Depth", "depth")}${size("Height", "height")}
      </div>
      ${stretched
        ? html`<button class="plain" @click=${() => change({ stretch: [1, 1, 1], scale: 1 })}>
            Back to its own size
          </button>`
        : html`<p class="help">Drag a handle on the plan to stretch it, or type a size.</p>`}
      ${model?.stairs
        ? html`<label class="check">
            <input
              type="checkbox"
              .checked=${item.cut_above}
              @change=${(event: Event) =>
                change({ cut_above: (event.target as HTMLInputElement).checked })}
            />
            <span>Opens the floor above it</span>
          </label>`
        : nothing}
      <dl>
        <dt>Room</dt>
        <dd>${room ? room.name || "Unnamed room" : "None"}</dd>
        ${support
          ? html`<dt>Stands on</dt>
              <dd>${findModel(this.catalogue, support.model)?.name ?? "Furniture"}</dd>`
          : nothing}
      </dl>
      <div class="actions">${this.renderItemActions()} ${this.renderDelete("Delete")}</div>
    `;
  }

  private renderOpening(floor: Floor, opening: Opening): TemplateResult {
    const change = (patch: Partial<Opening>) => this.edit(updateOpening(floor, opening.id, patch));
    const length = (label: string, key: "width" | "height" | "sill" | "offset") => html`
      <label>
        <span>${label} (${this.units === "metric" ? "m" : "ft"})</span>
        <input
          type="text"
          inputmode="decimal"
          .value=${opening[key] === 0 ? "0" : lengthForInput(opening[key], this.units)}
          @change=${(event: Event) => {
            const text = value(event).trim();
            const metres = /^0+([.,]0*)?$/.test(text) ? 0 : parseLength(text, this.units);
            if (metres === undefined) {
              (event.target as HTMLInputElement).value = lengthForInput(opening[key], this.units);
            } else {
              change({ [key]: metres });
            }
          }}
        />
      </label>
    `;
    return html`
      <h2>${OPENING_NAMES[opening.type]}</h2>
      <label>
        <span>Kind</span>
        <select @change=${(event: Event) => change({ type: value(event) as Opening["type"] })}>
          <option value="door" ?selected=${opening.type === "door"}>Door</option>
          <option value="window" ?selected=${opening.type === "window"}>Window</option>
          <option value="archway" ?selected=${opening.type === "archway"}>
            Archway (no door)
          </option>
        </select>
      </label>
      ${opening.type === "door"
        ? html`<label>
              <span>Leaves</span>
              <select
                @change=${(event: Event) => change({ leaves: value(event) === "2" ? 2 : 1 })}
              >
                <option value="1" ?selected=${opening.leaves === 1}>One</option>
                <option value="2" ?selected=${opening.leaves === 2}>Two (double doors)</option>
              </select>
            </label>
            <div class="actions tight">
              ${opening.leaves === 1
                ? html`<button
                    class="plain"
                    @click=${() => change({ hinge: opening.hinge === "start" ? "end" : "start" })}
                  >
                    Hinge the other side
                  </button>`
                : nothing}
              <button class="plain" @click=${() => change({ swing: opening.swing === 1 ? -1 : 1 })}>
                Open the other way
              </button>
            </div>`
        : nothing}
      <div class="pair">${length("Width", "width")}${length("Height", "height")}</div>
      <div class="pair">
        ${length("From the wall's end", "offset")}
        ${opening.type === "window" ? length("Sill height", "sill") : nothing}
      </div>
      <label>
        <span>Sensor or blind</span>
        <select
          @change=${(event: Event) => change({ entity_id: value(event) === "" ? null : value(event) })}
        >
          <option value="" ?selected=${!opening.entity_id}>None</option>
          ${this.openingEntities(opening).map(
            (choice) =>
              html`<option value=${choice.entity_id} ?selected=${choice.entity_id === opening.entity_id}>
                ${choice.name}
              </option>`,
          )}
        </select>
      </label>
      <p class="help">
        A door or window sensor shows it open or shut. A blind, shutter or garage door shows how far
        down it is, and a tap works it. A door with no sensor stands open.
      </p>
      <p class="help">
        Drag it along the wall, or onto another wall. Drag either end to make it wider or narrower.
      </p>
      ${this.renderDelete(`Delete ${OPENING_NAMES[opening.type].toLowerCase()}`)}
    `;
  }

  /** What a door or window can be tied to: sensors that say open or shut,
   * and covers. The one it has stays listed even if it has gone. */
  private openingEntities(opening: Opening): { entity_id: string; name: string }[] {
    const choices: { entity_id: string; name: string }[] = this.hass
      ? bindableEntities(this.hass).filter(
          (choice) => choice.kind === "opening" || choice.kind === "cover",
        )
      : [];
    if (opening.entity_id && !choices.some((choice) => choice.entity_id === opening.entity_id)) {
      choices.unshift({ entity_id: opening.entity_id, name: opening.entity_id });
    }
    return choices;
  }

  private renderFixture(floor: Floor, fixture: Fixture): TemplateResult {
    const entity = this.hass?.states[fixture.entity_id];
    const friendly = entity?.attributes.friendly_name;
    const name = typeof friendly === "string" && friendly ? friendly : fixture.entity_id;
    const visual = fixtureVisual(fixture.kind, entity);
    const item = floor.items.find((candidate) => candidate.id === fixture.item);
    const model = findModel(this.catalogue, item?.model ?? fixture.model ?? "");
    const room = floor.rooms.find((candidate) => candidate.id === fixture.room);
    const change = (patch: Partial<Fixture>) =>
      this.edit(updateFixtures(floor, new Set([fixture.id]), () => patch));
    const state = !entity
      ? "Not found in Home Assistant"
      : !visual.available
        ? "Unavailable"
        : stateText(fixture, visual, entity.state);
    const tap = tapAction(fixture.kind, fixture.options, entity?.attributes);
    return html`
      <h2>${name}</h2>
      <p class="entity">${fixture.entity_id}</p>
      ${entity
        ? nothing
        : html`<p class="help">
            This entity no longer exists. Remove it from the plan, or leave it until it is back.
          </p>`}
      <label>
        <span>When tapped</span>
        <select
          @change=${(event: Event) =>
            change({ options: { ...fixture.options, tap: value(event) } })}
        >
          ${tapChoices(fixture.kind).map(
            (id) =>
              html`<option value=${id} ?selected=${tap === id}>
                ${TAP_LABELS[id](fixture.kind)}
              </option>`,
          )}
        </select>
      </label>
      <p class="help">
        Press and hold always shows its
        details.${fixture.kind === "lock" ? " A lock is never worked by a tap." : ""}
      </p>
      ${item || fixture.model
        ? nothing
        : html`<label>
            <span>Height above the floor (m)</span>
            <input
              type="number"
              min="0"
              max="6"
              step="0.1"
              .value=${String(fixture.z || MARKER_HEIGHT)}
              @change=${(event: Event) => {
                const metres = Number(value(event));
                if (value(event) !== "" && metres >= 0 && metres <= 6) change({ z: metres });
              }}
            />
          </label>`}
      <dl>
        <dt>Now</dt>
        <dd>${state}</dd>
        <dt>Shown as</dt>
        <dd>${item ? `The ${(model?.name ?? "furniture").toLowerCase()}` : (model?.name ?? "A marker")}</dd>
        <dt>Room</dt>
        <dd>${room ? room.name || "Unnamed room" : "None"}</dd>
      </dl>
      <div class="actions">
        ${item
          ? html`<button
              class="plain"
              title="Take it off the furniture; it gets a marker of its own"
              @click=${() => change({ item: null, z: MARKER_HEIGHT })}
            >
              ${icon("unlink")} Detach
            </button>`
          : nothing}
        ${this.renderDelete("Remove from plan")}
      </div>
    `;
  }

  private renderItemActions(): TemplateResult {
    const fire = (name: string) => () => this.dispatchEvent(new CustomEvent(name));
    return html`
      <button class="plain" title="Turn a step (R)" @click=${fire("inspector-rotate")}>
        ${icon("rotate")} Turn
      </button>
      <button class="plain" title="Duplicate (Ctrl+D)" @click=${fire("inspector-duplicate")}>
        ${icon("copy")} Duplicate
      </button>
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
      <h3>Trace over a plan</h3>
      ${floor.trace
        ? html`
            <label>
              <span>How strongly the image shows</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                .value=${String(floor.trace.opacity)}
                @change=${(event: Event) =>
                  this.edit({ ...floor, trace: { ...floor.trace!, opacity: Number(value(event)) } })}
              />
            </label>
            <div class="actions tight">
              <button class="plain" @click=${this.fire("inspector-trace-scale")}>
                ${icon("fit")} Set the scale
              </button>
              <button class="plain" @click=${() => this.edit({ ...floor, trace: null })}>
                ${icon("trash")} Remove
              </button>
            </div>
            <p class="help spaced">
              To set the scale, click two points on the image and say how far apart they really
              are.
            </p>
          `
        : html`
            <label class="file">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  const file = input.files?.[0];
                  input.value = "";
                  if (file) {
                    this.dispatchEvent(new CustomEvent("inspector-trace-upload", { detail: { file } }));
                  }
                }}
              />
              <span class="plain">${icon("image")} Choose an image</span>
            </label>
            <p class="help spaced">
              A floor plan from the estate agent or a photo of a drawing: draw your walls over it.
            </p>
          `}
      <h3>Drawing</h3>
      <ul class="tips">
        <li>
          <kbd>W</kbd> walls, <kbd>O</kbd> doors and windows, <kbd>F</kbd> furniture,
          <kbd>B</kbd> devices, <kbd>V</kbd> select
        </li>
        <li>Click to place each corner; close the loop to make a room</li>
        <li>Type a length and press <kbd>Enter</kbd> for an exact wall</li>
        <li><kbd>Esc</kbd> or right-click ends a run of walls</li>
        <li>Hold <kbd>Alt</kbd> to switch snapping off</li>
        <li>Drag the background to move around, scroll to zoom</li>
        <li><kbd>Shift</kbd>+drag selects everything in a box</li>
        <li><kbd>R</kbd> turns furniture, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicates it</li>
        <li><kbd>Del</kbd> deletes, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes</li>
      </ul>
    `;
  }

  private fire(name: string): () => void {
    return () => this.dispatchEvent(new CustomEvent(name));
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
      .entity {
        margin: -12px 0 16px;
        font-family: var(--ha-font-family-code, ui-monospace, monospace);
        font-size: 12px;
        color: var(--diorama-text-muted);
        overflow-wrap: anywhere;
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
      .trio {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      label.check {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        margin: 10px 0;
      }
      label.check input {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--diorama-accent);
      }
      label.check span {
        font-size: 13px;
        color: var(--diorama-text);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 16px;
      }
      .actions .danger,
      .actions .plain {
        margin-top: 0;
      }
      .actions.tight {
        margin-top: 0;
      }
      .help.spaced {
        margin-top: 10px;
      }
      input[type="range"] {
        width: 100%;
        accent-color: var(--diorama-accent);
      }
      label.file {
        display: inline-block;
        margin: 0;
        cursor: pointer;
      }
      label.file input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      label.file > span.plain {
        margin: 0;
        font-size: 14px;
        color: var(--diorama-text);
      }
      label.file input:focus-visible + span {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .plain {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        margin-right: 6px;
        height: 36px;
        padding: 0 12px 0 8px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .plain:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
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

const OPENING_NAMES: Readonly<Record<Opening["type"], string>> = {
  door: "Door",
  window: "Window",
  archway: "Archway",
};

const TAP_LABELS: Readonly<Record<TapAction, (kind: Fixture["kind"]) => string>> = {
  toggle: (kind) => (kind === "cover" ? "Open or close" : "Switch on or off"),
  confirm: (kind) => (kind === "cover" ? "Ask, then open or close" : "Ask, then switch on or off"),
  "more-info": () => "Show its details",
  none: () => "Do nothing",
};

/** What a fixture is doing, in words. */
function stateText(fixture: Fixture, visual: FixtureVisual, state: string): string {
  const words = state.replace(/_/g, " ");
  const sentence = words.charAt(0).toUpperCase() + words.slice(1);
  switch (fixture.kind) {
    case "light":
      return !visual.on ? "Off" : visual.level < 1 ? `On, ${Math.round(visual.level * 100)}%` : "On";
    case "cover": {
      const open = visual.open ?? 0;
      return open === 0 ? "Closed" : open < 1 ? `Open, ${Math.round(open * 100)}%` : "Open";
    }
    case "opening":
      return visual.on ? "Open" : "Closed";
    case "presence":
      return visual.on ? "Someone is here" : "Clear";
    case "climate":
      return `${visual.label ?? sentence}${visual.on ? ", heating" : ""}`;
    case "label":
      return visual.label ?? sentence;
    case "lock":
    case "media":
      return sentence;
    default:
      return visual.on ? "On" : "Off";
  }
}
