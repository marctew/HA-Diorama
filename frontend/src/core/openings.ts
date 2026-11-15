// Doors and windows. An opening sits on a wall, `offset` metres along it from
// the wall's first end, and is `width` wide; `sill` is how far its bottom is
// above the floor. Like plan.ts, every function returns a new floor.

import { distance, projectOnSegment, type Point } from "./geometry";
import { newId, type MakeId } from "./ids";
import type { Floor, Opening } from "./scene";

export type OpeningType = Opening["type"];

export const OPENING_DEFAULTS: Readonly<
  Record<OpeningType, { width: number; height: number; sill: number }>
> = {
  door: { width: 0.8, height: 2.0, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  archway: { width: 0.9, height: 2.0, sill: 0 },
};

/** The step a dragged end of an opening moves in, in metres. */
export const OPENING_STEP = 0.05;

/** The narrowest opening worth having, and the least wall to leave either side. */
const MIN_WIDTH = 0.3;

interface WallLine {
  a: Point;
  b: Point;
  length: number;
}

function wallLine(floor: Pick<Floor, "vertices" | "walls">, wallId: string): WallLine | undefined {
  const wall = floor.walls.find((candidate) => candidate.id === wallId);
  const a = wall && floor.vertices.find((vertex) => vertex.id === wall.a);
  const b = wall && floor.vertices.find((vertex) => vertex.id === wall.b);
  if (!a || !b) return undefined;
  const length = distance(a, b);
  return length > 0 ? { a, b, length } : undefined;
}

/** Where along a wall an opening of a given width goes so that its middle is
 * as near `point` as the wall allows. */
function offsetFor(line: WallLine, width: number, point: Point): number {
  const along = projectOnSegment(point, line.a, line.b).t * line.length;
  return round(Math.min(Math.max(along - width / 2, 0), line.length - width));
}

/** The wall nearest a point, if one is within `tolerance` of it. */
export function nearestWall(
  floor: Pick<Floor, "vertices" | "walls">,
  point: Point,
  tolerance: number,
): string | undefined {
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  let best: { id: string; distance: number } | undefined;
  for (const wall of floor.walls) {
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b) continue;
    const d = projectOnSegment(point, a, b).distance;
    if (d <= Math.max(tolerance, wall.thickness / 2) && (!best || d < best.distance)) {
      best = { id: wall.id, distance: d };
    }
  }
  return best?.id;
}

/** What a new opening on a wall would be, without adding it: for the preview
 * and for adding. Undefined if the wall is too short to take one. */
export function openingAt(
  floor: Pick<Floor, "vertices" | "walls">,
  wallId: string,
  type: OpeningType,
  point: Point,
): Omit<Opening, "id"> | undefined {
  const line = wallLine(floor, wallId);
  if (!line) return undefined;
  const defaults = OPENING_DEFAULTS[type];
  const width = Math.min(defaults.width, round(line.length - 0.1));
  if (width < MIN_WIDTH) return undefined;
  return {
    wall: wallId,
    type,
    offset: offsetFor(line, width, point),
    width,
    height: defaults.height,
    sill: defaults.sill,
    entity_id: null,
    leaves: 1,
    hinge: "start",
    swing: 1,
    style: "hinged",
    glazed: false,
    closed: null,
  };
}

export function placeOpening(
  floor: Floor,
  wallId: string,
  type: OpeningType,
  point: Point,
  makeId: MakeId = newId,
): { floor: Floor; id?: string } {
  const opening = openingAt(floor, wallId, type, point);
  if (!opening) return { floor };
  const id = makeId("o");
  return { floor: { ...floor, openings: [...floor.openings, { ...opening, id }] }, id };
}

/** Slide an opening so that its middle is near `point`, on its own wall or on
 * another. It is narrowed if the new wall is shorter than it. */
export function moveOpening(floor: Floor, id: string, wallId: string, point: Point): Floor {
  const line = wallLine(floor, wallId);
  if (!line) return floor;
  return change(floor, id, (opening) => {
    const width = Math.min(opening.width, round(line.length));
    if (width < MIN_WIDTH) return opening;
    return { ...opening, wall: wallId, width, offset: offsetFor(line, width, point) };
  });
}

/** Change an opening's size, place or type, kept within its wall. */
export function updateOpening(floor: Floor, id: string, patch: Partial<Opening>): Floor {
  return change(floor, id, (opening) => {
    const next = { ...opening, ...patch, id: opening.id };
    const line = wallLine(floor, next.wall);
    if (!line) return opening;
    const reachesFloor = (type: OpeningType) => type !== "window";
    if (patch.type && reachesFloor(patch.type) !== reachesFloor(opening.type)) {
      // A door reaches the floor; a new window starts at sill height.
      next.sill = patch.sill ?? OPENING_DEFAULTS[patch.type].sill;
      next.height = patch.height ?? OPENING_DEFAULTS[patch.type].height;
    }
    next.width = round(Math.min(Math.max(next.width, MIN_WIDTH), line.length));
    next.offset = round(Math.min(Math.max(next.offset, 0), line.length - next.width));
    next.height = round(Math.min(Math.max(next.height, 0.1), 6));
    next.sill = round(Math.min(Math.max(next.sill, 0), 6));
    return next;
  });
}

/** Drag one end of an opening to a point along its wall: that end follows,
 * the other stays where it is. `step` rounds where it lands, in metres. */
