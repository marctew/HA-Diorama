import { describe, expect, it } from "vitest";
import { polygonArea, signedArea, triangulate, type Point } from "../src/core/geometry";
import {
  buildFloorMesh,
  hexColour,
  roomNesting,
  wallFootprints,
  wallSides,
  type MeshData,
  type MeshOptions,
} from "../src/core/mesh";
import { addWall } from "../src/core/plan";
import { isQuality, pickQuality, QUALITY } from "../src/core/quality";
import type { Floor } from "../src/core/scene";
import { counter, draw, emptyFloor, p, rectangle, wallBetween } from "./helpers";

const options: MeshOptions = {
  floorColours: { default: [0.5, 0.5, 0.5], wood_light: [0.8, 0.7, 0.5] },
  outsideColour: [0.9, 0.9, 0.9],
  wallTopColour: [0.2, 0.2, 0.2],
};

interface Triangle {
  points: [number, number, number][];
  normal: [number, number, number];
  colour: [number, number, number];
}

function triangles(mesh: MeshData): Triangle[] {
  const result: Triangle[] = [];
  for (let i = 0; i < mesh.positions.length; i += 9) {
    const at = (j: number) => mesh.positions.slice(i + j * 3, i + j * 3 + 3) as [number, number, number];
    result.push({
      points: [at(0), at(1), at(2)],
      normal: mesh.normals.slice(i, i + 3) as [number, number, number],
      colour: mesh.colours.slice(i, i + 3) as [number, number, number],
    });
  }
  return result;
}

/** The way a triangle really faces, from the order of its corners. */
function facing({ points: [a, b, c] }: Triangle): [number, number, number] {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function area(triangle: Triangle): number {
  return Math.hypot(...facing(triangle)) / 2;
}

function expectWellFormed(mesh: MeshData): void {
  expect(mesh.positions.length % 9).toBe(0);
  expect(mesh.normals).toHaveLength(mesh.positions.length);
  expect(mesh.colours).toHaveLength(mesh.positions.length);
  for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
  for (const triangle of triangles(mesh)) {
    const real = facing(triangle);
    const dot = real[0] * triangle.normal[0] + real[1] * triangle.normal[1] + real[2] * triangle.normal[2];
    // Counter-clockwise seen from where the normal points: what a renderer draws.
    expect(dot).toBeGreaterThan(0);
    expect(Math.hypot(...triangle.normal)).toBeCloseTo(1);
  }
}

describe("triangulate", () => {
  const coveredArea = (points: Point[]) => {
    const indices = triangulate(points);
    let total = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [points[indices[i]], points[indices[i + 1]], points[indices[i + 2]]];
      expect(signedArea(triangle)).toBeGreaterThan(0);
      total += signedArea(triangle);
    }
    return total;
  };
  const ell = [p([0, 0]), p([6, 0]), p([6, 2]), p([2, 2]), p([2, 5]), p([0, 5])];

  it("covers a convex polygon exactly", () => {
    const square = [p([0, 0]), p([2, 0]), p([2, 2]), p([0, 2])];
    expect(triangulate(square)).toHaveLength(6);
    expect(coveredArea(square)).toBeCloseTo(4);
  });

  it("covers a concave polygon exactly, whichever way it winds", () => {
    expect(coveredArea(ell)).toBeCloseTo(polygonArea(ell));
    expect(triangulate(ell)).toHaveLength(12);
    const reversed = [...ell].reverse();
    expect(triangulate(reversed)).toHaveLength(12);
  });

  it("copes with corners in a straight line", () => {
    const withMidpoints = [p([0, 0]), p([1, 0]), p([2, 0]), p([2, 2]), p([1, 2]), p([0, 2])];
    expect(coveredArea(withMidpoints)).toBeCloseTo(4);
  });

  it("covers a U shape", () => {
    const u = [p([0, 0]), p([5, 0]), p([5, 4]), p([4, 4]), p([4, 1]), p([1, 1]), p([1, 4]), p([0, 4])];
    expect(coveredArea(u)).toBeCloseTo(polygonArea(u));
  });

  it("returns nothing for less than a triangle", () => {
    expect(triangulate([p([0, 0]), p([1, 1])])).toEqual([]);
  });
});

