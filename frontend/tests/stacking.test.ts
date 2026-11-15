import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findModel, type Catalogue } from "../src/core/catalogue";
import { clipConvex, polygonArea, signedArea, subtractConvex, type Point } from "../src/core/geometry";
import {
  deleteItems,
  duplicateItems,
  itemFootprint,
  itemScale,
  itemSize,
  moveItems,
  placeItem,
  resizeItem,
  rotateItems,
  stretchItemTo,
  updateItems,
} from "../src/core/items";
import { buildFloorMesh, type MeshOptions } from "../src/core/mesh";
import { doorLeaves, placeOpening, resizeOpening, updateOpening } from "../src/core/openings";
import type { Floor, House, Item } from "../src/core/scene";
import { restack, settleStacks, standsOnThings, supportAt, surfaceTop } from "../src/core/stacking";
import { floorBelow, stairHoles, stairsOn, stairwell } from "../src/core/stairwells";
import { floorsNeeded, resolveView } from "../src/core/views";
import { counter, emptyFloor, p, rectangle, wallBetween } from "./helpers";

const catalogue = JSON.parse(
  readFileSync(resolve(__dirname, "../../custom_components/diorama/assets/catalogue.json"), "utf8"),
) as Catalogue;
const model = (id: string) => findModel(catalogue, id)!;
const itemOf = (floor: Floor, id: string): Item => floor.items.find((item) => item.id === id)!;
const room = (): Floor => rectangle(emptyFloor(), counter(), 0, 0, 6, 4);
const area = (points: readonly Point[]) => polygonArea(points);
/** Ids that cannot clash with the ones `counter` makes. */
const fresh = () => {
  let next = 0;
  return (prefix: string) => `${prefix}_new${++next}`;
};

