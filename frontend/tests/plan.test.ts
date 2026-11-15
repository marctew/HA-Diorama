import { describe, expect, it } from "vitest";
import {
  addWall,
  commit,
  deleteVertices,
  deleteWalls,
  moveVertices,
  setWallLength,
  wallLength,
} from "../src/core/plan";
import { polygonArea } from "../src/core/geometry";
import { roomPolygon } from "../src/core/rooms";
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
} from "./helpers";

const areas = (floor: Floor) =>
  floor.rooms.map((room) => Number(polygonArea(roomPolygon(floor, room)).toFixed(3))).sort((a, b) => a - b);

describe("addWall", () => {
  it("adds two vertices and a wall", () => {
    const floor = addWall(emptyFloor(), p([0, 0]), p([4, 0]), counter());
    expect(floor.vertices).toEqual([
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 4, y: 0 },
    ]);
    expect(floor.walls).toEqual([{ id: "w1", a: "v1", b: "v2", thickness: 0.1, height: null }]);
    expect(floor.rooms).toEqual([]);
  });

  it("ignores a wall of no length", () => {
    const floor = emptyFloor();
    expect(addWall(floor, p([1, 1]), p([1, 1.001]), counter())).toBe(floor);
  });

  it("reuses a vertex that is already there", () => {
    const floor = draw(emptyFloor(), counter(), [0, 0], [4, 0], [4, 3]);
    expect(floor.vertices).toHaveLength(3);
    expect(floor.walls).toHaveLength(2);
    expect(floor.walls[1].a).toBe(floor.walls[0].b);
  });

  it("does not add the same wall twice", () => {
    const makeId = counter();
    const floor = draw(emptyFloor(), makeId, [0, 0], [4, 0]);
    const again = addWall(floor, p([4, 0]), p([0, 0]), makeId);
    expect(again.walls).toHaveLength(1);
    assertConsistent(again);
  });

  it("makes a room when a loop closes", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    expect(floor.vertices).toHaveLength(4);
    expect(floor.walls).toHaveLength(4);
    expect(areas(floor)).toEqual([12]);
    expect(floor.rooms[0]).toMatchObject({ name: "", area_id: null });
    assertConsistent(floor);
  });

  it("splits a wall it ends on", () => {
    const makeId = counter();
    const room = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const floor = addWall(room, p([2, 0]), p([2, 3]), makeId);
    expect(floor.vertices).toHaveLength(6);
    expect(floor.walls).toHaveLength(7);
    expect(areas(floor)).toEqual([6, 6]);
    assertConsistent(floor);
  });

  it("splits both walls where two cross", () => {
    const makeId = counter();
    const floor = draw(draw(emptyFloor(), makeId, [0, 1], [4, 1]), makeId, [2, 0], [2, 3]);
    expect(floor.vertices).toHaveLength(5);
    expect(floor.walls).toHaveLength(4);
    expect(vertexAt(floor, 2, 1)).toBeDefined();
    assertConsistent(floor);
  });

  it("splits at every wall a long wall crosses", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 6, 4);
    floor = addWall(floor, p([2, 0]), p([2, 4]), makeId);
    floor = addWall(floor, p([4, 0]), p([4, 4]), makeId);
    floor = addWall(floor, p([-1, 2]), p([7, 2]), makeId);
    expect(areas(floor)).toEqual([4, 4, 4, 4, 4, 4]);
    assertConsistent(floor);
  });

  it("copes with a wall drawn along part of another", () => {
    const makeId = counter();
    const floor = draw(draw(emptyFloor(), makeId, [0, 0], [4, 0]), makeId, [2, 0], [6, 0]);
    expect(floor.vertices.map((v) => v.x).sort()).toEqual([0, 2, 4, 6]);
    expect(floor.walls).toHaveLength(3);
    assertConsistent(floor);
  });

  it("passes through a vertex that lies on its line", () => {
    const makeId = counter();
    const corner = draw(emptyFloor(), makeId, [2, 0], [2, 2]);
    const floor = addWall(corner, p([0, 2]), p([4, 2]), makeId);
    expect(floor.walls).toHaveLength(3);
    assertConsistent(floor);
  });

  it("gives new walls the thickness of the last one", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [4, 0]);
    floor = { ...floor, walls: [{ ...floor.walls[0], thickness: 0.3 }] };
    floor = addWall(floor, p([4, 0]), p([4, 3]), makeId);
    expect(floor.walls[1].thickness).toBe(0.3);
  });

  it("leaves the floor it was given alone", () => {
    const makeId = counter();
    const before = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const snapshot = JSON.stringify(before);
    addWall(before, p([2, 0]), p([2, 3]), makeId);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("openings on a wall that is split", () => {
  it("stay where they are in the room", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [6, 0]);
    const wall = floor.walls[0].id;
    const opening = { type: "door" as const, width: 0.8, height: 2, sill: 0, entity_id: null };
    floor = {
      ...floor,
      openings: [
        { ...opening, id: "o1", wall, offset: 1 },
        { ...opening, id: "o2", wall, offset: 4.5 },
      ],
    };
    floor = addWall(floor, p([3, 0]), p([3, 2]), makeId);

    const first = wallBetween(floor, [0, 0], [3, 0]);
    const second = wallBetween(floor, [3, 0], [6, 0]);
    expect(floor.openings).toEqual([
      { ...opening, id: "o1", wall: first, offset: 1 },
      { ...opening, id: "o2", wall: second, offset: 1.5 },
    ]);
    assertConsistent(floor);
  });
});

