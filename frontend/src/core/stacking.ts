// Standing things on furniture: a lamp on a table, a microwave on a worktop.
// A piece that stands on another has `on` set to it, sits at the height of
// its top, and goes where it goes (see updateItems). Like plan.ts, every
// function returns a new floor.

import { findModel, isOwnModel, type Catalogue, type CatalogueModel } from "./catalogue";
import { pointInPolygon, type Point } from "./geometry";
import { itemFootprint, itemScale, itemSize } from "./items";
import type { Floor, Item } from "./scene";

/** Whether a model is the sort of thing that is stood on furniture. The
 * catalogue says so for its own; a model someone added counts if it is small. */
export function standsOnThings(model: CatalogueModel | undefined): boolean {
  if (!model) return false;
  if (model.tabletop !== undefined) return model.tabletop;
  return isOwnModel(model) && Math.max(model.width, model.depth) <= 0.8 && model.height <= 0.9;
}

/** How high the top of a piece is that things can be stood on. */
export function surfaceTop(item: Item, model: CatalogueModel): number {
  return round(item.z + (model.surface_height ?? model.height) * itemScale(item)[1]);
}

/** The piece under a point that something could be stood on: the highest
 * surface there, leaving out `except` and anything that is itself stood on
 * something. */
export function supportAt(
  floor: Pick<Floor, "items">,
  catalogue: Catalogue,
  point: Point,
  except: ReadonlySet<string> = new Set(),
): Item | undefined {
  let best: { item: Item; top: number } | undefined;
  for (const item of floor.items) {
    if (except.has(item.id) || item.on !== null) continue;
    const model = findModel(catalogue, item.model);
    if (!model?.surface || !pointInPolygon(point, itemFootprint(item, model))) continue;
    const top = surfaceTop(item, model);
    if (!best || top > best.top) best = { item, top };
  }
  return best?.item;
}

/** The wall-mounted piece over a point that a strip of light can go under:
 * a kitchen wall unit, a bathroom cabinet. */
export function unitOver(
  floor: Pick<Floor, "items">,
  catalogue: Catalogue,
  point: Point,
  except: ReadonlySet<string> = new Set(),
): Item | undefined {
  return floor.items.find((item) => {
    if (except.has(item.id) || item.on !== null) return false;
    const model = findModel(catalogue, item.model);
    return (
      model?.mount_height !== undefined &&
      !model.strip &&
      pointInPolygon(point, itemFootprint(item, model))
    );
  });
}

/** A strip of light fixed under a wall unit: along its middle, as long as it
 * is wide, turned the same way, just under its bottom. */
function under(strip: Item, model: CatalogueModel, unit: Item, unitModel: CatalogueModel): Item {
  const corners = itemFootprint(unit, unitModel);
  const size = itemSize(unit, unitModel);
  const stretch: [number, number, number] = [...strip.stretch];
  stretch[0] = round(size.width / (model.width * strip.scale));
  return {
    ...strip,
    on: unit.id,
    x: round((corners[0].x + corners[2].x) / 2),
    y: round((corners[0].y + corners[2].y) / 2),
    z: round(unit.z - model.height * itemScale(strip)[1]),
    rotation: unit.rotation,
    stretch,
  };
}

/** Stand these pieces on whatever they are now over, or take them off what
 * they were on. Call when they have been placed or dropped. A piece that is
 * not the sort to be stood on things is left alone. */
export function restack(floor: Floor, catalogue: Catalogue, ids: ReadonlySet<string>): Floor {
  let changed = false;
  const items = floor.items.map((item) => {
    const model = findModel(catalogue, item.model);
    if (ids.has(item.id) && model?.strip) {
      // A strip of light goes under a wall unit it is dropped on. Dragged
      // off one it stays at the height it had: under a shelf, behind a TV.
      const unit = unitOver(floor, catalogue, item, ids);
      const unitModel = unit && findModel(catalogue, unit.model);
      if (unit && unitModel) {
        changed = true;
        return under(item, model, unit, unitModel);
      }
      if (item.on === null) return item;
      changed = true;
      return { ...item, on: null };
    }
    if (!ids.has(item.id) || !standsOnThings(model)) return item;
    // Not onto something that is moving with it.
    const on = supportAt(floor, catalogue, item, ids)?.id ?? null;
    if (on === item.on) return item;
    changed = true;
    // Off a table, it goes back to the floor.
    return on === null ? { ...item, on, z: 0 } : { ...item, on };
  });
  return settleStacks(changed ? { ...floor, items } : floor, catalogue);
}

/** Put everything that stands on something at the height of its top, and let
 * go of anything whose support has gone. Cheap when nothing needs changing. */
export function settleStacks(floor: Floor, catalogue: Catalogue): Floor {
  if (!floor.items.some((item) => item.on !== null)) return floor;
  const byId = new Map(floor.items.map((item) => [item.id, item]));
  let changed = false;
  const items = floor.items.map((item) => {
    if (item.on === null) return item;
    const support = byId.get(item.on);
    const model = support && findModel(catalogue, support.model);
    // The catalogue may simply not have loaded yet: only let go when the
    // piece itself has gone.
    if (!support || support.on !== null) {
      changed = true;
      return { ...item, on: null, z: 0 };
    }
    if (!model) return item;
    const own = findModel(catalogue, item.model);
    // A strip hangs under what it is fixed to; anything else stands on top.
    const z = own?.strip
      ? round(support.z - own.height * itemScale(item)[1])
      : surfaceTop(support, model);
    if (z === item.z) return item;
    changed = true;
    return { ...item, z };
  });
  return changed ? { ...floor, items } : floor;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
