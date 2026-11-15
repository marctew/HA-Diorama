// Fixtures: the things on a floor that stand for a Home Assistant entity. A
// fixture has a place of its own, or is attached to a piece of furniture (a
// lamp that is already in the room becomes the light) and then goes where
// that goes. Like plan.ts, every function returns a new floor.

import { kindForEntity } from "./bindings";
import { findModel, type Catalogue, type CatalogueModel } from "./catalogue";
import { interiorPoint, pointInPolygon, type Point } from "./geometry";
import { newId, type MakeId } from "./ids";
import { itemFootprint, itemScale, pickFootprint, roomAt } from "./items";
import type { Fixture, FixtureKind, Floor, Item } from "./scene";

/** The model a fixture gets when it is not put on a piece of furniture. */
export const DEFAULT_MODEL: Readonly<Partial<Record<FixtureKind, string>>> = {
  light: "basics/ceiling_light",
};

/** How high a fixture with no model sits: light-switch height. */
export const MARKER_HEIGHT = 1.2;

/** Whether a model can stand for a fixture of a kind: a lamp for a light.
 * Anything with a screen can also be a switch (the plug it is on) or a light. */
export function canBe(model: CatalogueModel, kind: FixtureKind): boolean {
  if (model.kind === kind) return true;
  return (model.screens?.length ?? 0) > 0 && (kind === "switch" || kind === "media" || kind === "light");
}

/** The piece of furniture under a point that can stand for a fixture of this
 * kind (a lamp for a light), if it is not already taken. */
export function itemToBind(
  floor: Floor,
  catalogue: Catalogue,
  kind: FixtureKind,
  point: Point,
): Item | undefined {
  const taken = new Set(floor.fixtures.map((fixture) => fixture.item));
  return floor.items.find((item) => {
    if (taken.has(item.id)) return false;
    const model = findModel(catalogue, item.model);
    return (
      model !== undefined &&
      canBe(model, kind) &&
      pointInPolygon(point, pickFootprint(item, model))
    );
  });
}

/** Put an entity on the floor as a fixture of a kind. Dropped on a suitable
 * piece of furniture it attaches to it; otherwise it gets the default model
 * for its kind, if there is one. */
export function placeFixture(
  floor: Floor,
  catalogue: Catalogue,
  entityId: string,
  kind: FixtureKind,
  point: Point,
  makeId: MakeId = newId,
): { floor: Floor; id: string } {
  const id = makeId("x");
  const onItem = itemToBind(floor, catalogue, kind, point);
  const at = onItem ? { x: onItem.x, y: onItem.y } : { x: round(point.x), y: round(point.y) };
  const model = onItem ? null : (DEFAULT_MODEL[kind] ?? null);
  const fixture: Fixture = {
    id,
    entity_id: entityId,
    kind,
    ...at,
    z: onItem || model ? 0 : MARKER_HEIGHT,
    room: roomAt(floor, at),
    item: onItem?.id ?? null,
    model: model && findModel(catalogue, model) ? model : null,
    options: {},
  };
  if (!onItem && !fixture.model) fixture.z = MARKER_HEIGHT;
  return { floor: { ...floor, fixtures: [...floor.fixtures, fixture] }, id };
}

/** Change fixtures. Their room follows where they end up. */
export function updateFixtures(
  floor: Floor,
  ids: ReadonlySet<string>,
  change: (fixture: Fixture) => Partial<Fixture>,
): Floor {
  let changed = false;
  const fixtures = floor.fixtures.map((fixture) => {
    if (!ids.has(fixture.id)) return fixture;
    const next = { ...fixture, ...change(fixture) };
    next.x = round(next.x);
    next.y = round(next.y);
    next.room = roomAt(floor, next);
    const same = (Object.keys(next) as (keyof Fixture)[]).every((key) => next[key] === fixture[key]);
    if (same) return fixture;
    changed = true;
    return next;
  });
  return changed ? { ...floor, fixtures } : floor;
}

/** Move fixtures. One that was attached to furniture comes off it. */
export function moveFixtures(floor: Floor, positions: ReadonlyMap<string, Point>): Floor {
  return updateFixtures(floor, new Set(positions.keys()), (fixture) => ({
    ...positions.get(fixture.id)!,
    item: null,
    z: fixture.item !== null && !fixture.model ? MARKER_HEIGHT : fixture.z,
  }));
}