describe("moving vertices", () => {
  it("does not tidy until committed", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    const corner = vertexAt(floor, 4, 3);
    const dragged = moveVertices(floor, new Map([[corner, { x: 5, y: 4 }]]));
    expect(dragged.rooms).toBe(floor.rooms);
    expect(dragged.vertices.find((v) => v.id === corner)).toMatchObject({ x: 5, y: 4 });
    expect(floor.vertices.find((v) => v.id === corner)).toMatchObject({ x: 4, y: 3 });
  });

  it("keeps the room, with its new shape, after commit", () => {
    const makeId = counter();
    const floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const room = floor.rooms[0].id;
    const moved = commit(
      moveVertices(floor, new Map([[vertexAt(floor, 4, 3), { x: 6, y: 3 }]])),
      makeId,
    );
    expect(moved.rooms.map((r) => r.id)).toEqual([room]);
    expect(areas(moved)).toEqual([15]);
  });

  it("merges a vertex dropped onto another", () => {
    const makeId = counter();
    // A square with a triangle bump on its right side.
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 4);
    floor = draw(floor, makeId, [4, 1], [5, 2], [4, 3]);
    expect(floor.rooms).toHaveLength(2);
    const tip = vertexAt(floor, 5, 2);

    const merged = commit(moveVertices(floor, new Map([[tip, { x: 4, y: 1 }]])), makeId);

    expect(merged.vertices.some((v) => v.id === tip)).toBe(false);
    expect(areas(merged)).toEqual([16]);
    assertConsistent(merged);
  });

  it("splits walls a dragged wall now crosses", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 4);
    floor = draw(floor, makeId, [5, 1], [5, 3]);
    const top = vertexAt(floor, 5, 1);
    const bottom = vertexAt(floor, 5, 3);
    // Drag the loose wall so that it leans across the square's right side.
    const moved = commit(
      moveVertices(
        floor,
        new Map([
          [top, { x: 3, y: 1 }],
          [bottom, { x: 5, y: 3 }],
        ]),
      ),
      makeId,
    );
    expect(vertexAt(moved, 4, 2)).toBeDefined();
    assertConsistent(moved);
  });
});

