import { css, html, LitElement, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EMPTY_CATALOGUE, findModel, type Catalogue, type CatalogueModel } from "../core/catalogue";
import {
  distance,
  interiorPoint,
  pointInPolygon,
  polygonArea,
  projectOnSegment,
  roundTo,
  type Point,
} from "../core/geometry";
import {
  itemFootprint,
  moveItems,
  normaliseRotation,
  placeItem,
  snapToWall,
} from "../core/items";
import { addWall, commit, moveVertices } from "../core/plan";
import { roomPolygon } from "../core/rooms";
import type { Floor, Item } from "../core/scene";
import { snap, type SnapResult } from "../core/snap";
import { formatArea, formatLength, parseLength, type UnitSystem } from "../core/units";
import { themeStyles } from "../shared/theme";
import { icon } from "./icons";
import { NO_SELECTION, prune, toggle, type Selection } from "./selection";
import { fit, gridStep, scaleBarLength, toScreen, toWorld, zoomAt, type View } from "./view";

export type Tool = "select" | "wall" | "furniture";

const SNAP_PIXELS = 10;
const VERTEX_HIT_PIXELS = 10;
const WALL_HIT_PIXELS = 7;
const DRAG_START_PIXELS = 4;
/** Furniture this close to a wall, in pixels, turns its back to it. */
const WALL_SNAP_PIXELS = 18;
/** Snap to 5 cm. */
const GRID = 0.05;

type Hit = { kind: "vertex" | "wall" | "item" | "room"; id: string };

type Drag =
  | { kind: "pan"; pointer: number; last: Point }
  | { kind: "marquee"; pointer: number; start: Point; end: Point }
  | {
      kind: "move";
      pointer: number;
      start: Point;
      /** The corners being moved, and where they started. */
      vertices: Map<string, Point>;
      /** The furniture being moved, and where it started. */
      items: Map<string, Item>;
      /** The thing that was grabbed: it snaps, the rest follow. */
      anchor: { kind: "vertex" | "item"; id: string };
      moved: boolean;
    };

/** The plan: draws the floor from above and turns the pointer into edits.
 *
 * It owns nothing but the viewport and what is in progress (a wall being
 * drawn, a piece of furniture being placed, a drag). Finished edits leave as
 * `plan-edit` events carrying the new floor; the selection and the tool are
 * properties, changed through `plan-select` events. */
@customElement("diorama-plan-view")
export class DioramaPlanView extends LitElement {
  @property({ attribute: false }) floor?: Floor;
  @property() tool: Tool = "select";
  @property({ attribute: false }) selection: Selection = NO_SELECTION;
  @property({ attribute: false }) catalogue: Catalogue = EMPTY_CATALOGUE;
  /** The model that a click will place, with the furniture tool. */
  @property({ attribute: false }) placing?: CatalogueModel;
  @property() units: UnitSystem = "metric";
  /** Look but do not touch: panning and zooming only. */
  @property({ type: Boolean }) readonly = false;

  @state() private view: View = { scale: 60, x: 0, y: 0 };
  @state() private width = 0;
  @state() private height = 0;
  /** While dragging: the floor with what is dragged where the pointer is. */
  @state() private transient?: Floor;
  /** The first end of the wall being drawn. */
  @state() private chain?: Point;
  /** Where the pointer is, after snapping. */
  @state() private target?: SnapResult;
  /** A length being typed for the wall being drawn. */
  @state() private typed = "";
  /** Where the furniture being placed would go. */
  @state() private ghost?: { point: Point; rotation: number };
  /** How the furniture being placed is turned, away from walls. */
  @state() private placeRotation = 0;
  @state() private marquee?: { start: Point; end: Point };
  @state() private panning = false;
  @state() private spaceDown = false;

