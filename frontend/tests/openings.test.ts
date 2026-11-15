import { describe, expect, it } from "vitest";
import { moveFloor, nextFloor, outerWalls } from "../src/core/floors";
import { buildFloorMesh, type MeshData, type MeshOptions } from "../src/core/mesh";
import {
  deleteOpenings,
  fitOpenings,
  moveOpening,
  nearestWall,
  openingAt,
  openingEnds,
  placeOpening,
  updateOpening,
} from "../src/core/openings";
import { addWall, commit, moveVertices } from "../src/core/plan";
import type { Floor } from "../src/core/scene";
import { calibrate, moveTrace, newTrace, traceBox } from "../src/core/trace";
import { assertConsistent, counter, draw, emptyFloor, p, rectangle, vertexAt, wallBetween, DOOR_DEFAULTS } from "./helpers";

const room = (): Floor => rectangle(emptyFloor(), counter(), 0, 0, 6, 4);
const top = (floor: Floor) => wallBetween(floor, [0, 0], [6, 0]);

describe("placing openings", () => {
  it("centres a door on the point, on the wall", () => {
    const floor = room();
    const placed = placeOpening(floor, top(floor), "door", { x: 2, y: 0.3 }, counter());
    expect(placed.id).toBe("o1");
    expect(placed.floor.openings).toEqual([
      { id: "o1", wall: top(floor), type: "door", offset: 1.6, width: 0.8, height: 2, sill: 0, entity_id: null , ...DOOR_DEFAULTS},
    ]);
  });

  it("gives a window a sill", () => {
    const floor = room();
    const placed = placeOpening(floor, top(floor), "window", { x: 3, y: 0 }, counter());
    expect(placed.floor.openings[0]).toMatchObject({ offset: 2.4, width: 1.2, height: 1.2, sill: 0.9 });
  });

  it("keeps it on the wall near the ends", () => {
    const floor = room();
    expect(openingAt(floor, top(floor), "door", { x: -3, y: 0 })?.offset).toBe(0);
    expect(openingAt(floor, top(floor), "door", { x: 60, y: 0 })?.offset).toBeCloseTo(5.2);
  });

  it("measures from the wall's own first end, whichever way it runs", () => {
    const floor = draw(emptyFloor(), counter(), [6, 0], [0, 0]);
    const opening = openingAt(floor, floor.walls[0].id, "door", { x: 1, y: 0 })!;
    expect(opening.offset).toBeCloseTo(4.6);
    const ends = openingEnds(floor, opening)!;
    expect(ends.start.x).toBeCloseTo(1.4);
    expect(ends.end.x).toBeCloseTo(0.6);
  });

  it("narrows to fit a short wall, and refuses one that is too short", () => {
    const short = draw(emptyFloor(), counter(), [0, 0], [0.7, 0]);
    expect(openingAt(short, short.walls[0].id, "door", { x: 0.3, y: 0 })).toMatchObject({ width: 0.6, offset: 0 });
    // Further along, it stops at the far end.
    expect(openingAt(short, short.walls[0].id, "door", { x: 0.65, y: 0 })?.offset).toBeCloseTo(0.1);
    const tiny = draw(emptyFloor(), counter(), [0, 0], [0.3, 0]);
    expect(openingAt(tiny, tiny.walls[0].id, "door", { x: 0.1, y: 0 })).toBeUndefined();
    expect(placeOpening(tiny, tiny.walls[0].id, "door", { x: 0.1, y: 0 }).floor).toBe(tiny);
    expect(openingAt(tiny, "nope", "door", { x: 0, y: 0 })).toBeUndefined();
  });

  it("finds the wall under a point", () => {
    const floor = room();
    expect(nearestWall(floor, { x: 3, y: 0.1 }, 0.15)).toBe(top(floor));
    expect(nearestWall(floor, { x: 3, y: 2 }, 0.15)).toBeUndefined();
    // In a corner, the nearer wall.
    expect(nearestWall(floor, { x: 0.1, y: 0.02 }, 0.15)).toBe(top(floor));
  });
});