describe("deleting", () => {
  it("removes a wall and the vertices nothing else uses", () => {
    const makeId = counter();
    const floor = draw(emptyFloor(), makeId, [0, 0], [4, 0], [4, 3]);
    const result = deleteWalls(floor, new Set([wallBetween(floor, [4, 0], [4, 3])]), makeId);
    expect(result.walls).toHaveLength(1);
    expect(result.vertices).toHaveLength(2);
  });

  it("makes a run of wall whole again when the wall that split it goes", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 6, 4);
    const top = wallBetween(floor, [0, 0], [6, 0]);
    const opening = { type: "window" as const, width: 1, height: 1, sill: 1, entity_id: null };
    floor = {
      ...floor,
      openings: [
        { ...opening, id: "o1", wall: top, offset: 0.5 },
        { ...opening, id: "o2", wall: top, offset: 4.5 },
      ],
    };
    floor = addWall(floor, p([3, 0]), p([3, 4]), makeId);
    expect(floor.walls).toHaveLength(7);
    expect(floor.rooms).toHaveLength(2);

    floor = deleteWalls(floor, new Set([wallBetween(floor, [3, 0], [3, 4])]), makeId);

    expect(floor.walls).toHaveLength(4);
    expect(floor.vertices).toHaveLength(4);
    expect(areas(floor)).toEqual([24]);
    const whole = wallBetween(floor, [0, 0], [6, 0]);
    expect(floor.openings).toEqual([
      { ...opening, id: "o1", wall: whole, offset: 0.5 },
      { ...opening, id: "o2", wall: whole, offset: 4.5 },
    ]);
    assertConsistent(floor);
  });

  it("keeps openings in place when the joined halves ran in opposite directions", () => {
    const makeId = counter();
    // Two walls drawn towards each other, meeting at (3, 0), with a stub there.
    let floor = draw(emptyFloor(), makeId, [0, 0], [3, 0]);
    floor = draw(floor, makeId, [6, 0], [3, 0]);
    floor = draw(floor, makeId, [3, 0], [3, 2]);
    const right = wallBetween(floor, [6, 0], [3, 0]);
    floor = {
      ...floor,
      openings: [
        { id: "o1", wall: right, type: "door", offset: 0.5, width: 1, height: 2, sill: 0, entity_id: null },
      ],
    };
    // The door is 0.5 m in from x = 6, so it spans x = 4.5 to 5.5.
    floor = deleteWalls(floor, new Set([wallBetween(floor, [3, 0], [3, 2])]), makeId);

    expect(floor.walls).toHaveLength(1);
    const wall = floor.walls[0];
    const start = floor.vertices.find((v) => v.id === wall.a)!.x;
    const door = floor.openings[0];
    const from = start === 0 ? door.offset : 6 - door.offset - door.width;
    expect(from).toBeCloseTo(4.5);
    assertConsistent(floor);
  });

  it("leaves a corner alone when a wall at it goes", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    floor = addWall(floor, p([4, 3]), p([6, 5]), makeId);
    floor = deleteWalls(floor, new Set([wallBetween(floor, [4, 3], [6, 5])]), makeId);
    expect(floor.vertices).toHaveLength(4);
    expect(areas(floor)).toEqual([12]);
  });

  it("does not join walls of different thickness", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [6, 0]);
    floor = addWall(floor, p([3, 0]), p([3, 2]), makeId);
    const left = wallBetween(floor, [0, 0], [3, 0]);
    floor = { ...floor, walls: floor.walls.map((w) => (w.id === left ? { ...w, thickness: 0.3 } : w)) };
    floor = deleteWalls(floor, new Set([wallBetween(floor, [3, 0], [3, 2])]), makeId);
    expect(floor.walls).toHaveLength(2);
  });

  it("removes the room when its loop is opened", () => {
    const makeId = counter();
    const floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const result = deleteWalls(floor, new Set([wallBetween(floor, [0, 0], [4, 0])]), makeId);
    expect(result.rooms).toEqual([]);
    expect(result.vertices).toHaveLength(4);
    assertConsistent(result);
  });

  it("removes the openings of a deleted wall", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [4, 0], [4, 3]);
    const wall = floor.walls[0].id;
    floor = {
      ...floor,
      openings: [
        { id: "o1", wall, type: "window", offset: 1, width: 1, height: 1, sill: 1, entity_id: null },
      ],
    };
    expect(deleteWalls(floor, new Set([wall]), makeId).openings).toEqual([]);
  });

  it("does nothing for a wall that is not there", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    expect(deleteWalls(floor, new Set(["nope"]))).toBe(floor);
    expect(deleteVertices(floor, new Set(["nope"]))).toBe(floor);
  });

  it("takes a vertex out of a straight run and joins the two walls", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    floor = addWall(floor, p([2, 0]), p([2, -1]), makeId);
    expect(floor.walls).toHaveLength(6);

    // The stub goes with its far end; the corner it met is then taken out.
    floor = deleteVertices(floor, new Set([vertexAt(floor, 2, -1)]), makeId);
    expect(floor.walls).toHaveLength(5);
    const result = deleteVertices(floor, new Set([vertexAt(floor, 2, 0)]), makeId);

    expect(result.walls).toHaveLength(4);
    expect(wallBetween(result, [0, 0], [4, 0])).toBeDefined();
    expect(areas(result)).toEqual([12]);
    assertConsistent(result);
  });

  it("cuts a corner when the vertex was one", () => {
    const makeId = counter();
    const floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const result = deleteVertices(floor, new Set([vertexAt(floor, 4, 3)]), makeId);
    expect(result.vertices).toHaveLength(3);
    expect(areas(result)).toEqual([6]);
    assertConsistent(result);
  });

  it("removes every wall at a junction", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    floor = addWall(floor, p([2, 0]), p([2, 3]), makeId);
    const result = deleteVertices(floor, new Set([vertexAt(floor, 2, 0)]), makeId);
    expect(result.walls.some((w) => w.a === "gone" || w.b === "gone")).toBe(false);
    expect(result.rooms).toEqual([]);
    assertConsistent(result);
  });

  it("removes several vertices at once", () => {
    const makeId = counter();
    const floor = rectangle(emptyFloor(), makeId, 0, 0, 4, 3);
    const result = deleteVertices(
      floor,
      new Set([vertexAt(floor, 4, 3), vertexAt(floor, 0, 3)]),
      makeId,
    );
    expect(result.walls).toHaveLength(1);
    expect(result.vertices).toHaveLength(2);
    assertConsistent(result);
  });
});