export function deleteFixtures(floor: Floor, ids: ReadonlySet<string>): Floor {
  if (!floor.fixtures.some((fixture) => ids.has(fixture.id))) return floor;
  return { ...floor, fixtures: floor.fixtures.filter((fixture) => !ids.has(fixture.id)) };
}

/** Bring every fixture into line with the floor: one attached to furniture
 * sits where the furniture is, and each knows the room it is in. Call after
 * furniture or walls change. */
export function syncFixtures(floor: Floor): Floor {
  if (floor.fixtures.length === 0) return floor;
  const items = new Map(floor.items.map((item) => [item.id, item]));
  let changed = false;
  const fixtures = floor.fixtures.map((fixture) => {
    const item = fixture.item !== null ? items.get(fixture.item) : undefined;
    const x = item ? item.x : fixture.x;
    const y = item ? item.y : fixture.y;
    const attached = fixture.item !== null && item ? fixture.item : null;
    const room = roomAt(floor, { x, y });
    if (x === fixture.x && y === fixture.y && attached === fixture.item && room === fixture.room) {
      return fixture;
    }
    changed = true;
    return { ...fixture, x, y, item: attached, room };
  });
  return changed ? { ...floor, fixtures } : floor;
}

/** Where a fixture's light or marker is, in metres above the floor. */
export function fixtureHeight(
  fixture: Fixture,
  floor: Pick<Floor, "items">,
  catalogue: Catalogue,
): number {
  const item = fixture.item !== null ? floor.items.find((i) => i.id === fixture.item) : undefined;
  const modelId = item?.model ?? fixture.model;
  const model = modelId ? findModel(catalogue, modelId) : undefined;
  if (!model) return fixture.z > 0 ? fixture.z : MARKER_HEIGHT;
  const scale = item ? itemScale(item)[1] : 1;
  const base = item?.z ?? fixture.z;
  // Where the model says; else a pendant's shade hangs a little below the
  // ceiling, and a lamp's is at its top.
  if (model.light_height !== undefined) return base + model.light_height * scale;
  return base + (model.hanging ? model.height - 0.5 : model.height * 0.88) * scale;
}

// Entities to offer.

/** As much of Home Assistant's registries as choosing entities needs. */
export interface Registries {
  states: Readonly<Record<string, { attributes: Record<string, unknown> }>>;
  entities?: Readonly<
    Record<
      string,
      {
        area_id?: string | null;
        device_id?: string | null;
        hidden?: boolean;
        entity_category?: string | null;
      }
    >
  >;
  devices?: Readonly<Record<string, { area_id?: string | null }>>;
}

export interface EntityChoice {
  entity_id: string;
  name: string;
  kind: FixtureKind;
  area_id: string | null;
}

/** The area an entity is in: its own, or else its device's. */
export function entityArea(registries: Registries, entityId: string): string | null {
  const entry = registries.entities?.[entityId];
  if (entry?.area_id) return entry.area_id;
  const device = entry?.device_id ? registries.devices?.[entry.device_id] : undefined;
  return device?.area_id ?? null;
}

/** Every entity that can be put on a floor today, by name. */
export function bindableEntities(registries: Registries): EntityChoice[] {
  const choices: EntityChoice[] = [];
  for (const [entityId, state] of Object.entries(registries.states)) {
    const kind = kindForEntity(entityId, state.attributes);
    const entry = registries.entities?.[entityId];
    // Not the hidden ones, nor a device's diagnostics and settings: signal
    // strength and firmware versions are not furniture.
    if (!kind || entry?.hidden || entry?.entity_category) continue;
    const friendly = state.attributes.friendly_name;
    choices.push({
      entity_id: entityId,
      name: typeof friendly === "string" && friendly ? friendly : entityId,
      kind,
      area_id: entityArea(registries, entityId),
    });
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name) || a.entity_id.localeCompare(b.entity_id));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

/** The entity of a door or window as a fixture, so that it is shown, kept up
 * to date and tapped like any other. It sits in the middle of its opening.
 * Its id starts with "opening:" and is not stored. */