describe("wallFootprints", () => {
  it("gives a lone wall square ends", () => {
    const floor = draw(emptyFloor(), counter(), [0, 0], [4, 0]);
    const outline = wallFootprints(floor).get(floor.walls[0].id)!;
    expect(outline).toHaveLength(6);
    expect(polygonArea(outline)).toBeCloseTo(4 * 0.1);
    expect(outline.map((point) => Math.abs(point.y)).sort()).toEqual([0, 0, 0.05, 0.05, 0.05, 0.05]);
  });

  it("mitres the corners of a room so the walls tile without overlap", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    const footprints = wallFootprints(floor);
    let total = 0;
    for (const outline of footprints.values()) total += polygonArea(outline);
    // The centre line is 14 m round and the walls are 0.1 m thick.
    expect(total).toBeCloseTo(14 * 0.1);
    const top = footprints.get(wallBetween(floor, [0, 0], [4, 0]))!;
    const xs = top.map((point) => point.x);
    expect(Math.min(...xs)).toBeCloseTo(-0.05);
    expect(Math.max(...xs)).toBeCloseTo(4.05);
  });

  it("shares corner points between the walls at a T junction", () => {
    const makeId = counter();
    const floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), p([2, 0]), p([2, 3]), makeId);
    const footprints = wallFootprints(floor);
    let total = 0;
    for (const outline of footprints.values()) total += polygonArea(outline);
    // The outer walls, plus the divider between their inner faces: 2.9 m of it.
    expect(total).toBeCloseTo(14 * 0.1 + 2.9 * 0.1);
    // The divider stops at the faces of the walls it meets, not their centres.
    const divider = footprints.get(wallBetween(floor, [2, 0], [2, 3]))!;
    expect(polygonArea(divider)).toBeCloseTo(3 * 0.1 - 2 * 0.05 * 0.05, 4);
  });

  it("squares off a very sharp corner instead of a long spike", () => {
    const floor = draw(emptyFloor(), counter(), [4, 0], [0, 0], [4, 0.2]);
    for (const outline of wallFootprints(floor).values()) {
      for (const point of outline) expect(point.x).toBeGreaterThan(-0.7);
    }
  });

  it("handles walls of different thickness meeting in a line", () => {
    const makeId = counter();
    let floor = draw(emptyFloor(), makeId, [0, 0], [3, 0], [6, 0]);
    floor = { ...floor, walls: [floor.walls[0], { ...floor.walls[1], thickness: 0.3 }] };
    const footprints = wallFootprints(floor);
    expect(polygonArea(footprints.get(floor.walls[0].id)!)).toBeCloseTo(0.3);
    expect(polygonArea(footprints.get(floor.walls[1].id)!)).toBeCloseTo(0.9);
  });
});

describe("wallSides and roomNesting", () => {
  it("finds the room on each side of a wall", () => {
    const makeId = counter();
    const floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), p([2, 0]), p([2, 3]), makeId);
    const sides = wallSides(floor);
    const divider = sides.get(wallBetween(floor, [2, 0], [2, 3]))!;
    expect(divider[0]).toBeDefined();
    expect(divider[1]).toBeDefined();
    expect(divider[0]).not.toBe(divider[1]);
    const outer = sides.get(wallBetween(floor, [0, 0], [0, 3]))!;
    expect(outer.filter(Boolean)).toHaveLength(1);
  });

  it("counts how deep a room is inside others", () => {
    const makeId = counter();
    const floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 10, 10), makeId, 4, 4, 2, 2);
    const [outer, inner] = floor.rooms;
    expect(roomNesting(floor)).toEqual(new Map([[outer.id, 0], [inner.id, 1]]));
  });
});