describe("changing openings", () => {
  const withDoor = () => {
    const floor = room();
    return placeOpening(floor, top(floor), "door", { x: 2, y: 0 }, counter()).floor;
  };

  it("slides along its wall", () => {
    const floor = withDoor();
    expect(moveOpening(floor, "o1", top(floor), { x: 4, y: 1 }).openings[0].offset).toBe(3.6);
    expect(moveOpening(floor, "o1", top(floor), { x: 2, y: 9 })).toBe(floor);
  });

  it("moves to another wall", () => {
    const floor = withDoor();
    const left = wallBetween(floor, [0, 0], [0, 4]);
    const moved = moveOpening(floor, "o1", left, { x: 0, y: 2 });
    expect(moved.openings[0].wall).toBe(left);
    const ends = openingEnds(moved, moved.openings[0])!;
    expect((ends.start.y + ends.end.y) / 2).toBeCloseTo(2);
  });

  it("clamps sizes to the wall and to sense", () => {
    const floor = withDoor();
    expect(updateOpening(floor, "o1", { width: 50 }).openings[0]).toMatchObject({ width: 6, offset: 0 });
    expect(updateOpening(floor, "o1", { width: 0.01 }).openings[0].width).toBe(0.3);
    expect(updateOpening(floor, "o1", { offset: 99 }).openings[0].offset).toBeCloseTo(5.2);
    expect(updateOpening(floor, "o1", { height: 99, sill: -1 }).openings[0]).toMatchObject({ height: 6, sill: 0 });
  });

  it("gives a door that becomes a window a sill, and takes it away again", () => {
    const floor = withDoor();
    const asWindow = updateOpening(floor, "o1", { type: "window" });
    expect(asWindow.openings[0]).toMatchObject({ type: "window", sill: 0.9, height: 1.2 });
    expect(updateOpening(asWindow, "o1", { type: "door" }).openings[0]).toMatchObject({ sill: 0, height: 2 });
  });

  it("returns the same floor when nothing changes", () => {
    const floor = withDoor();
    expect(updateOpening(floor, "o1", { width: 0.8 })).toBe(floor);
    expect(updateOpening(floor, "nope", { width: 1 })).toBe(floor);
    expect(deleteOpenings(floor, new Set(["nope"]))).toBe(floor);
    expect(fitOpenings(floor)).toBe(floor);
  });

  it("deletes", () => {
    expect(deleteOpenings(withDoor(), new Set(["o1"])).openings).toEqual([]);
  });

  it("stays within a wall that is made shorter, and goes when there is no room", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [6, 0]);
    floor = placeOpening(floor, floor.walls[0].id, "window", { x: 5, y: 0 }, makeId).floor;
    const end = vertexAt(floor, 6, 0);
    const shorter = commit(moveVertices(floor, new Map([[end, { x: 3, y: 0 }]])), makeId);
    expect(shorter.openings[0]).toMatchObject({ width: 1.2, offset: 1.8 });
    const stub = commit(moveVertices(floor, new Map([[end, { x: 0.2, y: 0 }]])), makeId);
    expect(stub.openings).toEqual([]);
    assertConsistent(shorter);
  });
});

