// Furniture on a floor. An item has a model, a position, and a rotation in
// degrees: at 0 its front faces down the plan (+y), and positive turns it
// clockwise as seen from above. Like plan.ts, every function returns a new
// floor.

import type { CatalogueModel } from "./catalogue";
import {
  distance,
  pointInPolygon,
  polygonArea,
  projectOnSegment,
  type Point,
} from "./geometry";
import { newId, type MakeId } from "./ids";
import { syncFixtures } from "./fixtures";
import { roomPolygon } from "./rooms";
import type { Floor, Item } from "./scene";

/** Drawn for an item whose model the catalogue does not know. */
const UNKNOWN_SIZE = 0.5;

export const ROTATE_STEP = 15;

/** A model-space offset (across, back to front) turned into plan directions. */
function turn(across: number, front: number, rotation: number): Point {
  const angle = (rotation * Math.PI) / 180;
  return {
    x: across * Math.cos(angle) - front * Math.sin(angle),
    y: across * Math.sin(angle) + front * Math.cos(angle),
  };
}

/** Keep a rotation in the range -180 (exclusive) to 180. */
export function normaliseRotation(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : Number(wrapped.toFixed(3));
}

/** How much bigger than its model an item is each way: across, up, and
 * front to back (the model's own axes). */
export function itemScale(item: Pick<Item, "scale" | "stretch">): [number, number, number] {
  const [across, depth, up] = item.stretch ?? [1, 1, 1];
  return [item.scale * across, item.scale * up, item.scale * depth];
}

/** The size of an item, in metres. */
export function itemSize(
  item: Pick<Item, "scale" | "stretch">,
  model: CatalogueModel | undefined,
): { width: number; depth: number; height: number } {
  const [sx, sy, sz] = itemScale(item);
  return {
    width: (model?.width ?? UNKNOWN_SIZE) * sx,
    depth: (model?.depth ?? UNKNOWN_SIZE) * sz,
    height: (model?.height ?? UNKNOWN_SIZE) * sy,
  };
}

/** The four corners of the floor space an item takes up: back left, back
 * right, front right, front left. */
export function itemFootprint(item: Item, model: CatalogueModel | undefined): Point[] {
  const [sx, , sz] = itemScale(item);
  const w = (model?.width ?? UNKNOWN_SIZE) / 2;
  const d = (model?.depth ?? UNKNOWN_SIZE) / 2;
  const [cx, cz] = model?.centre ?? [0, 0];
  const corner = (across: number, front: number): Point => {
    const offset = turn((cx + across) * sx, (cz + front) * sz, item.rotation);
    return { x: item.x + offset.x, y: item.y + offset.y };
  };
  return [corner(-w, -d), corner(w, -d), corner(w, d), corner(-w, d)];
}

/** The outline to pick an item by: its own, except that a strip of light or
 * a light panel on a wall, a centimetre or two across, is taken to be wide
 * enough to hit. */
export function pickFootprint(item: Item, model: CatalogueModel | undefined): Point[] {
  const depth = itemSize(item, model).depth;
  if (!(model?.strip || model?.lit) || depth >= PICK_DEPTH) return itemFootprint(item, model);
  const stretch: [number, number, number] = [...item.stretch];
  stretch[1] *= PICK_DEPTH / depth;
  return itemFootprint({ ...item, stretch }, model);
}

const PICK_DEPTH = 0.16;

/** The least and most a piece can be stretched to, in metres. */
export const MIN_SIZE = 0.05;
export const MAX_SIZE = 30;

/** Make an item a given size one way, in metres, keeping its middle where it
 * is. Returns what to change, or nothing if the size will not do. */
export function resizeItem(
  item: Item,
  model: CatalogueModel | undefined,
  axis: "width" | "depth" | "height",
  metres: number,
): Partial<Item> {
  const natural = (model?.[axis] ?? UNKNOWN_SIZE) * item.scale;
  if (!(metres >= MIN_SIZE) || metres > MAX_SIZE || !(natural > 0)) return {};
  const stretch: [number, number, number] = [...(item.stretch ?? [1, 1, 1])];
  stretch[axis === "width" ? 0 : axis === "depth" ? 1 : 2] = Number((metres / natural).toFixed(6));
  return { stretch };
}

/** Drag one side of an item to a point: that side follows, the opposite one
 * stays where it is. `side` is 1 for its right or front, -1 for its left or
 * back. `step` rounds the new size, in metres. */
