import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categories,
  findModel,
  modelUrl,
  searchModels,
  type Catalogue,
  type CatalogueModel,
} from "../src/core/catalogue";
import {
  assignItemRooms,
  deleteItems,
  duplicateItems,
  itemFootprint,
  moveItems,
  normaliseRotation,
  placeItem,
  roomAt,
  rotateItems,
  snapToWall,
} from "../src/core/items";
import { polygonArea, polygonCentroid } from "../src/core/geometry";
import { addWall, deleteWalls } from "../src/core/plan";
import type { Floor, Item } from "../src/core/scene";
import { counter, emptyFloor, p, rectangle, wallBetween, ITEM_DEFAULTS } from "./helpers";

// The real catalogue, as the integration serves it.
const catalogue: Catalogue = {
  ...JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../custom_components/diorama/assets/catalogue.json"), "utf8"),
  ),
  base_url: "/diorama_assets/1.2.3",
};
const sofa = findModel(catalogue, "basics/sofa_2")!;
const bed = findModel(catalogue, "basics/bed_double")!;

const item = (change: Partial<Item> = {}): Item => ({
  id: "i1",
  model: "basics/sofa_2",
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  scale: 1,
  room: null,
  ...ITEM_DEFAULTS,
  ...change,
});

describe("catalogue", () => {
  it("builds the address of a model file", () => {
    expect(modelUrl(catalogue, sofa)).toBe("/diorama_assets/1.2.3/models/basics/sofa_2.glb");
  });

  it("lists categories in catalogue order", () => {
    expect(categories(catalogue).slice(0, 3)).toEqual(["Living room", "Lighting", "Kitchen and dining"]);
  });

  it("searches names, tags and categories, needing every word", () => {
    const couches = searchModels(catalogue, "couch").map((m) => m.id);
    expect(couches.slice(0, 2)).toEqual(["basics/sofa_2", "basics/sofa_3"]);
    expect(couches).toContain("kenney/sofa_corner");
    expect(couches.every((id) => id.includes("sofa"))).toBe(true);
    expect(searchModels(catalogue, "BED king").map((m) => m.id)).toEqual(["basics/bed_king"]);
    expect(searchModels(catalogue, "bathroom").length).toBeGreaterThan(3);
    expect(searchModels(catalogue, "sofa lava")).toEqual([]);
    expect(searchModels(catalogue, "  ")).toBe(catalogue.models);
  });

  it("does not find a model it does not have", () => {
    expect(findModel(catalogue, "basics/throne")).toBeUndefined();
  });
});

describe("itemFootprint", () => {
  const box = (points: { x: number; y: number }[]) => ({
    minX: Math.min(...points.map((q) => q.x)),
    maxX: Math.max(...points.map((q) => q.x)),
    minY: Math.min(...points.map((q) => q.y)),
    maxY: Math.max(...points.map((q) => q.y)),
  });

  it("is the model's width and depth, centred, with the front down the plan", () => {
    const outline = itemFootprint(item({ x: 5, y: 3 }), sofa);
    expect(outline).toHaveLength(4);
    const { minX, maxX, minY, maxY } = box(outline);
    expect(maxX - minX).toBeCloseTo(sofa.width);
    expect(maxY - minY).toBeCloseTo(sofa.depth);
    expect((minX + maxX) / 2).toBeCloseTo(5);
    // Back corners first, then front: the front is at larger y.
    expect(outline[0].y).toBeLessThan(outline[2].y);
  });

  it("turns clockwise: at 90 degrees the front faces left", () => {
    const outline = itemFootprint(item({ rotation: 90 }), sofa);
    const { minX, maxX, minY, maxY } = box(outline);
    expect(maxX - minX).toBeCloseTo(sofa.depth);
    expect(maxY - minY).toBeCloseTo(sofa.width);
    expect(outline[2].x).toBeLessThan(outline[0].x);
  });

  it("allows for a model whose box is off its origin", () => {
    // The bed's headboard sticks out behind its origin.
    expect(bed.centre[1]).toBeLessThan(0);
    const outline = itemFootprint(item({ model: bed.id }), bed);
    expect(polygonCentroid(outline).y).toBeCloseTo(bed.centre[1]);
    expect(polygonArea(outline)).toBeCloseTo(bed.width * bed.depth);
  });

  it("scales", () => {
    const outline = itemFootprint(item({ scale: 2 }), sofa);
    expect(polygonArea(outline)).toBeCloseTo(sofa.width * sofa.depth * 4);
  });

  it("gives an unknown model a half-metre square", () => {
    expect(polygonArea(itemFootprint(item({ x: 1, y: 1 }), undefined))).toBeCloseTo(0.25);
  });
});

