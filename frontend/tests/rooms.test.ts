import { describe, expect, it } from "vitest";
import { polygonArea } from "../src/core/geometry";
import { addWall, commit, deleteWalls, moveVertices } from "../src/core/plan";
import { detectRooms, findFaces, roomPolygon } from "../src/core/rooms";
import type { Floor } from "../src/core/scene";
import {
  assertConsistent,
  counter,
  draw,
  emptyFloor,
  p,
  rectangle,
  vertexAt,
  wallBetween,
  ITEM_DEFAULTS,
} from "./helpers";

const area = (floor: Floor, roomId: string) =>
  Number(polygonArea(roomPolygon(floor, floor.rooms.find((r) => r.id === roomId)!)).toFixed(3));
const areas = (floor: Floor) => floor.rooms.map((r) => area(floor, r.id)).sort((a, b) => a - b);
const named = (floor: Floor, roomId: string, name: string, areaId: string | null = null): Floor => ({
  ...floor,
  rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, name, area_id: areaId } : r)),
});

describe("findFaces", () => {
  it("finds nothing in an open chain", () => {
    expect(findFaces(draw(emptyFloor(), counter(), [0, 0], [4, 0], [4, 3], [0, 3]))).toEqual([]);
  });

  it("finds one face in a rectangle, whichever way it was drawn", () => {
    const clockwise = draw(emptyFloor(), counter(), [0, 0], [0, 3], [4, 3], [4, 0], [0, 0]);
    expect(findFaces(rectangle(emptyFloor(), counter(), 0, 0, 4, 3))).toHaveLength(1);
    expect(findFaces(clockwise)).toHaveLength(1);
  });

  it("ignores a wall that sticks into a room", () => {
    const makeId = counter();
    const floor = draw(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), makeId, [2, 0], [2, 1.5]);
    const faces = findFaces(floor);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toHaveLength(5);
    assertConsistent(floor);
  });

  it("ignores a chain of walls that sticks out", () => {
    const makeId = counter();
    const floor = draw(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), makeId, [4, 3], [6, 3], [6, 5]);
    expect(findFaces(floor)).toHaveLength(1);
  });

  it("finds rooms in separate buildings", () => {
    const makeId = counter();
    const floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), makeId, 10, 0, 2, 2);
    expect(areas(floor)).toEqual([4, 12]);
  });

  it("finds a room inside a room", () => {
    const makeId = counter();
    const floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 10, 10), makeId, 4, 4, 2, 2);
    expect(areas(floor)).toEqual([4, 100]);
    assertConsistent(floor);
  });

  it("copes with an inner room tied to the outer wall by one wall", () => {
    const makeId = counter();
    let floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 10, 10), makeId, 4, 4, 2, 2);
    floor = addWall(floor, p([0, 5]), p([4, 5]), makeId);
    expect(areas(floor)).toEqual([4, 100]);
    assertConsistent(floor);
  });

  it("copes with two rooms that touch at a corner", () => {
    const makeId = counter();
    const floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 2, 2), makeId, 2, 2, 3, 3);
    expect(areas(floor)).toEqual([4, 9]);
    assertConsistent(floor);
  });

  it("finds an L-shaped room", () => {
    const floor = draw(emptyFloor(), counter(), [0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5], [0, 0]);
    expect(areas(floor)).toEqual([18]);
  });

  it("finds every room of a small house", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 10, 8);
    floor = addWall(floor, p([0, 4]), p([10, 4]), makeId);
    floor = addWall(floor, p([4, 0]), p([4, 4]), makeId);
    floor = addWall(floor, p([6, 4]), p([6, 8]), makeId);
    expect(areas(floor)).toEqual([16, 16, 24, 24]);
    assertConsistent(floor);
  });
});

