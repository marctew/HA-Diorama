// What a view shows: the whole house, one floor, or one room. Works out which
// floors are needed and cuts a floor down to a single room.

import type { Catalogue } from "./catalogue";
import { pointInPolygon, type Point } from "./geometry";
import { roomPolygon } from "./rooms";
import type { Camera, Floor, House, Item } from "./scene";
import { floorBelow, stairHoles, stairwell, type Stairwell } from "./stairwells";

export type ViewKind = "house" | "floor" | "room";

export interface ViewRequest {
  view: ViewKind;
  floor?: string;
  room?: string;
  /** Extra space between the floors of the house view, in metres, so that the
   * lower ones can be seen into. */
  floor_gap?: number;
}

export interface ViewFloor {
  floor: Floor;
  /** Height of this floor's ground above the lowest thing shown, in metres. */
  elevation: number;
  /** Where its floor is left out, for the stairs coming up from below. */
  holes?: Point[][];
  /** Staircases of the floor below, to draw coming up through the holes when
   * that floor is not itself shown, and how far down they start. */
  below?: { items: Item[]; drop: number };
}

export type ViewResult =
  | { status: "ready"; floors: ViewFloor[]; title: string }
  /** Floors still have to be fetched before the view can be worked out. */
  | { status: "loading" }
  | { status: "empty" }
  | { status: "missing"; what: "floor" | "room" };

/** The ids of the floors a view is of, as far as can be told. A room view
 * that does not say which floor its room is on may be of any. */
function floorsShown(house: House, request: ViewRequest): string[] {
  const all = house.floors.map((floor) => floor.id);
  if (request.view === "house") return all;
  if (request.floor) return all.includes(request.floor) ? [request.floor] : [];
  return request.view === "room" ? all : [];
}

/** The ids of the floors a view needs loaded: those it shows, and the one
 * under a single floor, whose stairs come up through it. */
export function floorsNeeded(house: House, request: ViewRequest): string[] {
  const shown = floorsShown(house, request);
  if (request.view === "house" || !request.floor || shown.length === 0) return shown;
  const under = floorBelow(house, request.floor);
  return under ? [...shown, under.id] : shown;
}

/** Work out what to show from what has been loaded so far. */
export function resolveView(
  house: House,
  loaded: ReadonlyMap<string, Floor>,
  request: ViewRequest,
  /** Says which furniture is stairs. Without it no floor has holes. */
  catalogue?: Catalogue,
): ViewResult {
  if (house.floors.length === 0) return { status: "empty" };
  const needed = floorsShown(house, request);

  if (request.view === "house") {
    if (!needed.every((id) => loaded.has(id))) return { status: "loading" };
    const lowest = Math.min(...house.floors.map((floor) => floor.elevation));
    // Spread apart from the bottom up: the nth floor from the ground rises by
    // n gaps.
    const gap = Math.max(0, request.floor_gap ?? 0);
    const rank = new Map(
      [...house.floors]
        .sort((a, b) => a.elevation - b.elevation)
        .map((meta, index) => [meta.id, index]),
    );
    return {
      status: "ready",
      title: house.settings.name,
      floors: house.floors.map((meta) => {
        const under = floorBelow(house, meta.id);
        const below = under && loaded.get(under.id);
        return {
          floor: loaded.get(meta.id)!,
          elevation: Number((meta.elevation - lowest + gap * rank.get(meta.id)!).toFixed(4)),
          // The stairs themselves are drawn with their own floor.
          ...(below && catalogue ? { holes: stairHoles(below, catalogue) } : {}),
        };
      }),
    };
  }

  if (request.view === "floor") {
    const meta = house.floors.find((floor) => floor.id === request.floor);
    if (!meta) return { status: "missing", what: "floor" };
    const floor = loaded.get(meta.id);
    if (!floor) return { status: "loading" };
    return {
      status: "ready",
      title: meta.name,
      floors: [{ floor, elevation: 0, ...cut(stairwell(house, meta.id, loaded, catalogue)) }],
    };
  }

  if (request.floor && needed.length === 0) return { status: "missing", what: "room" };
  for (const id of needed) {
    const floor = loaded.get(id);
    const room = floor?.rooms.find((candidate) => candidate.id === request.room);
    if (floor && room) {
      const well = stairwell(house, id, loaded, catalogue);
      const outline = roomPolygon(floor, room);
      // Only the stairs that come up in this room.
      const items = (well.below?.items ?? []).filter((item) => pointInPolygon(item, outline));
      return {
        status: "ready",
        title: room.name || "Room",
        floors: [
          {
            floor: roomOnly(floor, room.id),
            elevation: 0,
            ...cut({
              holes: well.holes,
              ...(well.below && items.length > 0 ? { below: { ...well.below, items } } : {}),
            }),
          },
        ],
      };
    }
  }
  if (!needed.every((id) => loaded.has(id))) return { status: "loading" };
  return { status: "missing", what: "room" };
}

