// What a view shows: the whole house, one floor, or one room. Works out which
// floors are needed and cuts a floor down to a single room.

import { pointInPolygon, type Point } from "./geometry";
import { roomPolygon } from "./rooms";
import type { Floor, House } from "./scene";

export type ViewKind = "house" | "floor" | "room";

export interface ViewRequest {
  view: ViewKind;
  floor?: string;
  room?: string;
}

export interface ViewFloor {
  floor: Floor;
  /** Height of this floor's ground above the lowest thing shown, in metres. */
  elevation: number;
}

export type ViewResult =
  | { status: "ready"; floors: ViewFloor[]; title: string }
  /** Floors still have to be fetched before the view can be worked out. */
  | { status: "loading" }
  | { status: "empty" }
  | { status: "missing"; what: "floor" | "room" };

/** The ids of the floors a view needs, as far as can be told. A room view
 * that does not say which floor its room is on needs them all. */
export function floorsNeeded(house: House, request: ViewRequest): string[] {
  const all = house.floors.map((floor) => floor.id);
  if (request.view === "house") return all;
  if (request.floor) return all.includes(request.floor) ? [request.floor] : [];
  return request.view === "room" ? all : [];
}

/** Work out what to show from what has been loaded so far. */
export function resolveView(
  house: House,
  loaded: ReadonlyMap<string, Floor>,
  request: ViewRequest,
): ViewResult {
  if (house.floors.length === 0) return { status: "empty" };
  const needed = floorsNeeded(house, request);

  if (request.view === "house") {
    if (!needed.every((id) => loaded.has(id))) return { status: "loading" };
    const lowest = Math.min(...house.floors.map((floor) => floor.elevation));
    return {
      status: "ready",
      title: house.settings.name,
      floors: house.floors.map((meta) => ({
        floor: loaded.get(meta.id)!,
        elevation: meta.elevation - lowest,
      })),
    };
  }

  if (request.view === "floor") {
    const meta = house.floors.find((floor) => floor.id === request.floor);
    if (!meta) return { status: "missing", what: "floor" };
    const floor = loaded.get(meta.id);
    if (!floor) return { status: "loading" };
    return { status: "ready", title: meta.name, floors: [{ floor, elevation: 0 }] };
  }

  if (request.floor && needed.length === 0) return { status: "missing", what: "room" };
  for (const id of needed) {
    const floor = loaded.get(id);
    const room = floor?.rooms.find((candidate) => candidate.id === request.room);
    if (floor && room) {
      return {
        status: "ready",
        title: room.name || "Room",
        floors: [{ floor: roomOnly(floor, room.id), elevation: 0 }],
      };
    }
  }
  if (!needed.every((id) => loaded.has(id))) return { status: "loading" };
  return { status: "missing", what: "room" };
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
