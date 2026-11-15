// Standing things on furniture: a lamp on a table, a microwave on a worktop.
// A piece that stands on another has `on` set to it, sits at the height of
// its top, and goes where it goes (see updateItems). Like plan.ts, every
// function returns a new floor.

import { findModel, isOwnModel, type Catalogue, type CatalogueModel } from "./catalogue";
import { pointInPolygon, type Point } from "./geometry";
import { itemFootprint, itemScale } from "./items";
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

/** Stand these pieces on whatever they are now over, or take them off what
 * they were on. Call when they have been placed or dropped. A piece that is
 * not the sort to be stood on things is left alone. */
export function restack(floor: Floor, catalogue: Catalogue, ids: ReadonlySet<string>): Floor {
  let changed = false;
  const items = floor.items.map((item) => {
    if (!ids.has(item.id) || !standsOnThings(findModel(catalogue, item.model))) return item;
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
    const z = surfaceTop(support, model);
    if (z === item.z) return item;
    changed = true;
    return { ...item, z };
  });
  return changed ? { ...floor, items } : floor;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
