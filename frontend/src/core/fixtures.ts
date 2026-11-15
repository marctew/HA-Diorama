// Fixtures: the things on a floor that stand for a Home Assistant entity. A
// fixture has a place of its own, or is attached to a piece of furniture (a
// lamp that is already in the room becomes the light) and then goes where
// that goes. Like plan.ts, every function returns a new floor.

import { kindForEntity } from "./bindings";
import { findModel, type Catalogue } from "./catalogue";
import { pointInPolygon, type Point } from "./geometry";
import { newId, type MakeId } from "./ids";
import { itemFootprint, roomAt } from "./items";
import type { Fixture, FixtureKind, Floor, Item } from "./scene";

/** The model a fixture gets when it is not put on a piece of furniture. */
export const DEFAULT_MODEL: Readonly<Partial<Record<FixtureKind, string>>> = {
  light: "basics/ceiling_light",
};

/** How high a fixture with no model sits: light-switch height. */
export const MARKER_HEIGHT = 1.2;

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
    return model?.kind === kind && pointInPolygon(point, itemFootprint(item, model));
  });
}

/** Put an entity on the floor. Dropped on a suitable piece of furniture it
 * attaches to it; otherwise it gets the default model for its kind, if there
 * is one. Returns the floor unchanged if nothing can show this entity yet. */
export function placeFixture(
  floor: Floor,
  catalogue: Catalogue,
  entityId: string,
  point: Point,
  makeId: MakeId = newId,
): { floor: Floor; id?: string } {
  const kind = kindForEntity(entityId);
  if (!kind) return { floor };
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
  const scale = item?.scale ?? 1;
  const base = item?.z ?? fixture.z;
  // A pendant's shade hangs a little below the ceiling; a lamp's is at its top.
  return base + (model.hanging ? model.height - 0.5 : model.height * 0.88) * scale;
}

// Entities to offer.

/** As much of Home Assistant's registries as choosing entities needs. */
export interface Registries {
  states: Readonly<Record<string, { attributes: Record<string, unknown> }>>;
  entities?: Readonly<
    Record<string, { area_id?: string | null; device_id?: string | null; hidden?: boolean }>
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
    const kind = kindForEntity(entityId);
    if (!kind || registries.entities?.[entityId]?.hidden) continue;
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