describe("openings in the 3D walls", () => {
  const options: MeshOptions = {
    floorColours: { default: [0.5, 0.5, 0.5] },
    outsideColour: [0.9, 0.9, 0.9],
    wallTopColour: [0.2, 0.2, 0.2],
  };
  /** The area of the triangles whose normal is along `axis` (0 for x, 2 for z). */
  const faceArea = (mesh: MeshData, axis: 0 | 2, sign: 1 | -1) => {
    let total = 0;
    for (let i = 0; i < mesh.positions.length; i += 9) {
      if (Math.sign(mesh.normals[i + axis]) !== sign || Math.abs(mesh.normals[i + axis]) < 0.99) continue;
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = mesh.positions.slice(i, i + 9);
      const u = [bx - ax, by - ay, bz - az];
      const v = [cx - ax, cy - ay, cz - az];
      total += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    return total;
  };
  const wallAlongX = () => draw(emptyFloor(), counter(), [0, 0], [6, 0]);

  it("leaves a hole the size of a door in both faces", () => {
    const solid = wallAlongX();
    const holed = placeOpening(solid, solid.walls[0].id, "door", { x: 3, y: 0 }, counter()).floor;
    const before = buildFloorMesh(solid, options).walls;
    const after = buildFloorMesh(holed, options).walls;
    for (const sign of [1, -1] as const) {
      expect(faceArea(before, 2, sign)).toBeCloseTo(6 * 2.4);
      expect(faceArea(after, 2, sign)).toBeCloseTo(6 * 2.4 - 0.8 * 2);
    }
  });

  it("lines the hole: two jambs, a head, and a sill for a window", () => {
    const solid = wallAlongX();
    const door = buildFloorMesh(placeOpening(solid, solid.walls[0].id, "door", { x: 3, y: 0 }, counter()).floor, options).walls;
    // Jambs face along the wall: 0.1 thick by 2 high, one each way, plus the wall's own two ends.
    const ends = 0.1 * 2.4;
    expect(faceArea(door, 0, 1)).toBeCloseTo(ends + 0.1 * 2);
    expect(faceArea(door, 0, -1)).toBeCloseTo(ends + 0.1 * 2);

    const window = buildFloorMesh(placeOpening(solid, solid.walls[0].id, "window", { x: 3, y: 0 }, counter()).floor, options);
    const up = (mesh: MeshData, sign: 1 | -1) => {
      let total = 0;
      for (let i = 0; i < mesh.positions.length; i += 9) {
        if (mesh.normals[i + 1] !== sign) continue;
        const [ax, , az, bx, , bz, cx, , cz] = mesh.positions.slice(i, i + 9);
        total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      }
      return total;
    };
    // Facing up: the top of the wall and the sill. Facing down: the head.
    expect(up(window.walls, 1)).toBeCloseTo(6 * 0.1 + 1.2 * 0.1);
    expect(up(window.walls, -1)).toBeCloseTo(1.2 * 0.1);
  });

  it("puts a pane in a window, seen from both sides, and none in a door", () => {
    const solid = wallAlongX();
    const window = buildFloorMesh(placeOpening(solid, solid.walls[0].id, "window", { x: 3, y: 0 }, counter()).floor, options);
    const glass = window.wallParts[0].glass!;
    expect(faceArea(glass, 2, 1)).toBeCloseTo(1.2 * 1.2);
    expect(faceArea(glass, 2, -1)).toBeCloseTo(1.2 * 1.2);
    const door = buildFloorMesh(placeOpening(solid, solid.walls[0].id, "door", { x: 3, y: 0 }, counter()).floor, options);
    expect(door.wallParts[0].glass).toBeUndefined();
  });

  it("keeps every triangle facing the way its normal says, with several openings", () => {
    const makeId = counter();
    let floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 6, 4), p([3, 0]), p([3, 4]), makeId);
    for (const wall of floor.walls) {
      floor = placeOpening(floor, wall.id, "window", { x: 1.5, y: 1 }, makeId).floor;
      floor = placeOpening(floor, wall.id, "door", { x: 4.5, y: 3.5 }, makeId).floor;
    }
    expect(floor.openings.length).toBeGreaterThan(8);
    const mesh = buildFloorMesh(floor, options);
    for (const data of [mesh.walls, ...mesh.wallParts.flatMap((part) => (part.glass ? [part.glass] : []))]) {
      for (let i = 0; i < data.positions.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = data.positions.slice(i, i + 9);
        const u = [bx - ax, by - ay, bz - az];
        const v = [cx - ax, cy - ay, cz - az];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(n[0] * data.normals[i] + n[1] * data.normals[i + 1] + n[2] * data.normals[i + 2]).toBeGreaterThan(0);
      }
    }
  });

  it("clips an opening taller than a low wall", () => {
    let floor = wallAlongX();
    floor = { ...floor, walls: [{ ...floor.walls[0], height: 1 }] };
    floor = placeOpening(floor, floor.walls[0].id, "door", { x: 3, y: 0 }, counter()).floor;
    const mesh = buildFloorMesh(floor, options).walls;
    expect(Math.max(...mesh.positions.filter((_, i) => i % 3 === 1))).toBe(1);
    expect(faceArea(mesh, 2, 1)).toBeCloseTo(6 * 1 - 0.8 * 1);
  });
});