describe("normaliseRotation", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [-180, 180],
    [270, -90],
    [-270, 90],
    [725, 5],
    [-15, -15],
  ])("%i -> %i", (input, expected) => {
    expect(normaliseRotation(input)).toBe(expected);
  });
});

describe("placing and changing items", () => {
  const house = (): Floor => {
    const makeId = counter();
    return addWall(rectangle(emptyFloor(), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
  };
  const leftRoom = (floor: Floor) => roomAt(floor, { x: 1, y: 1 })!;
  const rightRoom = (floor: Floor) => roomAt(floor, { x: 7, y: 1 })!;

  it("knows which room a point is in", () => {
    const floor = house();
    expect(leftRoom(floor)).not.toBe(rightRoom(floor));
    expect(roomAt(floor, { x: 20, y: 20 })).toBeNull();
  });

  it("places an item in the room it lands in", () => {
    const floor = house();
    const placed = placeItem(floor, sofa.id, { x: 1.23456789, y: 2 }, 450, counter());
    expect(placed.id).toBe("i1");
    expect(placed.floor.items).toEqual([
      { id: "i1", model: sofa.id, x: 1.2346, y: 2, z: 0, rotation: 90, scale: 1, room: leftRoom(floor) , ...ITEM_DEFAULTS},
    ]);
    expect(floor.items).toEqual([]);
  });

  it("moves items, and their room follows", () => {
    let floor = house();
    floor = placeItem(floor, sofa.id, { x: 1, y: 2 }, 0, counter()).floor;
    const moved = moveItems(floor, new Map([["i1", { x: 6, y: 2 }]]));
    expect(moved.items[0]).toMatchObject({ x: 6, y: 2, room: rightRoom(floor) });
    expect(moveItems(moved, new Map([["i1", { x: 30, y: 2 }]])).items[0].room).toBeNull();
  });

  it("returns the same floor when nothing changes", () => {
    const floor = placeItem(house(), sofa.id, { x: 1, y: 2 }, 0, counter()).floor;
    expect(moveItems(floor, new Map([["i1", { x: 1, y: 2 }]]))).toBe(floor);
    expect(rotateItems(floor, new Set(["nope"]), 15)).toBe(floor);
    expect(deleteItems(floor, new Set(["nope"]))).toBe(floor);
    expect(duplicateItems(floor, new Set(["nope"])).floor).toBe(floor);
  });

  it("rotates in steps and wraps round", () => {
    let floor = placeItem(house(), sofa.id, { x: 1, y: 2 }, 170, counter()).floor;
    floor = rotateItems(floor, new Set(["i1"]), 15);
    expect(floor.items[0].rotation).toBe(-175);
    floor = rotateItems(floor, new Set(["i1"]), -15);
    expect(floor.items[0].rotation).toBe(170);
  });

  it("duplicates beside the original with new ids", () => {
    const makeId = counter();
    let floor = house();
    floor = placeItem(floor, sofa.id, { x: 1, y: 2 }, 30, makeId).floor;
    floor = placeItem(floor, bed.id, { x: 3.9, y: 2 }, 0, makeId).floor;
    const result = duplicateItems(floor, new Set(["i1", "i2"]), 0.3, makeId);
    expect(result.ids).toEqual(["i3", "i4"]);
    expect(result.floor.items).toHaveLength(4);
    expect(result.floor.items[2]).toMatchObject({ model: sofa.id, x: 1.3, y: 2.3, rotation: 30 });
    // The copy of the bed landed the other side of the dividing wall.
    expect(result.floor.items[3].room).toBe(rightRoom(floor));
  });

  it("deletes items and frees fixtures that used them", () => {
    let floor = placeItem(house(), "basics/floor_lamp", { x: 1, y: 2 }, 0, counter()).floor;
    floor = {
      ...floor,
      fixtures: [
        { id: "x1", entity_id: "light.lamp", kind: "light", x: 1, y: 2, z: 0, room: null, item: "i1", model: null, options: {} },
      ],
    };
    const result = deleteItems(floor, new Set(["i1"]));
    expect(result.items).toEqual([]);
    expect(result.fixtures[0].item).toBeNull();
  });

  it("moves furniture to the right room when a wall is added or removed", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 8, 4);
    const whole = floor.rooms[0].id;
    floor = placeItem(floor, sofa.id, { x: 7, y: 2 }, 0, makeId).floor;
    expect(floor.items[0].room).toBe(whole);

    floor = addWall(floor, p([4, 0]), p([4, 4]), makeId);
    const right = roomAt(floor, { x: 7, y: 2 });
    expect(floor.items[0].room).toBe(right);

    floor = deleteWalls(floor, new Set([wallBetween(floor, [4, 0], [4, 4])]), makeId);
    expect(floor.rooms).toHaveLength(1);
    expect(floor.items[0].room).toBe(floor.rooms[0].id);
    expect(assignItemRooms(floor)).toBe(floor);
  });
});