describe("setWallLength", () => {
  it("moves the free end of a wall", () => {
    const makeId = counter();
    const floor = draw(emptyFloor(), makeId, [0, 0], [4, 0], [4, 3]);
    const wall = wallBetween(floor, [4, 0], [4, 3]);
    const result = setWallLength(floor, wall, 5, makeId);
    expect(wallLength(result, wall)).toBeCloseTo(5);
    expect(vertexAt(result, 4, 5)).toBeDefined();
    expect(vertexAt(result, 4, 0)).toBeDefined();
  });

  it("moves the first end when that is the free one", () => {
    const makeId = counter();
    const floor = draw(emptyFloor(), makeId, [0, 0], [4, 0], [4, 3]);
    const wall = wallBetween(floor, [0, 0], [4, 0]);
    const result = setWallLength(floor, wall, 6, makeId);
    expect(vertexAt(result, -2, 0)).toBeDefined();
    expect(vertexAt(result, 4, 3)).toBeDefined();
  });

  it("ignores nonsense", () => {
    const floor = draw(emptyFloor(), counter(), [0, 0], [4, 0]);
    const wall = floor.walls[0].id;
    expect(setWallLength(floor, wall, 0)).toBe(floor);
    expect(setWallLength(floor, wall, Number.NaN)).toBe(floor);
    expect(setWallLength(floor, "nope", 3)).toBe(floor);
    expect(setWallLength(floor, wall, 4)).toBe(floor);
  });
});