export function openingFixtures(
  floor: Pick<Floor, "vertices" | "walls" | "openings">,
  kindOf: (entityId: string) => FixtureKind | undefined,
): Fixture[] {
  const fixtures: Fixture[] = [];
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  for (const opening of floor.openings) {
    if (!opening.entity_id) continue;
    const wall = floor.walls.find((candidate) => candidate.id === opening.wall);
    const a = wall && position.get(wall.a);
    const b = wall && position.get(wall.b);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const along = (opening.offset + opening.width / 2) / length;
    // A cover on a window is a blind; anything else reports open or shut.
    const kind = kindOf(opening.entity_id) === "cover" ? "cover" : "opening";
    fixtures.push({
      id: openingFixtureId(opening.id),
      entity_id: opening.entity_id,
      kind,
      x: round(a.x + (b.x - a.x) * along),
      y: round(a.y + (b.y - a.y) * along),
      z: round(opening.sill + opening.height / 2),
      room: null,
      item: null,
      model: null,
      options: {},
    });
  }
  return fixtures;
}

export function openingFixtureId(openingId: string): string {
  return `opening:${openingId}`;
}

/** Whether a fixture stands for a door or window rather than being stored. */
export function isOpeningFixture(fixture: Pick<Fixture, "id">): boolean {
  return fixture.id.startsWith("opening:");
}

/** Everything on a floor that stands for an entity: the fixtures placed on
 * it, and the doors and windows that have one. */
export function allFixtures(
  floor: Pick<Floor, "vertices" | "walls" | "openings" | "fixtures" | "rooms">,
): Fixture[] {
  const extra = [...openingFixtures(floor, kindForEntity), ...roomFixtures(floor)];
  return extra.length === 0 ? floor.fixtures : [...floor.fixtures, ...extra];
}

/** The temperature of a room as a fixture, so that it is kept up to date and
 * tapped like any other. It lies on the floor in the middle of the room. Its
 * id starts with "room:" and is not stored. */
export function roomFixtures(floor: Pick<Floor, "vertices" | "rooms">): Fixture[] {
  const fixtures: Fixture[] = [];
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  for (const room of floor.rooms) {
    if (!room.temperature_entity) continue;
    const outline = room.boundary
      .map((id) => position.get(id))
      .filter((point) => point !== undefined);
    if (outline.length < 3) continue;
    const middle = interiorPoint(outline);
    fixtures.push({
      id: `room:${room.id}`,
      entity_id: room.temperature_entity,
      kind: "climate",
      x: round(middle.x),
      y: round(middle.y),
      z: 0,
      room: room.id,
      item: null,
      model: null,
      options: {},
    });
  }
  return fixtures;
}

/** Whether a fixture stands for the temperature of a room. */
export function isRoomFixture(fixture: Pick<Fixture, "id">): boolean {
  return fixture.id.startsWith("room:");
}

/** The most fittings a room is filled with at once. */
export const MAX_FILL = 60;

/** Fill a fixture's room with copies of it, in evenly spaced rows and
 * columns: downlights in a ceiling. The fixture itself becomes the first of
 * them, and any others like it in the room (same entity, same model) are
 * replaced. Spots that fall outside the room, in an L-shaped one, are left
 * out. Returns the floor unchanged if the fixture is in no room. */
export function fillRoom(
  floor: Floor,
  fixtureId: string,
  rows: number,
  columns: number,
  makeId: MakeId = newId,
): { floor: Floor; ids: string[] } {
  const fixture = floor.fixtures.find((candidate) => candidate.id === fixtureId);
  const room = fixture && floor.rooms.find((candidate) => candidate.id === fixture.room);
  const count = Math.floor(rows) * Math.floor(columns);
  if (!fixture || !room || fixture.item !== null || !(count >= 1) || count > MAX_FILL) {
    return { floor, ids: [] };
  }
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const outline = room.boundary.map((id) => position.get(id)).filter((point) => point !== undefined);
  if (outline.length < 3) return { floor, ids: [] };
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const [width, depth] = [Math.max(...xs) - left, Math.max(...ys) - top];
  const spots: Point[] = [];
  for (let row = 0; row < Math.floor(rows); row++) {
    for (let column = 0; column < Math.floor(columns); column++) {
      const spot = {
        x: round(left + (width * (column + 0.5)) / Math.floor(columns)),
        y: round(top + (depth * (row + 0.5)) / Math.floor(rows)),
      };
      if (pointInPolygon(spot, outline)) spots.push(spot);
    }
  }
  if (spots.length === 0) return { floor, ids: [] };
  const alike = (other: Fixture) =>
    other.entity_id === fixture.entity_id &&
    other.model === fixture.model &&
    other.item === null &&
    other.room === fixture.room;
  const made: Fixture[] = spots.map((spot, index) => ({
    ...fixture,
    options: { ...fixture.options },
    ...spot,
    id: index === 0 ? fixture.id : makeId("x"),
  }));
  return {
    floor: { ...floor, fixtures: [...floor.fixtures.filter((other) => !alike(other)), ...made] },
    ids: made.map((one) => one.id),
  };
}