describe("stretching furniture", () => {
  const sofa = model("basics/sofa_2");

  it("has its model's size until it is stretched", () => {
    const { floor, id } = placeItem(room(), sofa.id, p([3, 2]));
    expect(itemSize(itemOf(floor, id), sofa)).toEqual({ width: sofa.width, depth: sofa.depth, height: sofa.height });
    expect(itemScale(itemOf(floor, id))).toEqual([1, 1, 1]);
  });

  it("is made a size one way without changing the others", () => {
    const placed = placeItem(room(), sofa.id, p([3, 2]));
    const floor = updateItems(placed.floor, new Set([placed.id]), (item) => resizeItem(item, sofa, "width", 3));
    const size = itemSize(itemOf(floor, placed.id), sofa);
    expect(size.width).toBeCloseTo(3);
    expect(size.depth).toBeCloseTo(sofa.depth);
    expect(size.height).toBeCloseTo(sofa.height);
    // Its outline on the plan follows, about the same middle.
    const xs = itemFootprint(itemOf(floor, placed.id), sofa).map((corner) => corner.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(3);
  });

  it("rounds the size it is dragged to, when asked", () => {
    const placed = placeItem(room(), sofa.id, p([3, 2]), 0, counter());
    const floor = updateItems(placed.floor, new Set([placed.id]), (item) =>
      stretchItemTo(item, sofa, "width", 1, p([5.012, 2]), 0.05),
    );
    const width = itemSize(itemOf(floor, placed.id), sofa).width;
    expect(Math.abs(width / 0.05 - Math.round(width / 0.05))).toBeLessThan(1e-4);
  });

  it("refuses a size that makes no sense", () => {
    const item = placeItem(room(), sofa.id, p([3, 2]), 0, counter()).floor.items[0];
    expect(resizeItem(item, sofa, "width", 0)).toEqual({});
    expect(resizeItem(item, sofa, "height", -1)).toEqual({});
    expect(resizeItem(item, sofa, "depth", 500)).toEqual({});
    expect(resizeItem(item, sofa, "depth", Number.NaN)).toEqual({});
  });

  it("follows one side as it is dragged, and keeps the other where it was", () => {
    const placed = placeItem(room(), sofa.id, p([3, 2]), 0, counter());
    const before = itemFootprint(itemOf(placed.floor, placed.id), sofa);
    const left = Math.min(...before.map((corner) => corner.x));
    const floor = updateItems(placed.floor, new Set([placed.id]), (item) =>
      stretchItemTo(item, sofa, "width", 1, p([5, 2])),
    );
    const after = itemFootprint(itemOf(floor, placed.id), sofa);
    expect(Math.min(...after.map((corner) => corner.x))).toBeCloseTo(left);
    expect(Math.max(...after.map((corner) => corner.x))).toBeCloseTo(5);
    // Front to back it is as it was.
    expect(Math.max(...after.map((corner) => corner.y)) - Math.min(...after.map((corner) => corner.y))).toBeCloseTo(sofa.depth);
  });

  it("does the same for a piece that has been turned", () => {
    const placed = placeItem(room(), sofa.id, p([3, 2]), 90, counter());
    const before = itemFootprint(itemOf(placed.floor, placed.id), sofa);
    const floor = updateItems(placed.floor, new Set([placed.id]), (item) =>
      stretchItemTo(item, sofa, "depth", -1, p([5, 2])),
    );
    const after = itemFootprint(itemOf(floor, placed.id), sofa);
    // Turned a quarter, its back is to the right: that is the side that moved.
    expect(Math.max(...after.map((corner) => corner.x))).toBeCloseTo(5);
    expect(Math.min(...after.map((corner) => corner.x))).toBeCloseTo(Math.min(...before.map((corner) => corner.x)));
  });

  it("cannot be dragged through itself", () => {
    const placed = placeItem(room(), sofa.id, p([3, 2]), 0, counter());
    const floor = updateItems(placed.floor, new Set([placed.id]), (item) =>
      stretchItemTo(item, sofa, "width", 1, p([-20, 2])),
    );
    expect(itemSize(itemOf(floor, placed.id), sofa).width).toBeCloseTo(0.05);
  });
});

describe("standing things on furniture", () => {
  const table = model("basics/dining_table");
  const lamp = model("basics/table_lamp");
  const laid = () => {
    const makeId = counter();
    const withTable = placeItem(room(), table.id, p([3, 2]), 0, makeId);
    const withLamp = placeItem(withTable.floor, lamp.id, p([3.2, 2.1]), 0, makeId);
    return { floor: restack(withLamp.floor, catalogue, new Set([withLamp.id])), table: withTable.id, lamp: withLamp.id };
  };

  it("knows what goes on what", () => {
    expect(standsOnThings(lamp)).toBe(true);
    expect(standsOnThings(table)).toBe(false);
    expect(standsOnThings(model("basics/chair"))).toBe(false);
    expect(standsOnThings(undefined)).toBe(false);
    expect(table.surface).toBe(true);
    // A small model someone added counts; a big one does not.
    const own = { ...lamp, source: "user", tabletop: undefined };
    expect(standsOnThings(own)).toBe(true);
    expect(standsOnThings({ ...own, width: 2 })).toBe(false);
  });

  it("puts a lamp dropped on a table on top of it", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    expect(itemOf(floor, lampId)).toMatchObject({ on: tableId, z: table.height });
    expect(supportAt(floor, catalogue, p([3, 2]))?.id).toBe(tableId);
    expect(supportAt(floor, catalogue, p([0.3, 0.3]))).toBeUndefined();
  });

  it("leaves a chair on the floor", () => {
    const makeId = counter();
    const withTable = placeItem(room(), table.id, p([3, 2]), 0, makeId);
    const withChair = placeItem(withTable.floor, "basics/chair", p([3, 2]), 0, makeId);
    const floor = restack(withChair.floor, catalogue, new Set([withChair.id]));
    expect(itemOf(floor, withChair.id)).toMatchObject({ on: null, z: 0 });
  });

  it("takes it with the table when the table moves or turns", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    const moved = moveItems(floor, new Map([[tableId, p([4, 3])]]));
    expect(itemOf(moved, lampId)).toMatchObject({ x: 4.2, y: 3.1, on: tableId });
    const turned = rotateItems(floor, new Set([tableId]), 90);
    // A quarter turn clockwise about the table: (0.2, 0.1) becomes (-0.1, 0.2).
    expect(itemOf(turned, lampId).x).toBeCloseTo(2.9);
    expect(itemOf(turned, lampId).y).toBeCloseTo(2.2);
    expect(itemOf(turned, lampId).rotation).toBe(90);
  });

  it("is not moved twice when both are dragged together", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    const moved = moveItems(floor, new Map([[tableId, p([4, 3])], [lampId, p([4.2, 3.1])]]));
    expect(itemOf(moved, lampId)).toMatchObject({ x: 4.2, y: 3.1 });
  });

  it("goes back to the floor when dragged off, or when the table is deleted", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    const off = restack(moveItems(floor, new Map([[lampId, p([0.5, 0.5])]])), catalogue, new Set([lampId]));
    expect(itemOf(off, lampId)).toMatchObject({ on: null, z: 0 });
    expect(itemOf(deleteItems(floor, new Set([tableId])), lampId)).toMatchObject({ on: null, z: 0 });
  });

  it("stays on top when the table is made taller", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    const taller = updateItems(floor, new Set([tableId]), (item) => resizeItem(item, table, "height", 1.1));
    expect(itemOf(taller, lampId).z).toBe(table.height);
    const settled = settleStacks(taller, catalogue);
    expect(itemOf(settled, lampId).z).toBeCloseTo(1.1);
    expect(surfaceTop(itemOf(settled, tableId), table)).toBeCloseTo(1.1);
    // Nothing to do: the very same floor.
    expect(settleStacks(settled, catalogue)).toBe(settled);
  });

  it("uses the worktop of a desk, not the top of its monitor", () => {
    const makeId = counter();
    const desk = model("basics/desk");
    const withDesk = placeItem(room(), desk.id, p([3, 2]), 0, makeId);
    const withLamp = placeItem(withDesk.floor, lamp.id, p([3, 2]), 0, makeId);
    const floor = restack(withLamp.floor, catalogue, new Set([withLamp.id]));
    expect(itemOf(floor, withLamp.id).z).toBe(desk.surface_height);
    expect(desk.surface_height).toBeLessThan(desk.height);
  });

  it("does not stack on something that is itself on something", () => {
    const { floor, lamp: lampId } = laid();
    expect(supportAt(floor, catalogue, itemOf(floor, lampId))?.id).not.toBe(lampId);
  });

  it("copies a lamp with its table onto the copy of the table", () => {
    const { floor, table: tableId, lamp: lampId } = laid();
    const copied = duplicateItems(floor, new Set([tableId, lampId]), 0.3, fresh());
    const [tableCopy, lampCopy] = copied.ids;
    expect(itemOf(copied.floor, lampCopy).on).toBe(tableCopy);
    // A copy of the lamp alone stays on the first table.
    const alone = duplicateItems(floor, new Set([lampId]), 0.1, fresh());
    expect(itemOf(alone.floor, alone.ids[0]).on).toBe(tableId);
  });

  it("puts wall pieces up at their height", () => {
    const unit = model("kenney/wall_unit");
    expect(unit.mount_height).toBeGreaterThan(1);
    const placed = placeItem(room(), unit.id, p([3, 0.2]), 0, counter(), unit.mount_height);
    expect(itemOf(placed.floor, placed.id).z).toBe(unit.mount_height);
  });
});