/** What a stairwell adds to a floor in a view: nothing at all if it is empty. */
function cut(well: Stairwell): Partial<Pick<ViewFloor, "holes" | "below">> {
  return well.holes.length > 0 || well.below ? well : {};
}

/** A floor cut down to one room: its outline, the walls round it and inside
 * it, and the furniture and fixtures in it. Returns the floor unchanged if
 * the room is not on it. */
export function roomOnly(floor: Floor, roomId: string): Floor {
  const room = floor.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return floor;
  const outline = roomPolygon(floor, room);
  const position = new Map(floor.vertices.map((vertex) => [vertex.id, vertex]));
  const onBoundary = new Set(room.boundary);
  const edges = new Set<string>();
  room.boundary.forEach((id, index) => {
    const next = room.boundary[(index + 1) % room.boundary.length];
    edges.add(id < next ? `${id}|${next}` : `${next}|${id}`);
  });
  const inside = (point: Point) => outline.length >= 3 && pointInPolygon(point, outline);

  const walls = floor.walls.filter((wall) => {
    const span = wall.a < wall.b ? `${wall.a}|${wall.b}` : `${wall.b}|${wall.a}`;
    if (edges.has(span)) return true;
    // A wall that sticks into the room, or stands free in it.
    const a = position.get(wall.a);
    const b = position.get(wall.b);
    if (!a || !b) return false;
    const touches = (id: string, at: Point) => onBoundary.has(id) || inside(at);
    return touches(wall.a, a) && touches(wall.b, b) && inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
  const wallIds = new Set(walls.map((wall) => wall.id));
  const used = new Set(walls.flatMap((wall) => [wall.a, wall.b]));
  for (const id of room.boundary) used.add(id);
  const items = floor.items.filter((item) => item.room === roomId);
  const itemIds = new Set(items.map((item) => item.id));
  return {
    ...floor,
    vertices: floor.vertices.filter((vertex) => used.has(vertex.id)),
    walls,
    openings: floor.openings.filter((opening) => wallIds.has(opening.wall)),
    rooms: [room],
    items,
    fixtures: floor.fixtures
      .filter((fixture) => fixture.room === roomId)
      .map((fixture) =>
        fixture.item !== null && !itemIds.has(fixture.item) ? { ...fixture, item: null } : fixture,
      ),
    trace: null,
  };
}

/** A saved camera view as a particular view needs it: lifted by the height
 * its floor is shown at. Undefined if there is no such view, or its floor is
 * not among those shown. */
export function cameraFor(
  house: Pick<House, "cameras">,
  floors: readonly ViewFloor[],
  cameraId: string | undefined,
): Pick<Camera, "position" | "target"> | undefined {
  const camera = house.cameras.find((candidate) => candidate.id === cameraId);
  if (!camera) return undefined;
  let lift = 0;
  if (camera.floor !== null) {
    const shown = floors.find(({ floor }) => floor.id === camera.floor);
    if (!shown) return undefined;
    lift = shown.elevation;
  }
  return {
    position: [camera.position[0], camera.position[1] + lift, camera.position[2]],
    target: [camera.target[0], camera.target[1] + lift, camera.target[2]],
  };
}

/** The saved views that make sense for a view: all of them for the house,
 * and for a floor or room those saved on that floor or on none. */
export function camerasFor(house: Pick<House, "cameras">, request: ViewRequest): Camera[] {
  if (request.view === "house") return house.cameras;
  return house.cameras.filter((camera) => camera.floor === null || camera.floor === request.floor);
}