  private drag?: Drag;
  private fitted?: string;
  /** Whether the view has been panned or zoomed by hand since it was fitted. */
  private viewTouched = false;
  private lastPointer?: { screen: Point; altKey: boolean };
  private resizeObserver?: ResizeObserver;

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.width = entry.contentRect.width;
      this.height = entry.contentRect.height;
      // Until someone pans or zooms, keep the whole floor in view.
      if (!this.viewTouched && this.floor) this.view = fit(this.floor, this.width, this.height);
    });
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Fit once per floor, as soon as there is a floor and a size.
    if (this.floor && this.width > 0 && this.height > 0 && this.fitted !== this.floor.id) {
      this.fitted = this.floor.id;
      this.viewTouched = false;
      this.view = fit(this.floor, this.width, this.height);
    }
    if (changed.has("tool") && this.tool !== "wall") this.stopDrawing();
    if (changed.has("tool") || changed.has("placing")) {
      if (this.tool !== "furniture" || !this.placing) this.ghost = undefined;
      else if (this.lastPointer) this.updateGhost(this.lastPointer.screen, this.lastPointer);
    }
    if (changed.has("floor")) this.transient = undefined;
  }

  // What the editor can ask of the plan.

  /** Show the whole floor. */
  fitToFloor(): void {
    this.viewTouched = false;
    if (this.floor) this.view = fit(this.floor, this.width, this.height);
  }

  /** True while a wall is being drawn. */
  get drawing(): boolean {
    return this.chain !== undefined;
  }

  /** Stop what is in progress. Returns false if there was nothing to stop. */
  cancel(): boolean {
    if (this.typed) {
      this.typed = "";
      return true;
    }
    if (this.chain) {
      this.stopDrawing();
      return true;
    }
    return false;
  }

  /** A key was pressed while a wall is being drawn: digits build a length,
   * Enter places the wall at that length. Returns true if the key was used. */
  typeKey(key: string): boolean {
    if (!this.chain) return false;
    if (key === "Enter") {
      if (!this.typed) return false;
      this.placeTyped();
      return true;
    }
    if (key === "Backspace") {
      if (!this.typed) return false;
      this.typed = this.typed.slice(0, -1);
      return true;
    }
    if (/^[0-9.,'"]$/.test(key) || (this.typed && /^[a-z ]$/i.test(key))) {
      if (this.typed.length < 12) this.typed += key;
      return true;
    }
    return false;
  }

  /** Turn the furniture that is about to be placed. Returns false if nothing
   * is being placed. */
  rotatePlacing(degrees: number): boolean {
    if (this.tool !== "furniture" || !this.placing) return false;
    this.placeRotation = normaliseRotation(this.placeRotation + degrees);
    if (this.lastPointer) this.updateGhost(this.lastPointer.screen, this.lastPointer);
    return true;
  }

  /** Hold space to pan with the left button. */
  setSpace(down: boolean): void {
    this.spaceDown = down;
  }

  // Rendering.

  protected override render(): TemplateResult {
    const floor = this.transient ?? this.floor;
    return html`
      <svg
        class=${this.cursorClass()}
        width=${this.width}
        height=${this.height}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerUp}
        @pointerleave=${this.onPointerLeave}
        @wheel=${this.onWheel}
        @contextmenu=${this.onContextMenu}
        @dblclick=${this.onDoubleClick}
      >
        ${this.renderGrid()}
        ${floor
          ? [
              this.renderRooms(floor),
              this.renderItems(floor),
              this.renderWalls(floor),
              this.renderVertices(floor),
            ]
          : nothing}
        ${this.renderGhost()} ${this.renderDrawing()} ${this.renderMarquee()}
      </svg>
      ${this.renderScaleBar()}
      <div class="zoom" role="group" aria-label="Zoom">
        <button title="Zoom in" aria-label="Zoom in" @click=${() => this.zoomBy(1.4)}>
          ${icon("plus")}
        </button>
        <button title="Zoom out" aria-label="Zoom out" @click=${() => this.zoomBy(1 / 1.4)}>
          ${icon("minus")}
        </button>
        <button title="Show everything" aria-label="Show everything" @click=${this.fitToFloor}>
          ${icon("fit")}
        </button>
      </div>
    `;
  }

  private cursorClass(): string {
    if (this.panning) return "panning";
    if (this.spaceDown || this.readonly) return "pannable";
    if (this.tool === "wall") return "drawing";
    return this.tool === "furniture" && this.placing ? "placing" : "";
  }

  private renderGrid(): TemplateResult {
    const { scale, x, y } = this.view;
    const fine = gridStep(scale) * scale;
    const heavy = fine * 10;
    return svg`
      <defs>
        <pattern id="fine" width=${fine} height=${fine} patternUnits="userSpaceOnUse"
          patternTransform="translate(${x} ${y})">
          <path class="grid-fine" d="M ${fine} 0 L 0 0 0 ${fine}" />
        </pattern>
        <pattern id="heavy" width=${heavy} height=${heavy} patternUnits="userSpaceOnUse"
          patternTransform="translate(${x} ${y})">
          <path class="grid-heavy" d="M ${heavy} 0 L 0 0 0 ${heavy}" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#fine)" />
      <rect width="100%" height="100%" fill="url(#heavy)" />
    `;
  }

  private renderRooms(floor: Floor): TemplateResult[] {
    return floor.rooms.map((room) => {
      const world = roomPolygon(floor, room);
      if (world.length < 3) return svg``;
      const points = world.map((point) => toScreen(this.view, point));
      const selected = this.selection.room === room.id;
      const xs = points.map((point) => point.x);
      const wide = Math.max(...xs) - Math.min(...xs);
      const centre = toScreen(this.view, interiorPoint(world));
      return svg`
        <polygon
          class="room ${selected ? "selected" : ""}"
          points=${points.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        ${
          wide < 70
            ? nothing
            : svg`
              <text class="room-name ${room.name ? "" : "unnamed"}" x=${centre.x} y=${centre.y - 3}>
                ${room.name || "Unnamed room"}
              </text>
              <text class="room-area" x=${centre.x} y=${centre.y + 14}>
                ${formatArea(polygonArea(world), this.units)}
              </text>
            `
        }
      `;
    });
  }

  private renderItems(floor: Floor): TemplateResult[] {
    const selected = new Set(this.selection.items);
    return floor.items.map((item) => {
      const model = findModel(this.catalogue, item.model);
      return this.renderFootprint(
        item,
        model,
        `item ${selected.has(item.id) ? "selected" : ""} ${model ? "" : "unknown"}`,
      );
    });
  }

  /** A piece of furniture from above: its outline, and a bar along its front. */
  private renderFootprint(
    item: Item,
    model: CatalogueModel | undefined,
    classes: string,
  ): TemplateResult {
    const corners = itemFootprint(item, model).map((point) => toScreen(this.view, point));
    const [backLeft, backRight, frontRight, frontLeft] = corners;
    const towards = (from: Point, to: Point, t: number): Point => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    // The bar sits a little in from the front edge.
    const left = towards(towards(frontLeft, backLeft, 0.12), frontRight, 0.14);
    const right = towards(towards(frontRight, backRight, 0.12), frontLeft, 0.14);
    return svg`
      <g class=${classes}>
        <polygon points=${corners.map((point) => `${point.x},${point.y}`).join(" ")} />
        <line class="front" x1=${left.x} y1=${left.y} x2=${right.x} y2=${right.y} />
      </g>
    `;
  }

  private renderGhost(): TemplateResult | typeof nothing {
    if (!this.ghost || !this.placing || this.readonly) return nothing;
    const item: Item = {
      id: "ghost",
      model: this.placing.id,
      x: this.ghost.point.x,
      y: this.ghost.point.y,
      z: 0,
      rotation: this.ghost.rotation,
      scale: 1,
      room: null,
    };
    return this.renderFootprint(item, this.placing, "item ghost");
  }

  private renderWalls(floor: Floor): TemplateResult[] {
    const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
    const selected = new Set(this.selection.walls);
    return floor.walls.map((wall) => {
      const from = position.get(wall.a);
      const to = position.get(wall.b);
      if (!from || !to) return svg``;
      const a = toScreen(this.view, from);
      const b = toScreen(this.view, to);
      return svg`
        <line
          class="wall ${selected.has(wall.id) ? "selected" : ""}"
          x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y}
          stroke-width=${Math.max(2.5, wall.thickness * this.view.scale)}
        />
        ${this.renderDimension(a, b, distance(from, to), selected.has(wall.id))}
      `;
    });
  }

  /** The length of a wall, written alongside it. */
  private renderDimension(a: Point, b: Point, metres: number, strong: boolean, text?: string) {
    const length = distance(a, b);
    if (length < 54 && !strong) return nothing;
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90 || angle <= -90) angle += 180;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return svg`
      <text
        class="dimension ${strong ? "strong" : ""}"
        transform="translate(${middle.x} ${middle.y}) rotate(${angle})"
        y="-9"
      >${text ?? formatLength(metres, this.units)}</text>
    `;
  }

  private renderVertices(floor: Floor): TemplateResult[] {
    if (this.readonly || this.tool === "furniture") return [];
    const selected = new Set(this.selection.vertices);
    return floor.vertices.map((vertex) => {
      const point = toScreen(this.view, vertex);
      return svg`<circle
        class="vertex ${selected.has(vertex.id) ? "selected" : ""}"
        cx=${point.x} cy=${point.y} r=${selected.has(vertex.id) ? 6 : 4}
      />`;
    });
  }

  private renderDrawing(): TemplateResult | typeof nothing {
    const target = this.target;
    if (!target || this.readonly) return nothing;
    const at = toScreen(this.view, target.point);
    const guides = target.guides.map((guide) => {
      const from = toScreen(this.view, guide.from);
      const to = toScreen(this.view, guide.to);
      return svg`<line class="guide" x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} />`;
    });
    if (this.tool !== "wall") return svg`${guides}`;

    let preview: TemplateResult | typeof nothing = nothing;
    if (this.chain) {
      const end = this.previewEnd();
      const from = toScreen(this.view, this.chain);
      const to = toScreen(this.view, end);
      preview = svg`
        <line class="preview" x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} />
        <circle class="chain-start" cx=${from.x} cy=${from.y} r="4" />
        ${this.renderDimension(from, to, distance(this.chain, end), true, this.typed ? `${this.typed}▏` : undefined)}
      `;
    }
    const marker =
      target.kind === "vertex"
        ? svg`<circle class="snap" cx=${at.x} cy=${at.y} r="8" />`
        : target.kind === "midpoint"
          ? svg`<rect class="snap" x=${at.x - 6} y=${at.y - 6} width="12" height="12" />`
          : target.kind === "wall"
            ? svg`<path class="snap" d="M ${at.x - 6} ${at.y - 6} l 12 12 m 0 -12 l -12 12" />`
            : svg`<circle class="snap-dot" cx=${at.x} cy=${at.y} r="3" />`;
    return svg`${guides}${preview}${this.typed ? nothing : marker}`;
  }

  private renderMarquee(): TemplateResult | typeof nothing {
    if (!this.marquee) return nothing;
    const { start, end } = this.marquee;
    return svg`<rect
      class="marquee"
      x=${Math.min(start.x, end.x)} y=${Math.min(start.y, end.y)}
      width=${Math.abs(end.x - start.x)} height=${Math.abs(end.y - start.y)}
    />`;
  }

  private renderScaleBar(): TemplateResult {
    const metres = scaleBarLength(this.view.scale);
    return html`
      <div class="scale-bar" style="width: ${metres * this.view.scale}px">
        ${formatLength(metres, this.units)}
      </div>
    `;
  }

  // Pointer handling.

  private pointerPosition(event: PointerEvent | WheelEvent | MouseEvent): Point {
    const box = this.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private snapAt(screen: Point, event: { altKey: boolean }, exclude?: ReadonlySet<string>): SnapResult {
    const floor = this.floor;
    const world = toWorld(this.view, screen);
    if (!floor) return { point: world, kind: "none", guides: [] };
    return snap(world, floor, {
      tolerance: SNAP_PIXELS / this.view.scale,
      grid: GRID,
      from: exclude ? undefined : this.chain,
      exclude,
      enabled: !event.altKey,
    });
  }

  /** Where a model goes for a pointer position: back to a nearby wall if it
   * is that sort of furniture, otherwise on the grid, turned as given. */
  private furnitureAt(
    world: Point,
    model: CatalogueModel | undefined,
    scale: number,
    rotation: number,
    event: { altKey: boolean },
  ): { point: Point; rotation: number } {
    const floor = this.floor;
    if (event.altKey || !floor) return { point: world, rotation };
    if (model?.against_wall) {
      const onWall = snapToWall(floor, world, model, scale, WALL_SNAP_PIXELS / this.view.scale);
      if (onWall) return onWall;
    }
    return { point: { x: roundTo(world.x, GRID), y: roundTo(world.y, GRID) }, rotation };
  }

  private updateGhost(screen: Point, event: { altKey: boolean }): void {
    if (!this.placing) return;
    this.ghost = this.furnitureAt(
      toWorld(this.view, screen),
      this.placing,
      1,
      this.placeRotation,
      event,
    );
  }

  private onPointerDown(event: PointerEvent): void {
    const screen = this.pointerPosition(event);
    const svgElement = event.currentTarget as SVGSVGElement;
    const panButton = event.button === 1 || (event.button === 0 && (this.spaceDown || this.readonly));
    if (panButton) {
      event.preventDefault();
      this.startPan(svgElement, event, screen);
      return;
    }
    if (event.button === 2) {
      if (this.chain) this.stopDrawing();
      return;
    }
    if (event.button !== 0 || !this.floor) return;

    if (this.tool === "wall") {
      this.placePoint(this.snapAt(screen, event));
      return;
    }
    if (this.tool === "furniture" && this.placing) {
      this.updateGhost(screen, event);
      if (this.ghost) this.placeFurniture(this.ghost);
      return;
    }

    const hit = this.hitTest(toWorld(this.view, screen));
    if (hit && hit.kind !== "room") {
      const list = hit.kind === "vertex" ? "vertices" : hit.kind === "wall" ? "walls" : "items";
      const already = this.selection[list].includes(hit.id);
      let selection: Selection;
      if (event.shiftKey) {
        selection = { ...this.selection, room: null, [list]: toggle(this.selection[list], hit.id) };
      } else if (already) {
        selection = this.selection;
      } else {
        selection = { ...NO_SELECTION, [list]: [hit.id] };
      }
      this.select(selection);
      if (event.shiftKey && already) return;
      this.startMove(svgElement, event, screen, selection, hit);
      return;
    }
    if (event.shiftKey) {
      svgElement.setPointerCapture(event.pointerId);
      this.drag = { kind: "marquee", pointer: event.pointerId, start: screen, end: screen };
      return;
    }
    this.select(hit ? { ...NO_SELECTION, room: hit.id } : NO_SELECTION);
    this.startPan(svgElement, event, screen);
  }

  private startPan(element: SVGSVGElement, event: PointerEvent, screen: Point): void {
    element.setPointerCapture(event.pointerId);
    this.drag = { kind: "pan", pointer: event.pointerId, last: screen };
  }

  private startMove(
    element: SVGSVGElement,
    event: PointerEvent,
    screen: Point,
    selection: Selection,
    hit: Hit,
  ): void {
    const floor = this.floor!;
    const ids = new Set(selection.vertices);
    for (const wall of floor.walls) {
      if (!selection.walls.includes(wall.id)) continue;
      ids.add(wall.a);
      ids.add(wall.b);
    }
    const vertices = new Map<string, Point>();
    for (const vertex of floor.vertices) {
      if (ids.has(vertex.id)) vertices.set(vertex.id, { x: vertex.x, y: vertex.y });
    }
    const items = new Map<string, Item>();
    for (const item of floor.items) {
      if (selection.items.includes(item.id)) items.set(item.id, item);
    }
    let anchor: { kind: "vertex" | "item"; id: string } | undefined;
    if (hit.kind === "item" && items.has(hit.id)) anchor = { kind: "item", id: hit.id };
    else if (hit.kind === "vertex" && vertices.has(hit.id)) anchor = { kind: "vertex", id: hit.id };
    else if (vertices.size > 0) anchor = { kind: "vertex", id: [...vertices.keys()][0] };
    else if (items.size > 0) anchor = { kind: "item", id: [...items.keys()][0] };
    if (!anchor) return;
    element.setPointerCapture(event.pointerId);
    this.drag = {
      kind: "move",
      pointer: event.pointerId,
      start: screen,
      vertices,
      items,
      anchor,
      moved: false,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    const screen = this.pointerPosition(event);
    this.lastPointer = { screen, altKey: event.altKey };
    const drag = this.drag;
    if (drag?.kind === "pan" && drag.pointer === event.pointerId) {
      this.panning = true;
      this.viewTouched = true;
      this.view = {
        ...this.view,
        x: this.view.x + screen.x - drag.last.x,
        y: this.view.y + screen.y - drag.last.y,
      };
      drag.last = screen;
      return;
    }
    if (drag?.kind === "marquee" && drag.pointer === event.pointerId) {
      drag.end = screen;
      this.marquee = { start: drag.start, end: screen };
      return;
    }
    if (drag?.kind === "move" && drag.pointer === event.pointerId) {
      if (!drag.moved && distance(screen, drag.start) < DRAG_START_PIXELS) return;
      drag.moved = true;
      this.dragTo(drag, screen, event);
      return;
    }
    if (this.readonly) return;
    this.target = this.tool === "wall" ? this.snapAt(screen, event) : undefined;
    if (this.tool === "furniture" && this.placing) this.updateGhost(screen, event);
  }

  /** Move what is being dragged. The thing that was grabbed snaps; the rest
   * keep their places relative to it. */
  private dragTo(drag: Extract<Drag, { kind: "move" }>, screen: Point, event: PointerEvent): void {
    const floor = this.floor!;
    const offset = { x: screen.x - drag.start.x, y: screen.y - drag.start.y };
    let dx: number;
    let dy: number;
    let rotation: number | undefined;
    if (drag.anchor.kind === "vertex") {
      const origin = drag.vertices.get(drag.anchor.id)!;
      const wanted = toScreen(this.view, origin);
      const result = this.snapAt(
        { x: wanted.x + offset.x, y: wanted.y + offset.y },
        event,
        new Set(drag.vertices.keys()),
      );
      dx = result.point.x - origin.x;
      dy = result.point.y - origin.y;
      this.target = result;
    } else {
      const origin = drag.items.get(drag.anchor.id)!;
      const wanted = toScreen(this.view, origin);
      const world = toWorld(this.view, { x: wanted.x + offset.x, y: wanted.y + offset.y });
      // Only a piece moved on its own turns to face away from a wall.
      const alone = drag.items.size === 1 && drag.vertices.size === 0;
      const model = alone ? findModel(this.catalogue, origin.model) : undefined;
      const placed = this.furnitureAt(world, model, origin.scale, origin.rotation, event);
      dx = placed.point.x - origin.x;
      dy = placed.point.y - origin.y;
      if (alone) rotation = placed.rotation;
    }
    const corners = new Map<string, Point>();
    for (const [id, origin] of drag.vertices) corners.set(id, { x: origin.x + dx, y: origin.y + dy });
    let moved = moveVertices(floor, corners);
    if (drag.items.size > 0) {
      const places = new Map<string, Point>();
      for (const [id, origin] of drag.items) places.set(id, { x: origin.x + dx, y: origin.y + dy });
      moved = moveItems(moved, places);
      if (rotation !== undefined) {
        moved = {
          ...moved,
          items: moved.items.map((item) =>
            item.id === drag.anchor.id ? { ...item, rotation: rotation! } : item,
          ),
        };
      }
    }
    this.transient = moved;
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.drag = undefined;
    this.panning = false;
    if (drag.kind === "marquee") {
      this.marquee = undefined;
      if (distance(drag.start, drag.end) >= DRAG_START_PIXELS) {
        this.selectWithin(drag.start, drag.end);
      }
      return;
    }
    if (drag.kind !== "move") return;
    const moved = this.transient;
    this.transient = undefined;
    this.target = undefined;
    if (!drag.moved || !moved) return;
    // Walls only need tidying if a corner moved.
    this.edit(drag.vertices.size > 0 ? commit(moved) : moved);
  }

  private onPointerLeave(): void {
    if (this.drag) return;
    if (!this.chain) this.target = undefined;
    this.ghost = undefined;
    this.lastPointer = undefined;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    // A mouse wheel sends big steps, a trackpad many small ones.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.viewTouched = true;
    this.view = zoomAt(this.view, this.pointerPosition(event), factor);
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  private onDoubleClick(): void {
    // The second click of a double click has already placed a point.
    if (this.tool === "wall" && this.chain) this.stopDrawing();
  }

  private zoomBy(factor: number): void {
    this.viewTouched = true;
    this.view = zoomAt(this.view, { x: this.width / 2, y: this.height / 2 }, factor);
  }

  // Drawing walls.

  private placePoint(result: SnapResult): void {
    const floor = this.floor;
    if (!floor) return;
    if (!this.chain) {
      this.chain = result.point;
      this.typed = "";
      return;
    }
    const drawn = addWall(floor, this.chain, result.point);
    if (drawn === floor) return;
    this.typed = "";
    this.edit(drawn);
    // Landing on something that was already there finishes the run of walls.
    const landed = result.kind === "vertex" || result.kind === "midpoint" || result.kind === "wall";
    this.chain = landed ? undefined : result.point;
  }

  /** Where the wall being drawn ends: at the pointer, or at the typed length
   * in the pointer's direction. */
  private previewEnd(): Point {
    const chain = this.chain!;
    const target = this.target?.point ?? chain;
    const length = this.typed ? parseLength(this.typed, this.units) : undefined;
    const current = distance(chain, target);
    if (length === undefined || current === 0) return target;
    return {
      x: Number((chain.x + ((target.x - chain.x) / current) * length).toFixed(6)),
      y: Number((chain.y + ((target.y - chain.y) / current) * length).toFixed(6)),
    };
  }

  private placeTyped(): void {
    const chain = this.chain;
    if (!chain || !this.target || parseLength(this.typed, this.units) === undefined) return;
    const end = this.previewEnd();
    if (distance(chain, end) === 0) return;
    this.placePoint({ point: end, kind: "none", guides: [] });
  }

  private stopDrawing(): void {
    this.chain = undefined;
    this.typed = "";
  }

  // Furniture.

  private placeFurniture(at: { point: Point; rotation: number }): void {
    const floor = this.floor;
    if (!floor || !this.placing) return;
    const placed = placeItem(floor, this.placing.id, at.point, at.rotation);
    this.dispatchEvent(new CustomEvent("plan-edit", { detail: { floor: placed.floor } }));
    // Not selected: the next click places another.
  }

  // Hit testing.

  private hitTest(world: Point): Hit | undefined {
    const floor = this.floor;
    if (!floor) return undefined;
    let best: { id: string; distance: number } | undefined;
    for (const vertex of floor.vertices) {
      const d = distance(vertex, world);
      if (d <= VERTEX_HIT_PIXELS / this.view.scale && (!best || d < best.distance)) {
        best = { id: vertex.id, distance: d };
      }
    }
    if (best) return { kind: "vertex", id: best.id };

    const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
    for (const wall of floor.walls) {
      const a = position.get(wall.a);
      const b = position.get(wall.b);
      if (!a || !b) continue;
      const reach = Math.max(WALL_HIT_PIXELS / this.view.scale, wall.thickness / 2);
      const d = projectOnSegment(world, a, b).distance;
      if (d <= reach && (!best || d < best.distance)) best = { id: wall.id, distance: d };
    }
    if (best) return { kind: "wall", id: best.id };

    // Furniture under the pointer: a selected piece first, so that what was
    // just picked or copied is what gets dragged; then the smallest (a lamp on
    // a rug wins); then the one drawn last, which is the one on top.
    let item: { id: string; area: number; selected: boolean } | undefined;
    for (const candidate of floor.items) {
      const outline = itemFootprint(candidate, findModel(this.catalogue, candidate.model));
      if (!pointInPolygon(world, outline)) continue;
      const area = polygonArea(outline);
      const selected = this.selection.items.includes(candidate.id);
      const better =
        !item ||
        (selected && !item.selected) ||
        (selected === item.selected && area <= item.area + 1e-9);
      if (better) item = { id: candidate.id, area, selected };
    }
    if (item) return { kind: "item", id: item.id };

    // The smallest room under the pointer: a room inside a room wins.
    let room: { id: string; area: number } | undefined;
    for (const candidate of floor.rooms) {
      const polygon = roomPolygon(floor, candidate);
      if (polygon.length < 3 || !pointInPolygon(world, polygon)) continue;
      const area = polygonArea(polygon);
      if (!room || area < room.area) room = { id: candidate.id, area };
    }
    return room ? { kind: "room", id: room.id } : undefined;
  }

  /** Select the corners, whole walls and furniture inside a dragged box. */
  private selectWithin(start: Point, end: Point): void {
    const floor = this.floor;
    if (!floor) return;
    const a = toWorld(this.view, start);
    const b = toWorld(this.view, end);
    const inside = (point: Point) =>
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y);
    const vertices = floor.vertices.filter(inside).map((vertex) => vertex.id);
    const within = new Set(vertices);
    this.select({
      vertices,
      walls: floor.walls
        .filter((wall) => within.has(wall.a) && within.has(wall.b))
        .map((wall) => wall.id),
      items: floor.items.filter(inside).map((item) => item.id),
      room: null,
    });
  }

  // Events out.

  private edit(floor: Floor): void {
    this.dispatchEvent(new CustomEvent("plan-edit", { detail: { floor } }));
    const selection = prune(this.selection, floor);
    if (selection !== this.selection) this.select(selection);
  }

  private select(selection: Selection): void {
    if (selection === this.selection) return;
    this.dispatchEvent(new CustomEvent("plan-select", { detail: { selection } }));
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        background: var(--primary-background-color, #fafafa);
        --grid: color-mix(in srgb, var(--diorama-text) 7%, transparent);
        --grid-heavy: color-mix(in srgb, var(--diorama-text) 14%, transparent);
        --halo: var(--primary-background-color, #fafafa);
      }
      svg {
        display: block;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      svg.drawing {
        cursor: crosshair;
      }
      svg.placing {
        cursor: copy;
      }
      svg.pannable {
        cursor: grab;
      }
      svg.panning {
        cursor: grabbing;
      }
      .grid-fine,
      .grid-heavy {
        fill: none;
        stroke: var(--grid);
        stroke-width: 1;
      }
      .grid-heavy {
        stroke: var(--grid-heavy);
      }
      .room {
        fill: color-mix(in srgb, var(--diorama-accent) 8%, transparent);
        stroke: none;
      }
      .room.selected {
        fill: color-mix(in srgb, var(--diorama-accent) 24%, transparent);
      }
      text {
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
        text-anchor: middle;
        pointer-events: none;
        paint-order: stroke;
        stroke: var(--halo);
        stroke-width: 4px;
        stroke-linejoin: round;
      }
      .room-name {
        font-size: 13px;
        font-weight: 500;
        fill: var(--diorama-text);
        stroke: none;
      }
      .room-name.unnamed {
        font-weight: 400;
        font-style: italic;
        fill: var(--diorama-text-muted);
      }
      .room-area {
        font-size: 11px;
        fill: var(--diorama-text-muted);
        stroke: none;
      }
      .item polygon {
        fill: color-mix(in srgb, var(--diorama-text) 10%, var(--halo));
        stroke: color-mix(in srgb, var(--diorama-text) 55%, transparent);
        stroke-width: 1.25;
        stroke-linejoin: round;
      }
      .item .front {
        stroke: color-mix(in srgb, var(--diorama-text) 55%, transparent);
        stroke-width: 2.5;
        stroke-linecap: round;
      }
      .item.unknown polygon {
        stroke-dasharray: 4 3;
      }
      .item.selected polygon {
        fill: color-mix(in srgb, var(--diorama-accent) 28%, var(--halo));
        stroke: var(--diorama-accent);
        stroke-width: 2;
      }
      .item.selected .front,
      .item.ghost .front {
        stroke: var(--diorama-accent);
      }
      .item.ghost {
        pointer-events: none;
      }
      .item.ghost polygon {
        fill: color-mix(in srgb, var(--diorama-accent) 18%, transparent);
        stroke: var(--diorama-accent);
        stroke-dasharray: 5 4;
      }
      .wall {
        stroke: color-mix(in srgb, var(--diorama-text) 82%, transparent);
        stroke-linecap: round;
      }
      .wall.selected {
        stroke: var(--diorama-accent);
      }
      .dimension {
        font-size: 11px;
        fill: var(--diorama-text-muted);
      }
      .dimension.strong {
        font-size: 12px;
        font-weight: 500;
        fill: var(--diorama-accent);
      }
      .vertex {
        fill: var(--halo);
        stroke: color-mix(in srgb, var(--diorama-text) 82%, transparent);
        stroke-width: 1.5;
      }
      .vertex.selected {
        fill: var(--diorama-accent);
        stroke: var(--halo);
        stroke-width: 2;
      }
      .preview {
        stroke: var(--diorama-accent);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-dasharray: 2 7;
      }
      .chain-start,
      .snap-dot {
        fill: var(--diorama-accent);
      }
      .snap {
        fill: none;
        stroke: var(--diorama-accent);
        stroke-width: 2;
      }
      .guide {
        stroke: var(--diorama-accent);
        stroke-width: 1;
        stroke-dasharray: 4 4;
        opacity: 0.7;
      }
      .marquee {
        fill: color-mix(in srgb, var(--diorama-accent) 12%, transparent);
        stroke: var(--diorama-accent);
        stroke-width: 1;
        stroke-dasharray: 4 3;
      }
      .scale-bar {
        position: absolute;
        left: 16px;
        bottom: 16px;
        box-sizing: border-box;
        height: 18px;
        border: 1.5px solid var(--diorama-text-muted);
        border-top: 0;
        font-size: 11px;
        line-height: 12px;
        text-align: center;
        color: var(--diorama-text-muted);
        pointer-events: none;
      }
      .zoom {
        position: absolute;
        right: 16px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 12px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }
      .zoom button {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--diorama-text);
        cursor: pointer;
      }
      .zoom button:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      .zoom button:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: -2px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-plan-view": DioramaPlanView;
  }
}