describe("doors", () => {
  const withDoor = () => {
    const floor = room();
    const wall = wallBetween(floor, [0, 0], [6, 0])!;
    const placed = placeOpening(floor, wall, "door", p([3, 0]), fresh());
    return { floor: placed.floor, id: placed.id!, wall };
  };

  it("has one leaf, hung from the start, to begin with", () => {
    const { floor, id } = withDoor();
    const door = floor.openings.find((opening) => opening.id === id)!;
    expect(door).toMatchObject({ leaves: 1, hinge: "start", swing: 1 });
    expect(doorLeaves(door)).toEqual([{ hinge: door.offset, width: door.width, towards: 1 }]);
  });

  it("can be hung from the other end, or have two leaves", () => {
    const { floor, id } = withDoor();
    const door = floor.openings.find((opening) => opening.id === id)!;
    const far = door.offset + door.width;
    expect(doorLeaves({ ...door, hinge: "end" })).toEqual([{ hinge: far, width: door.width, towards: -1 }]);
    expect(doorLeaves({ ...door, leaves: 2 })).toEqual([
      { hinge: door.offset, width: door.width / 2, towards: 1 },
      { hinge: far, width: door.width / 2, towards: -1 },
    ]);
  });

  it("has no leaves as an archway or a window", () => {
    const { floor, id } = withDoor();
    const arch = updateOpening(floor, id, { type: "archway" }).openings[0];
    expect(arch).toMatchObject({ type: "archway", sill: 0 });
    // Still the size it was: only a window starts again.
    expect(arch.height).toBe(2);
    expect(doorLeaves(arch)).toEqual([]);
    expect(doorLeaves(updateOpening(floor, id, { type: "window" }).openings[0])).toEqual([]);
    expect(updateOpening(floor, id, { type: "window" }).openings[0].sill).toBeGreaterThan(0);
  });

  it("is widened by dragging an end, the other staying put", () => {
    const { floor, id } = withDoor();
    const door = floor.openings[0];
    const far = door.offset + door.width;
    const wider = resizeOpening(floor, id, "end", p([4.52, 0.3])).openings[0];
    expect(wider.offset).toBe(door.offset);
    expect(wider.offset + wider.width).toBeCloseTo(4.5);
    const fromStart = resizeOpening(floor, id, "start", p([1, -0.2])).openings[0];
    expect(fromStart.offset).toBeCloseTo(1);
    expect(fromStart.offset + fromStart.width).toBeCloseTo(far);
  });

  it("stays on its wall and never gets too narrow", () => {
    const { floor, id } = withDoor();
    const door = floor.openings[0];
    expect(resizeOpening(floor, id, "end", p([40, 0])).openings[0].width).toBeCloseTo(6 - door.offset);
    expect(resizeOpening(floor, id, "start", p([-40, 0])).openings[0].offset).toBe(0);
    expect(resizeOpening(floor, id, "end", p([0, 0])).openings[0].width).toBeCloseTo(0.3);
    expect(resizeOpening(floor, id, "start", p([40, 0])).openings[0].width).toBeCloseTo(0.3);
    expect(resizeOpening(floor, "nope", "end", p([4, 0]))).toBe(floor);
  });
});