export function stretchItemTo(
  item: Item,
  model: CatalogueModel | undefined,
  axis: "width" | "depth",
  side: 1 | -1,
  point: Point,
  step = 0,
): Partial<Item> {
  const [sx, , sz] = itemScale(item);
  const natural = (model?.[axis] ?? UNKNOWN_SIZE) * item.scale;
  const [cx, cz] = model?.centre ?? [0, 0];
  const along = axis === "width" ? turn(1, 0, item.rotation) : turn(0, 1, item.rotation);
  const middle = turn(cx * sx, cz * sz, item.rotation);
  const half = ((model?.[axis] ?? UNKNOWN_SIZE) * (axis === "width" ? sx : sz)) / 2;
  // The side that stays put.
  const fixed = {
    x: item.x + middle.x - side * along.x * half,
    y: item.y + middle.y - side * along.y * half,
  };
  let size = side * ((point.x - fixed.x) * along.x + (point.y - fixed.y) * along.y);
  if (step > 0) size = Math.round(size / step) * step;
  size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));
  const factor = size / natural;
  const stretch: [number, number, number] = [...(item.stretch ?? [1, 1, 1])];
  stretch[axis === "width" ? 0 : 1] = Number(factor.toFixed(6));
  // The model's own middle moves as it is stretched, if it is off-centre.
  const stretched = turn(
    cx * item.scale * stretch[0],
    cz * item.scale * stretch[1],
    item.rotation,
  );
  return {
    stretch,
    x: round(fixed.x + (side * along.x * size) / 2 - stretched.x),
    y: round(fixed.y + (side * along.y * size) / 2 - stretched.y),
  };
}

/** The id of the room a point is in, or null. A room inside a room wins. */
export function roomAt(floor: Pick<Floor, "vertices" | "rooms">, point: Point): string | null {
  let best: { id: string; area: number } | undefined;
  for (const room of floor.rooms) {
    const polygon = roomPolygon(floor, room);
    if (polygon.length < 3 || !pointInPolygon(point, polygon)) continue;
    const area = polygonArea(polygon);
    if (!best || area < best.area) best = { id: room.id, area };
  }
  return best?.id ?? null;
}

export function placeItem(
  floor: Floor,
  model: string,
  point: Point,
  rotation = 0,
  makeId: MakeId = newId,
  /** How far off the floor: for things that go on a wall. */
  z = 0,
): { floor: Floor; id: string } {
  const id = makeId("i");
  const item: Item = {
    id,
    model,
    x: round(point.x),
    y: round(point.y),
    z: round(z),
    rotation: normaliseRotation(rotation),
    scale: 1,
    room: roomAt(floor, point),
    stretch: [1, 1, 1],
    on: null,
    cut_above: true,
  };
  return { floor: { ...floor, items: [...floor.items, item] }, id };
}

/** Change items. Their room follows where they end up, and whatever stands
 * on one that moves or turns goes with it. */
