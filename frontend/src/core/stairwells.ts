// Stairs and the floor above them. A staircase makes a hole in the floor
// above, so that it can be seen from up there and the two floors join up.

import { findModel, type Catalogue } from "./catalogue";
import type { Point } from "./geometry";
import { itemFootprint } from "./items";
import type { Floor, FloorMeta, House, Item } from "./scene";

/** The floor directly under another: the highest of those lower than it. */
export function floorBelow(
  house: Pick<House, "floors">,
  floorId: string,
): FloorMeta | undefined {
  const meta = house.floors.find((floor) => floor.id === floorId);
  if (!meta) return undefined;
  let best: FloorMeta | undefined;
  for (const floor of house.floors) {
    if (floor.elevation >= meta.elevation) continue;
    if (!best || floor.elevation > best.elevation) best = floor;
  }
  return best;
}

/** The staircases on a floor. */
export function stairsOn(floor: Pick<Floor, "items">, catalogue: Catalogue): Item[] {
  return floor.items.filter((item) => findModel(catalogue, item.model)?.stairs === true);
}

/** The holes a floor's staircases make in the floor above: the outline of
 * each one that has not been told to leave it whole. */
export function stairHoles(floor: Pick<Floor, "items">, catalogue: Catalogue): Point[][] {
  return stairsOn(floor, catalogue)
    .filter((item) => item.cut_above !== false)
    .map((item) => itemFootprint(item, findModel(catalogue, item.model)));
}

/** What a floor shows of the one below it. */
export interface Stairwell {
  /** Where its floor is missing, as outlines on the plan. */
  holes: Point[][];
  /** The staircases coming up from below, and how far down they start. */
  below?: { items: Item[]; drop: number };
}

/** What to add to a floor on account of the floor below, once that is
 * loaded. Empty if there is no floor below, or no stairs on it. */
export function stairwell(
  house: Pick<House, "floors">,
  floorId: string,
  loaded: ReadonlyMap<string, Floor>,
  catalogue: Catalogue | undefined,
): Stairwell {
  const meta = house.floors.find((floor) => floor.id === floorId);
  const under = floorBelow(house, floorId);
  const floor = under && loaded.get(under.id);
  if (!meta || !under || !floor || !catalogue) return { holes: [] };
  const items = stairsOn(floor, catalogue);
  if (items.length === 0) return { holes: [] };
  return {
    holes: stairHoles(floor, catalogue),
    below: { items, drop: Number((meta.elevation - under.elevation).toFixed(4)) },
  };
}