describe("floors", () => {
  const meta = (id: string, name: string, elevation: number) => ({ id, name, elevation, ha_floor_id: null });

  it("names and places a new floor above the last", () => {
    expect(nextFloor([])).toEqual({ name: "Ground floor", elevation: 0 });
    expect(nextFloor([meta("f1", "Ground floor", 0)])).toEqual({ name: "First floor", elevation: 2.7 });
    expect(nextFloor([meta("f1", "Ground floor", 0), meta("f2", "First floor", 2.7)], 2.2)).toEqual({
      name: "Second floor",
      elevation: 5.2,
    });
    // A cellar does not change which floor is on top.
    expect(nextFloor([meta("f0", "Cellar", -2.5), meta("f1", "Ground", 0)]).elevation).toBe(2.7);
  });

  it("does not reuse a name", () => {
    expect(nextFloor([meta("f1", "First floor", 0)]).name).toBe("Second floor");
    const four = ["Ground floor", "First floor", "Second floor", "Third floor"].map((name, i) => meta(`f${i}`, name, i * 3));
    expect(nextFloor(four).name).toBe("Floor 5");
  });

  it("moves a floor up and down the list", () => {
    const list = [meta("a", "A", 0), meta("b", "B", 1), meta("c", "C", 2)];
    expect(moveFloor(list, "a", 1).map((f) => f.id)).toEqual(["b", "a", "c"]);
    expect(moveFloor(list, "c", -1).map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(moveFloor(list, "a", -1)).toBe(list);
    expect(moveFloor(list, "c", 1)).toBe(list);
    expect(moveFloor(list, "nope", 1)).toBe(list);
  });

  it("copies the outside walls of a floor, with new ids and no inner walls", () => {
    const makeId = counter();
    let floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
    floor = { ...floor, walls: floor.walls.map((wall) => ({ ...wall, thickness: 0.3, height: 1 })) };
    const fresh = counter();
    const outer = outerWalls(floor, (prefix) => `new_${fresh(prefix)}`);

    expect(outer.walls).toHaveLength(6);
    expect(outer.vertices).toHaveLength(6);
    for (const wall of outer.walls) {
      expect(floor.walls.some((old) => old.id === wall.id)).toBe(false);
      expect(wall.thickness).toBe(0.3);
      // The floor above has its own height.
      expect(wall.height).toBeNull();
    }
    const above = commit({ ...emptyFloor("f2"), ...outer }, counter());
    expect(above.rooms).toHaveLength(1);
    assertConsistent(above);
  });

  it("copies nothing from a floor with no rooms", () => {
    const open = draw(emptyFloor(), counter(), [0, 0], [4, 0], [4, 3]);
    expect(outerWalls(open)).toEqual({ vertices: [], walls: [] });
  });
});

describe("trace", () => {
  it("starts ten metres wide, centred", () => {
    const trace = newTrace("t_1", 2000, 1000, { x: 3, y: 2 });
    expect(trace).toEqual({ image: "t_1", scale: 0.005, x: -2, y: -0.5, opacity: 0.4 });
    expect(traceBox(trace, 2000, 1000)).toEqual({ x: -2, y: -0.5, width: 10, height: 5 });
  });

  it("sets the scale from two points and a distance, keeping the first point still", () => {
    const trace = newTrace("t_1", 2000, 1000, { x: 3, y: 2 });
    // Two points 2 m apart on the plan as drawn are really 5 m apart.
    const first = { x: 0, y: 1 };
    const scaled = calibrate(trace, first, { x: 2, y: 1 }, 5);
    expect(scaled.scale).toBeCloseTo(0.0125);
    // The pixel that was under the first point is still under it.
    const pixel = { x: (first.x - trace.x) / trace.scale, y: (first.y - trace.y) / trace.scale };
    expect(scaled.x + pixel.x * scaled.scale).toBeCloseTo(first.x);
    expect(scaled.y + pixel.y * scaled.scale).toBeCloseTo(first.y);
    expect(traceBox(scaled, 2000, 1000).width).toBeCloseTo(25);
  });

  it("ignores nonsense", () => {
    const trace = newTrace("t_1", 2000, 1000, { x: 0, y: 0 });
    expect(calibrate(trace, { x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toBe(trace);
    expect(calibrate(trace, { x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBe(trace);
    expect(calibrate(trace, { x: 0, y: 0 }, { x: 1, y: 0 }, Number.NaN)).toBe(trace);
    expect(calibrate(trace, { x: 0, y: 0 }, { x: 0.001, y: 0 }, 1e9)).toBe(trace);
  });

  it("slides across the plan without changing size", () => {
    const trace = newTrace("t_0123456789abcdef", 1000, 500, { x: 0, y: 0 });
    const moved = moveTrace(trace, 1.23456, -2);
    expect(moved).toMatchObject({ x: trace.x + 1.2346, y: trace.y - 2, scale: trace.scale, opacity: trace.opacity });
    expect(traceBox(moved, 1000, 500).width).toBe(traceBox(trace, 1000, 500).width);
    // Nowhere to go, or nonsense: the very same trace.
    expect(moveTrace(trace, 0, 0)).toBe(trace);
    expect(moveTrace(trace, Number.NaN, 1)).toBe(trace);
  });
});