export function updateItems(
  floor: Floor,
  ids: ReadonlySet<string>,
  change: (item: Item) => Partial<Item>,
): Floor {
  let changed = false;
  const before = new Map<string, Item>();
  const after = new Map<string, Item>();
  let items = floor.items.map((item) => {
    if (!ids.has(item.id)) return item;
    const next = { ...item, ...change(item) };
    next.x = round(next.x);
    next.y = round(next.y);
    next.rotation = normaliseRotation(next.rotation);
    next.room = roomAt(floor, next);
    const same = (Object.keys(next) as (keyof Item)[]).every((key) => sameValue(next[key], item[key]));
    if (same) return item;
    changed = true;
    before.set(item.id, item);
    after.set(item.id, next);
    return next;
  });
  if (!changed) return floor;
  items = items.map((item) => {
    const was = item.on !== null && !ids.has(item.id) ? before.get(item.on) : undefined;
    const now = was && after.get(was.id);
    if (!was || !now) return item;
    const offset = turn(item.x - was.x, item.y - was.y, now.rotation - was.rotation);
    const position = { x: round(now.x + offset.x), y: round(now.y + offset.y) };
    return {
      ...item,
      ...position,
      rotation: normaliseRotation(item.rotation + now.rotation - was.rotation),
      room: roomAt(floor, position),
    };
  });
  return syncFixtures({ ...floor, items });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

export function moveItems(floor: Floor, positions: ReadonlyMap<string, Point>): Floor {
  return updateItems(floor, new Set(positions.keys()), (item) => positions.get(item.id)!);
}

export function rotateItems(floor: Floor, ids: ReadonlySet<string>, degrees: number): Floor {
  return updateItems(floor, ids, (item) => ({ rotation: item.rotation + degrees }));
}

/** Copy items, a little down and to the right. Returns the copies' ids. */
export function duplicateItems(
  floor: Floor,
  ids: ReadonlySet<string>,
  offset = 0.3,
  makeId: MakeId = newId,
): { floor: Floor; ids: string[] } {
  const copies: Item[] = [];
  const copyOf = new Map<string, string>();
  for (const item of floor.items) {
    if (!ids.has(item.id)) continue;
    const position = { x: round(item.x + offset), y: round(item.y + offset) };
    const id = makeId("i");
    copyOf.set(item.id, id);
    copies.push({
      ...item,
      ...position,
      stretch: [...item.stretch],
      id,
      room: roomAt(floor, position),
    });
  }
  if (copies.length === 0) return { floor, ids: [] };
  // A copy of something on a table stands on the table's copy, if there is one.
  for (const copy of copies) {
    if (copy.on !== null && copyOf.has(copy.on)) copy.on = copyOf.get(copy.on)!;
  }
  // A copy of a lamp is worked by the same light: one switch, many fittings.
  const fixtures = floor.fixtures.flatMap((fixture) => {
    const copy = fixture.item !== null ? copies.find((one) => one.id === copyOf.get(fixture.item!)) : undefined;
    if (!copy) return [];
    return [
      {
        ...fixture,
        options: { ...fixture.options },
        id: makeId("x"),
        item: copy.id,
        x: copy.x,
        y: copy.y,
        room: copy.room,
      },
    ];
  });
  return {
    floor: {
      ...floor,
      items: [...floor.items, ...copies],
      fixtures: fixtures.length > 0 ? [...floor.fixtures, ...fixtures] : floor.fixtures,
    },
    ids: copies.map((copy) => copy.id),
  };
}

/** Remove items. A fixture that used one as its model is left without, and
 * whatever stood on one drops to the floor. */
export function deleteItems(floor: Floor, ids: ReadonlySet<string>): Floor {
  if (!floor.items.some((item) => ids.has(item.id))) return floor;
  return {
    ...floor,
    items: floor.items
      .filter((item) => !ids.has(item.id))
      .map((item) => (item.on !== null && ids.has(item.on) ? { ...item, on: null, z: 0 } : item)),
    fixtures: floor.fixtures.map((fixture) =>
      fixture.item !== null && ids.has(fixture.item) ? { ...fixture, item: null } : fixture,
    ),
  };
}

/** Set the room of every item from where it is. Call after walls change. */
export function assignItemRooms(floor: Floor): Floor {
  let changed = false;
  const items = floor.items.map((item) => {
    const room = roomAt(floor, item);
    if (room === item.room) return item;
    changed = true;
    return { ...item, room };
  });
  return changed ? { ...floor, items } : floor;
}

/** Where to put a model so that its back is flat against the nearest wall,
 * facing into the room the pointer is in. Undefined when no wall is within
 * reach of the pointer. */
export function snapToWall(
  floor: Pick<Floor, "vertices" | "walls">,
  pointer: Point,
  model: CatalogueModel,
  scale: number,
  tolerance: number,
): { point: Point; rotation: number } | undefined {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const depth = model.depth * scale;
  let best: { distance: number; at: Point; nx: number; ny: number; half: number } | undefined;
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b || distance(a, b) === 0) continue;
    const projected = projectOnSegment(pointer, a, b);
    if (projected.t <= 0 || projected.t >= 1 || projected.distance === 0) continue;
    const reach = wall.thickness / 2 + depth / 2 + tolerance;
    if (projected.distance > reach) continue;
    if (best && projected.distance >= best.distance) continue;
    best = {
      distance: projected.distance,
      at: projected.point,
      nx: (pointer.x - projected.point.x) / projected.distance,
      ny: (pointer.y - projected.point.y) / projected.distance,
      half: wall.thickness / 2,
    };
  }
  if (!best) return undefined;
  // Facing along the wall's normal: the front of a model at rotation r points
  // along (-sin r, cos r).
  const rotation = normaliseRotation((Math.atan2(-best.nx, best.ny) * 180) / Math.PI);
  const out = best.half + depth / 2;
  const middle = { x: best.at.x + best.nx * out, y: best.at.y + best.ny * out };
  const offset = turn(model.centre[0] * scale, model.centre[1] * scale, rotation);
  return {
    point: { x: round(middle.x - offset.x), y: round(middle.y - offset.y) },
    rotation,
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