describe("cutting convex shapes", () => {
  const square: Point[] = [p([0, 0]), p([4, 0]), p([4, 4]), p([0, 4])];

  it("keeps the half of a shape on one side of a line", () => {
    const left = clipConvex(square, p([1, 0]), p([1, 4]), true);
    const right = clipConvex(square, p([1, 0]), p([1, 4]), false);
    expect(area(left) + area(right)).toBeCloseTo(16);
    expect(Math.min(area(left), area(right))).toBeCloseTo(4);
    // A line that misses it keeps all of it on one side and none on the other.
    const sides = [true, false].map((keep) => clipConvex(square, p([9, 0]), p([9, 4]), keep).length);
    expect(sides.sort()).toEqual([0, 4]);
  });

  it("takes a hole out of the middle, leaving the rest", () => {
    const hole: Point[] = [p([1, 1]), p([3, 1]), p([3, 2]), p([1, 2])];
    const pieces = subtractConvex(square, hole);
    expect(pieces.reduce((sum, piece) => sum + area(piece), 0)).toBeCloseTo(14);
    // Wound the same way as what they were cut from.
    for (const piece of pieces) expect(Math.sign(signedArea(piece))).toBe(Math.sign(signedArea(square)));
    // The other way round, the hole is the same hole.
    const reversed = subtractConvex(square, [...hole].reverse());
    expect(reversed.reduce((sum, piece) => sum + area(piece), 0)).toBeCloseTo(14);
  });

  it("copes with a hole that hangs over the edge, misses, or swallows it", () => {
    const over: Point[] = [p([3, 1]), p([6, 1]), p([6, 2]), p([3, 2])];
    expect(subtractConvex(square, over).reduce((sum, piece) => sum + area(piece), 0)).toBeCloseTo(15);
    const miss: Point[] = [p([10, 10]), p([11, 10]), p([11, 11]), p([10, 11])];
    expect(subtractConvex(square, miss).reduce((sum, piece) => sum + area(piece), 0)).toBeCloseTo(16);
    const all: Point[] = [p([-1, -1]), p([5, -1]), p([5, 5]), p([-1, 5])];
    expect(subtractConvex(square, all)).toEqual([]);
  });
});