describe("buildFloorMesh", () => {
  const room = (): Floor => rectangle(emptyFloor(), counter(), 0, 0, 4, 3);

  it("is empty for an empty floor", () => {
    const mesh = buildFloorMesh(emptyFloor(), options);
    expect(mesh.slabs.positions).toEqual([]);
    expect(mesh.walls.positions).toEqual([]);
    expect(mesh.bounds).toBeUndefined();
  });

  it("makes triangles that face the way their normals say", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 6, 4);
    floor = addWall(floor, p([2, 0]), p([2, 4]), makeId);
    floor = addWall(floor, p([2, 2]), p([6, 2]), makeId);
    floor = draw(floor, makeId, [6, 4], [8, 6], [9, 4]);
    const mesh = buildFloorMesh(floor, options);
    expectWellFormed(mesh.slabs);
    expectWellFormed(mesh.walls);
  });

  it("lays a slab over each room, facing up", () => {
    const mesh = buildFloorMesh(room(), options);
    const slabs = triangles(mesh.slabs);
    expect(slabs.reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(12);
    for (const triangle of slabs) {
      expect(triangle.normal).toEqual([0, 1, 0]);
      expect(triangle.colour).toEqual([0.5, 0.5, 0.5]);
      for (const point of triangle.points) expect(point[1]).toBe(0);
    }
  });

  it("puts the plan's y on the model's z", () => {
    const mesh = buildFloorMesh(room(), options);
    expect(mesh.bounds!.min[0]).toBeCloseTo(-0.05);
    expect(mesh.bounds!.max[0]).toBeCloseTo(4.05);
    expect(mesh.bounds!.min[2]).toBeCloseTo(-0.05);
    expect(mesh.bounds!.max[2]).toBeCloseTo(3.05);
    expect(mesh.bounds!.min[1]).toBe(0);
    expect(mesh.bounds!.max[1]).toBe(2.4);
  });

  it("builds walls to the floor's height, or their own, or the cut height", () => {
    let floor = room();
    floor = { ...floor, walls: floor.walls.map((wall, i) => (i === 0 ? { ...wall, height: 1 } : wall)) };
    const heights = (mesh: MeshData) => [...new Set(mesh.positions.filter((_, i) => i % 3 === 1))].sort();
    expect(heights(buildFloorMesh(floor, options).walls)).toEqual([0, 1, 2.4]);
    expect(heights(buildFloorMesh(floor, { ...options, maxWallHeight: 1.2 }).walls)).toEqual([0, 1, 1.2]);
  });

  it("covers the top of each wall exactly", () => {
    const mesh = buildFloorMesh(room(), options);
    const tops = triangles(mesh.walls).filter((triangle) => triangle.normal[1] === 1);
    expect(tops.reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(14 * 0.1);
    for (const triangle of tops) expect(triangle.colour).toEqual([0.2, 0.2, 0.2]);
  });

  it("paints each face of a wall for the room it looks into", () => {
    const makeId = counter();
    let floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), p([2, 0]), p([2, 3]), makeId);
    const [first, second] = floor.rooms;
    floor = {
      ...floor,
      rooms: [
        { ...first, wall_colour: "#ff0000", floor_style: "wood_light" },
        { ...second, wall_colour: "#0000ff" },
      ],
    };
    const mesh = buildFloorMesh(floor, options);
    const sides = triangles(mesh.walls).filter((triangle) => triangle.normal[1] === 0);
    const red = sides.filter((triangle) => triangle.colour[0] === 1 && triangle.colour[2] === 0);
    const blue = sides.filter((triangle) => triangle.colour[2] === 1 && triangle.colour[0] === 0);
    expect(red.length).toBeGreaterThan(0);
    expect(blue.length).toBeGreaterThan(0);

    // Every coloured face looks into the room of that colour: step off it
    // along its normal and you are inside that room.
    const inside = (triangle: Triangle, polygonOf: typeof first) => {
      const cx = (triangle.points[0][0] + triangle.points[1][0] + triangle.points[2][0]) / 3;
      const cz = (triangle.points[0][2] + triangle.points[1][2] + triangle.points[2][2]) / 3;
      const x = cx + triangle.normal[0] * 0.2;
      const y = cz + triangle.normal[2] * 0.2;
      const corners = polygonOf.boundary.map((id) => floor.vertices.find((v) => v.id === id)!);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      return x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys);
    };
    for (const triangle of red) expect(inside(triangle, first)).toBe(true);
    for (const triangle of blue) expect(inside(triangle, second)).toBe(true);

    // The outside of the house keeps the outside colour.
    const outside = sides.filter((triangle) => triangle.colour[0] === 0.9);
    expect(outside.length).toBeGreaterThan(0);
    // And the floors take their finish.
    const slabColours = new Set(triangles(mesh.slabs).map((triangle) => triangle.colour.join()));
    expect(slabColours).toEqual(new Set(["0.8,0.7,0.5", "0.5,0.5,0.5"]));
  });

  it("highlights the selected room", () => {
    const floor = room();
    const mesh = buildFloorMesh(floor, {
      ...options,
      highlightRoom: floor.rooms[0].id,
      highlightColour: [0, 1, 0],
    });
    for (const triangle of triangles(mesh.slabs)) expect(triangle.colour).toEqual([0, 1, 0]);
  });

  it("lifts a room inside a room a hair, so the floors do not flicker", () => {
    const makeId = counter();
    const floor = rectangle(rectangle(emptyFloor(), makeId, 0, 0, 10, 10), makeId, 4, 4, 2, 2);
    const heights = new Set(buildFloorMesh(floor, options).slabs.positions.filter((_, i) => i % 3 === 1));
    expect(heights).toEqual(new Set([0, 0.001]));
  });

  it("falls back to the default colour for an unknown finish", () => {
    let floor = room();
    floor = { ...floor, rooms: [{ ...floor.rooms[0], floor_style: "lava" }] };
    expect(triangles(buildFloorMesh(floor, options).slabs)[0].colour).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("hexColour", () => {
  it("reads a hex colour", () => {
    expect(hexColour("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexColour("#FFFFFF")).toEqual([1, 1, 1]);
  });

  it("gives grey for nonsense", () => {
    expect(hexColour("red")).toEqual([0.8, 0.8, 0.8]);
    expect(hexColour("#12")).toEqual([0.8, 0.8, 0.8]);
  });
});

describe("quality", () => {
  it.each([
    [{ cores: 16, memory: 8 }, "high"],
    [{ cores: 8, memory: 8, mobile: false }, "high"],
    [{ cores: 4, memory: 8 }, "medium"],
    [{ cores: 8, memory: 4 }, "medium"],
    [{}, "medium"],
    [{ cores: 8, memory: 8, mobile: true }, "medium"],
    [{ cores: 8, memory: 4, mobile: true }, "low"],
    [{ cores: 4, memory: 2, mobile: true }, "low"],
    [{ cores: 2, memory: 8 }, "low"],
    [{ cores: 16, memory: 16, saveData: true }, "low"],
  ] as const)("%j is %s", (hints, expected) => {
    expect(pickQuality(hints)).toBe(expected);
  });

  it("asks less of the device at each step down", () => {
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.maxPixelRatio).toBeLessThan(QUALITY.medium.maxPixelRatio);
    expect(QUALITY.medium.shadowMapSize).toBeLessThan(QUALITY.high.shadowMapSize);
  });

  it("recognises quality names", () => {
    expect(isQuality("low")).toBe(true);
    expect(isQuality("ultra")).toBe(false);
    expect(isQuality(undefined)).toBe(false);
  });
});

describe("wall parts", () => {
  it("gives each wall its own mesh, adding up to the whole", () => {
    const makeId = counter();
    const floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 4, 3), p([2, 0]), p([2, 3]), makeId);
    const mesh = buildFloorMesh(floor, options);
    expect(mesh.wallParts.map((part) => part.id).sort()).toEqual(floor.walls.map((wall) => wall.id).sort());
    const total = mesh.wallParts.reduce((sum, part) => sum + part.data.positions.length, 0);
    expect(total).toBe(mesh.walls.positions.length);
    for (const part of mesh.wallParts) {
      expectWellFormed(part.data);
      expect(part.height).toBe(2.4);
    }
    const divider = mesh.wallParts.find((part) => part.id === wallBetween(floor, [2, 0], [2, 3]))!;
    expect(divider.centre).toEqual([2, 1.5]);
  });
});