/** How many fixtures in the same room share each fixture's entity: eight
 * downlights on one switch light a room once, not eight times over. */
export function fittingsSharing(fixtures: readonly Fixture[]): Map<string, number> {
  const groups = new Map<string, number>();
  const key = (fixture: Fixture) => `${fixture.entity_id}|${fixture.room ?? ""}`;
  for (const fixture of fixtures) groups.set(key(fixture), (groups.get(key(fixture)) ?? 0) + 1);
  return new Map(fixtures.map((fixture) => [fixture.id, groups.get(key(fixture)) ?? 1]));
}

/** A strip of light as the 3D view draws it. */
export interface StripLight {
  /** Its middle on the plan, and how far off the floor it is. */
  x: number;
  y: number;
  z: number;
  length: number;
  /** Degrees, as for furniture. */
  rotation: number;
  /** The height of whatever it shines down on: a worktop, a shelf, the floor. */
  below: number;
}

/** The strip a fixture is, if it is bound to a strip of light. */
export function stripLight(
  fixture: Pick<Fixture, "item">,
  floor: Pick<Floor, "items">,
  catalogue: Catalogue,
): StripLight | undefined {
  const item = fixture.item !== null ? floor.items.find((i) => i.id === fixture.item) : undefined;
  const model = item && findModel(catalogue, item.model);
  if (!item || !model?.strip) return undefined;
  const corners = itemFootprint(item, model);
  const middle = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
  let below = 0;
  for (const other of floor.items) {
    if (other.id === item.id || other.id === item.on) continue;
    const otherModel = findModel(catalogue, other.model);
    if (!otherModel || otherModel.strip) continue;
    const top = other.z + otherModel.height * itemScale(other)[1];
    if (top > below && top < item.z - 0.05 && pointInPolygon(middle, itemFootprint(other, otherModel))) {
      below = top;
    }
  }
  return {
    ...middle,
    z: item.z,
    length: model.width * itemScale(item)[0],
    rotation: item.rotation,
    below: round(below),
  };
}

/** The emptiest spot of a room's floor, to write its temperature on: as far
 * as can be from its walls and from the furniture standing in it. Things up
 * on a wall or the ceiling are not in the way. */
export function clearSpot(
  floor: Pick<Floor, "vertices" | "items">,
  room: Pick<Floor["rooms"][number], "boundary">,
  catalogue: Catalogue | undefined,
): { point: Point; clearance: number } | undefined {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const outline = room.boundary.map((id) => position.get(id)).filter((point) => point !== undefined);
  if (outline.length < 3) return undefined;
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const [width, depth] = [Math.max(...xs) - left, Math.max(...ys) - top];
  // Each piece on the floor, as a circle round its outline.
  const inTheWay = floor.items.flatMap((item) => {
    const model = catalogue ? findModel(catalogue, item.model) : undefined;
    if (item.z > 0.4 || model?.hanging || (model && model.height < 0.05)) return [];
    const corners = itemFootprint(item, model);
    const middle = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
    return [{ middle, reach: Math.hypot(corners[0].x - middle.x, corners[0].y - middle.y) }];
  });
  const STEPS = 14;
  let best: { point: Point; clearance: number } | undefined;
  for (let row = 0; row < STEPS; row++) {
    for (let column = 0; column < STEPS; column++) {
      const point = {
        x: left + (width * (column + 0.5)) / STEPS,
        y: top + (depth * (row + 0.5)) / STEPS,
      };
      if (!pointInPolygon(point, outline)) continue;
      let clearance = Infinity;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const t = Math.min(1, Math.max(0, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2));
        clearance = Math.min(clearance, Math.hypot(point.x - a.x - (b.x - a.x) * t, point.y - a.y - (b.y - a.y) * t));
      }
      for (const { middle, reach } of inTheWay) {
        clearance = Math.min(clearance, Math.hypot(point.x - middle.x, point.y - middle.y) - reach);
      }
      if (!best || clearance > best.clearance + 1e-9) best = { point, clearance };
    }
  }
  return best && { point: { x: round(best.point.x), y: round(best.point.y) }, clearance: round(best.clearance) };
}