export function resizeOpening(
  floor: Floor,
  id: string,
  end: "start" | "end",
  point: Point,
  step = OPENING_STEP,
): Floor {
  return change(floor, id, (opening) => {
    const line = wallLine(floor, opening.wall);
    if (!line) return opening;
    let along = projectOnSegment(point, line.a, line.b).t * line.length;
    if (step > 0) along = Math.round(along / step) * step;
    const far = opening.offset + opening.width;
    if (end === "end") {
      const to = Math.min(Math.max(along, opening.offset + MIN_WIDTH), line.length);
      return { ...opening, width: round(to - opening.offset) };
    }
    const from = Math.min(Math.max(along, 0), far - MIN_WIDTH);
    return { ...opening, offset: round(from), width: round(far - from) };
  });
}

export function deleteOpenings(floor: Floor, ids: ReadonlySet<string>): Floor {
  if (!floor.openings.some((opening) => ids.has(opening.id))) return floor;
  return { ...floor, openings: floor.openings.filter((opening) => !ids.has(opening.id)) };
}

/** Keep every opening within its wall after walls have changed: slid back or
 * narrowed if the wall got shorter, removed if it is now too short for one. */
export function fitOpenings(floor: Floor): Floor {
  let changed = false;
  const openings: Opening[] = [];
  for (const opening of floor.openings) {
    const line = wallLine(floor, opening.wall);
    if (!line || line.length < MIN_WIDTH) {
      changed = true;
      continue;
    }
    const width = round(Math.min(opening.width, line.length));
    const offset = round(Math.min(Math.max(opening.offset, 0), line.length - width));
    if (width === opening.width && offset === opening.offset) {
      openings.push(opening);
    } else {
      changed = true;
      openings.push({ ...opening, width, offset });
    }
  }
  return changed ? { ...floor, openings } : floor;
}

/** The two ends of an opening on the plan, along the middle of its wall. */
export function openingEnds(
  floor: Pick<Floor, "vertices" | "walls">,
  opening: Pick<Opening, "wall" | "offset" | "width">,
): { start: Point; end: Point; thickness: number } | undefined {
  const line = wallLine(floor, opening.wall);
  const wall = floor.walls.find((candidate) => candidate.id === opening.wall);
  if (!line || !wall) return undefined;
  const at = (along: number): Point => ({
    x: line.a.x + ((line.b.x - line.a.x) * along) / line.length,
    y: line.a.y + ((line.b.y - line.a.y) * along) / line.length,
  });
  return {
    start: at(opening.offset),
    end: at(opening.offset + opening.width),
    thickness: wall.thickness,
  };
}

/** How far open a door stands when no sensor says: 1 for open, 0 for shut.
 * Unless it has been said, a swinging door stands open, so that the rooms
 * join up, and a sliding one shut, as glass hides nothing. */
export function doorRest(opening: Pick<Opening, "closed"> & { style?: Opening["style"] }): 0 | 1 {
  const shut = opening.closed ?? opening.style === "sliding";
  return shut ? 0 : 1;
}

/** One leaf of a door: where along the wall it is hinged, how wide it is,
 * and whether it reaches towards the wall's far end (1) or its start (-1)
 * when shut. */
export interface DoorLeaf {
  hinge: number;
  width: number;
  towards: 1 | -1;
}

/** The leaves of a door: one, hung from either end, or two meeting in the
 * middle. Anything that is not a door has none. */
export function doorLeaves(
  opening: Pick<Opening, "type" | "offset" | "width" | "leaves" | "hinge"> & {
    style?: Opening["style"];
  },
): DoorLeaf[] {
  if (opening.type !== "door" || opening.style === "sliding") return [];
  const far = opening.offset + opening.width;
  if (opening.leaves === 2) {
    return [
      { hinge: opening.offset, width: opening.width / 2, towards: 1 },
      { hinge: far, width: opening.width / 2, towards: -1 },
    ];
  }
  return opening.hinge === "end"
    ? [{ hinge: far, width: opening.width, towards: -1 }]
    : [{ hinge: opening.offset, width: opening.width, towards: 1 }];
}

/** One panel of a sliding door: where along the wall it starts when the door
 * is shut, how wide it is, how far it slides to open (negative is towards
 * the wall's start), and which of the two tracks it runs in. */
export interface SlidingPanel {
  from: number;
  width: number;
  travel: number;
  track: 1 | -1;
}

/** How much one panel of a sliding door laps over the other. */
const PANEL_LAP = 0.04;

/** The two panels of a sliding door. One stays where it is; the other slides
 * across in front of it. `hinge` says which end the fixed one is at. */
export function slidingPanels(
  opening: Pick<Opening, "type" | "offset" | "width" | "hinge" | "style">,
): SlidingPanel[] {
  if (opening.type !== "door" || opening.style !== "sliding") return [];
  const width = opening.width / 2 + PANEL_LAP / 2;
  const far = opening.offset + opening.width;
  const travel = opening.width - width;
  return opening.hinge === "end"
    ? [
        { from: far - width, width, travel: 0, track: 1 },
        { from: opening.offset, width, travel, track: -1 },
      ]
    : [
        { from: opening.offset, width, travel: 0, track: 1 },
        { from: far - width, width, travel: -travel, track: -1 },
      ];
}

function change(floor: Floor, id: string, edit: (opening: Opening) => Opening): Floor {
  let changed = false;
  const openings = floor.openings.map((opening) => {
    if (opening.id !== id) return opening;
    const next = edit(opening);
    const same = (Object.keys(next) as (keyof Opening)[]).every((key) => next[key] === opening[key]);
    if (same) return opening;
    changed = true;
    return next;
  });
  return changed ? { ...floor, openings } : floor;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