describe("detectRooms keeps what is known about a room", () => {
  it("through a vertex being moved", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const room = floor.rooms[0].id;
    floor = named(floor, room, "Kitchen", "kitchen");
    floor = commit(moveVertices(floor, new Map([[vertexAt(floor, 4, 3), { x: 5, y: 4 }]])), makeId);
    expect(floor.rooms).toHaveLength(1);
    expect(floor.rooms[0]).toMatchObject({ id: room, name: "Kitchen", area_id: "kitchen" });
  });

  it("returns the same room object when nothing about it changed", () => {
    const makeId = counter();
    const floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const elsewhere = draw(floor, makeId, [10, 10], [12, 10]);
    expect(elsewhere.rooms[0]).toBe(floor.rooms[0]);
  });

  it("when a wall is added to its outline", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const room = floor.rooms[0].id;
    floor = named(floor, room, "Kitchen");
    floor = draw(floor, makeId, [2, 0], [2, -1]);
    expect(floor.rooms.map((r) => [r.id, r.name])).toEqual([[room, "Kitchen"]]);
    expect(floor.rooms[0].boundary).toHaveLength(5);
  });

  it("when it is split in two: the half with its middle keeps the name", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 10, 4);
    const room = floor.rooms[0].id;
    floor = named(floor, room, "Lounge", "lounge");
    floor = addWall(floor, p([7, 0]), p([7, 4]), makeId);

    expect(floor.rooms).toHaveLength(2);
    expect(area(floor, room)).toBe(28);
    const other = floor.rooms.find((r) => r.id !== room)!;
    expect(other).toMatchObject({ name: "", area_id: null });
    expect(area(floor, other.id)).toBe(12);
  });

  it("when two are joined: one name survives, no duplicate rooms", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 10, 4);
    floor = addWall(floor, p([7, 0]), p([7, 4]), makeId);
    const big = floor.rooms.find((r) => area(floor, r.id) === 28)!.id;
    const small = floor.rooms.find((r) => area(floor, r.id) === 12)!.id;
    floor = named(named(floor, big, "Lounge"), small, "Study");

    floor = deleteWalls(floor, new Set([wallBetween(floor, [7, 0], [7, 4])]), makeId);

    expect(floor.rooms).toHaveLength(1);
    expect(["Lounge", "Study"]).toContain(floor.rooms[0].name);
    expect(areas(floor)).toEqual([40]);
    assertConsistent(floor);
  });

  it("for the other rooms when one is removed", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    floor = rectangle(floor, makeId, 10, 0, 2, 2);
    const [first, second] = floor.rooms.map((r) => r.id);
    floor = named(named(floor, first, "Kitchen"), second, "Shed");
    floor = deleteWalls(floor, new Set([wallBetween(floor, [10, 0], [12, 0])]), makeId);
    expect(floor.rooms.map((r) => r.name)).toEqual(["Kitchen"]);
  });

  it("for an L-shaped room, whose centroid is outside it", () => {
    const makeId = counter();
    // A thin L: the centroid falls in the notch.
    let floor = draw(emptyFloor(), makeId, [0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10], [0, 0]);
    const room = floor.rooms[0].id;
    floor = named(floor, room, "Hall");
    // Cut the far end off the long arm.
    floor = addWall(floor, p([8, 0]), p([8, 1]), makeId);
    expect(floor.rooms).toHaveLength(2);
    expect(floor.rooms.find((r) => r.id === room)?.name).toBe("Hall");
    expect(area(floor, room)).toBe(17);
  });

  it("and unsets the room of furniture whose room is gone", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const room = floor.rooms[0].id;
    floor = {
      ...floor,
      items: [{ id: "i1", model: "kit/sofa", x: 1, y: 1, z: 0, rotation: 0, scale: 1, room, ...ITEM_DEFAULTS }],
      fixtures: [
        {
          id: "x1",
          entity_id: "light.a",
          kind: "light",
          x: 1,
          y: 1,
          z: 2,
          room,
          item: "i1",
          model: null,
          options: {},
        },
      ],
    };
    floor = deleteWalls(floor, new Set([wallBetween(floor, [0, 0], [4, 0])]), makeId);
    expect(floor.items[0].room).toBeNull();
    expect(floor.fixtures[0]).toMatchObject({ room: null, item: "i1" });
  });
});

describe("detectRooms", () => {
  it("gives new rooms the defaults the server would", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    expect(detectRooms({ ...floor, rooms: [] }, counter())[0]).toEqual({
      id: "r1",
      name: "",
      area_id: null,
      boundary: floor.rooms[0].boundary,
      floor_style: "default",
      wall_colour: "#e8e4dc",
      open: false,
    });
  });

  it("ignores slivers", () => {
    const floor = draw(emptyFloor(), counter(), [0, 0], [1, 0], [1, 0.008], [0, 0]);
    expect(floor.rooms).toEqual([]);
  });
});