describe("stairs and the floor above", () => {
  const options: MeshOptions = {
    floorColours: { default: [0.5, 0.5, 0.5] },
    outsideColour: [0.9, 0.9, 0.9],
    wallTopColour: [0.2, 0.2, 0.2],
  };
  const slabArea = (floor: Floor, extra: Partial<MeshOptions> = {}) => {
    const positions = buildFloorMesh(floor, { ...options, ...extra }).slabs.positions;
    let total = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, , az, bx, , bz, cx, , cz] = positions.slice(i, i + 9);
      total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    return total;
  };
  const stairs = model("basics/stairs");
  const house: House = {
    schema_version: 1,
    revision: 1,
    settings: { name: "Home" },
    floors: [
      { id: "up", name: "Up", elevation: 2.7, ha_floor_id: null },
      { id: "down", name: "Down", elevation: 0, ha_floor_id: null },
      { id: "cellar", name: "Cellar", elevation: -2.4, ha_floor_id: null },
    ],
    cameras: [],
  };
  const down = (): Floor => placeItem(rectangle(emptyFloor("down"), counter(), 0, 0, 6, 4), stairs.id, p([3, 2]), 0, fresh()).floor;
  const up = (): Floor => rectangle(emptyFloor("up"), counter(), 0, 0, 6, 4);

  it("finds the floor directly under another", () => {
    expect(floorBelow(house, "up")?.id).toBe("down");
    expect(floorBelow(house, "down")?.id).toBe("cellar");
    expect(floorBelow(house, "cellar")).toBeUndefined();
    expect(floorBelow(house, "nope")).toBeUndefined();
  });

  it("knows which furniture is stairs, and the holes they make", () => {
    const floor = down();
    expect(stairsOn(floor, catalogue).map((item) => item.model)).toEqual([stairs.id]);
    const [hole] = stairHoles(floor, catalogue);
    expect(area(hole)).toBeCloseTo(stairs.width * stairs.depth);
    const whole = updateItems(floor, new Set([floor.items[0].id]), () => ({ cut_above: false }));
    expect(stairHoles(whole, catalogue)).toEqual([]);
    expect(stairsOn(whole, catalogue)).toHaveLength(1);
  });

  it("leaves the hole out of the floor above", () => {
    const [hole] = stairHoles(down(), catalogue);
    expect(slabArea(up())).toBeCloseTo(24);
    expect(slabArea(up(), { holes: [hole] })).toBeCloseTo(24 - stairs.width * stairs.depth);
  });

  it("draws no floor in a room that is open to the one below", () => {
    const floor = up();
    expect(slabArea({ ...floor, rooms: floor.rooms.map((one) => ({ ...one, open: true })) })).toBe(0);
  });

  it("gives a floor shown alone its holes and the stairs coming up", () => {
    const loaded = new Map([["up", up()], ["down", down()]]);
    const well = stairwell(house, "up", loaded, catalogue);
    expect(well.holes).toHaveLength(1);
    expect(well.below).toMatchObject({ drop: 2.7 });
    expect(well.below!.items).toHaveLength(1);
    // Nothing under the lowest floor, nothing without the catalogue or the floor.
    expect(stairwell(house, "cellar", loaded, catalogue)).toEqual({ holes: [] });
    expect(stairwell(house, "up", loaded, undefined)).toEqual({ holes: [] });
    expect(stairwell(house, "up", new Map([["up", up()]]), catalogue)).toEqual({ holes: [] });
    expect(stairwell(house, "down", new Map([["down", down()], ["cellar", up()]]), catalogue)).toEqual({ holes: [] });
  });

  it("asks for the floor below a single floor, and shows the stairs through it", () => {
    expect(floorsNeeded(house, { view: "floor", floor: "up" })).toEqual(["up", "down"]);
    expect(floorsNeeded(house, { view: "floor", floor: "cellar" })).toEqual(["cellar"]);
    expect(floorsNeeded(house, { view: "house" })).toEqual(["up", "down", "cellar"]);
    const loaded = new Map([["up", up()], ["down", down()]]);
    const view = resolveView(house, loaded, { view: "floor", floor: "up" }, catalogue);
    expect(view).toMatchObject({ status: "ready" });
    if (view.status !== "ready") return;
    expect(view.floors).toHaveLength(1);
    expect(view.floors[0].holes).toHaveLength(1);
    expect(view.floors[0].below?.drop).toBe(2.7);
    // Before the floor below has arrived it is simply shown whole.
    const early = resolveView(house, new Map([["up", up()]]), { view: "floor", floor: "up" }, catalogue);
    expect(early.status === "ready" && early.floors[0].holes).toBeUndefined();
  });

  it("cuts each floor of the house for the stairs of the one under it", () => {
    const loaded = new Map([["up", up()], ["down", down()], ["cellar", rectangle(emptyFloor("cellar"), counter(), 0, 0, 6, 4)]]);
    const view = resolveView(house, loaded, { view: "house" }, catalogue);
    if (view.status !== "ready") throw new Error("not ready");
    const byId = new Map(view.floors.map((shown) => [shown.floor.id, shown]));
    expect(byId.get("up")!.holes).toHaveLength(1);
    expect(byId.get("down")!.holes).toEqual([]);
    expect(byId.get("cellar")!.holes).toBeUndefined();
    // The stairs are drawn with their own floor, not a second time.
    expect(byId.get("up")!.below).toBeUndefined();
  });
});