describe("snapToWall", () => {
  const room = rectangle(emptyFloor(), counter(), 0, 0, 6, 4);
  const model = (change: Partial<CatalogueModel> = {}): CatalogueModel => ({ ...sofa, ...change });

  it("puts the back flat against the wall, facing into the room", () => {
    // Near the top wall (y = 0), inside the room.
    const snapped = snapToWall(room, { x: 2, y: 0.3 }, sofa, 1, 0.2)!;
    expect(snapped.rotation).toBe(0);
    expect(snapped.point.x).toBeCloseTo(2);
    // Wall face at 0.05, then half the sofa's depth.
    expect(snapped.point.y).toBeCloseTo(0.05 + sofa.depth / 2);
    const outline = itemFootprint({ ...item(), ...snapped.point, rotation: snapped.rotation }, sofa);
    expect(Math.min(...outline.map((q) => q.y))).toBeCloseTo(0.05);
  });

  it.each([
    [{ x: 3, y: 3.8 }, 180],
    [{ x: 0.3, y: 2 }, -90],
    [{ x: 5.7, y: 2 }, 90],
  ])("faces away from whichever wall it is against: %j", (pointer, rotation) => {
    const snapped = snapToWall(room, pointer, sofa, 1, 0.2)!;
    expect(snapped.rotation).toBe(rotation);
    const outline = itemFootprint({ ...item(), ...snapped.point, rotation: snapped.rotation }, sofa);
    for (const corner of outline) {
      expect(corner.x).toBeGreaterThan(0.049);
      expect(corner.x).toBeLessThan(5.951);
      expect(corner.y).toBeGreaterThan(0.049);
      expect(corner.y).toBeLessThan(3.951);
    }
  });

  it("works from outside the house too", () => {
    const snapped = snapToWall(room, { x: 2, y: -0.3 }, sofa, 1, 0.2)!;
    expect(snapped.rotation).toBe(180);
    expect(snapped.point.y).toBeCloseTo(-0.05 - sofa.depth / 2);
  });

  it("allows for a model whose box is off its origin", () => {
    const snapped = snapToWall(room, { x: 2, y: 0.5 }, bed, 1, 0.2)!;
    const outline = itemFootprint({ ...item({ model: bed.id }), ...snapped.point, rotation: snapped.rotation }, bed);
    expect(Math.min(...outline.map((q) => q.y))).toBeCloseTo(0.05);
  });

  it("leaves the pointer alone in the middle of the room", () => {
    expect(snapToWall(room, { x: 3, y: 2 }, sofa, 1, 0.2)).toBeUndefined();
  });

  it("ignores a wall whose end the pointer is beyond", () => {
    expect(snapToWall(room, { x: 6.4, y: -0.3 }, model({ depth: 0.2 }), 1, 0.2)).toBeUndefined();
  });

  it("picks the nearer of two walls in a corner", () => {
    const snapped = snapToWall(room, { x: 0.4, y: 0.2 }, sofa, 1, 0.2)!;
    expect(snapped.rotation).toBe(0);
  });
});
