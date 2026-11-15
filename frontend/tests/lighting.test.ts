import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findModel, type Catalogue } from "../src/core/catalogue";
import {
  fillRoom,
  fittingsSharing,
  fixtureHeight,
  MAX_FILL,
  placeFixture,
  stripLight,
  updateFixtures,
} from "../src/core/fixtures";
import {
  duplicateItems,
  itemFootprint,
  itemSize,
  moveItems,
  pickFootprint,
  placeItem,
  resizeItem,
  updateItems,
} from "../src/core/items";
import { doorLeaves, placeOpening, slidingPanels, updateOpening } from "../src/core/openings";
import { addWall } from "../src/core/plan";
import type { Fixture, Floor, Item } from "../src/core/scene";
import { restack, settleStacks, unitOver } from "../src/core/stacking";
import { counter, emptyFloor, p, rectangle } from "./helpers";

const catalogue = JSON.parse(
  readFileSync(resolve(__dirname, "../../custom_components/diorama/assets/catalogue.json"), "utf8"),
) as Catalogue;
const model = (id: string) => findModel(catalogue, id)!;
const itemOf = (floor: Floor, id: string): Item => floor.items.find((item) => item.id === id)!;
const room = (): Floor => rectangle(emptyFloor(), counter(), 0, 0, 6, 4);
const fresh = () => {
  let next = 0;
  return (prefix: string) => `${prefix}_new${++next}`;
};

describe("downlights", () => {
  const downlight = model("basics/downlight");
  const one = () => {
    const placed = placeFixture(room(), catalogue, "light.kitchen", "light", p([1, 1]), counter());
    const floor = updateFixtures(placed.floor, new Set([placed.id]), () => ({ model: downlight.id, z: 0 }));
    return { floor, id: placed.id };
  };

  it("is a small thing in the ceiling, lit from there", () => {
    expect(downlight).toMatchObject({ kind: "light", hanging: true });
    expect(downlight.width).toBeLessThan(0.15);
    const { floor, id } = one();
    const fixture = floor.fixtures.find((candidate) => candidate.id === id)!;
    expect(fixtureHeight(fixture, floor, catalogue)).toBeCloseTo(2.38);
    // A pendant still hangs half a metre below the ceiling.
    expect(fixtureHeight({ ...fixture, model: "basics/ceiling_light" }, floor, catalogue)).toBeCloseTo(1.9);
  });

  it("fills its room with evenly spaced rows and columns, all on the same light", () => {
    const { floor, id } = one();
    const filled = fillRoom(floor, id, 2, 3, fresh());
    expect(filled.ids).toHaveLength(6);
    expect(filled.ids[0]).toBe(id);
    const spots = filled.floor.fixtures.map((fixture) => [fixture.x, fixture.y]);
    expect(spots).toEqual([[1, 1], [3, 1], [5, 1], [1, 3], [3, 3], [5, 3]]);
    for (const fixture of filled.floor.fixtures) {
      expect(fixture).toMatchObject({ entity_id: "light.kitchen", kind: "light", model: downlight.id });
      expect(fixture.room).toBe(floor.rooms[0].id);
    }
    expect(new Set(filled.floor.fixtures.map((fixture) => fixture.id)).size).toBe(6);
  });

  it("replaces the ones like it when filled again, and leaves other lights alone", () => {
    const { floor, id } = one();
    const makeId = fresh();
    const lamp = placeFixture(floor, catalogue, "light.lamp", "light", p([2, 2]), makeId);
    const first = fillRoom(lamp.floor, id, 2, 3, makeId);
    const again = fillRoom(first.floor, id, 1, 2, makeId);
    const kitchen = again.floor.fixtures.filter((fixture) => fixture.entity_id === "light.kitchen");
    expect(kitchen.map((fixture) => [fixture.x, fixture.y])).toEqual([[1.5, 2], [4.5, 2]]);
    expect(again.floor.fixtures.filter((fixture) => fixture.entity_id === "light.lamp")).toHaveLength(1);
  });

  it("leaves out the spots that fall outside an L-shaped room", () => {
    const makeId = counter();
    // 6 by 4, with the bottom right quarter walled off as another room.
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 6, 4);
    floor = addWall(floor, p([3, 2]), p([6, 2]), makeId);
    floor = addWall(floor, p([3, 2]), p([3, 4]), makeId);
    const big = floor.rooms.reduce((a, b) => (a.boundary.length >= b.boundary.length ? a : b));
    const placed = placeFixture(floor, catalogue, "light.l", "light", p([1, 1]), makeId);
    expect(placed.floor.fixtures[0].room).toBe(big.id);
    const filled = fillRoom(placed.floor, placed.id, 2, 2, fresh());
    expect(filled.ids).toHaveLength(3);
    expect(filled.floor.fixtures.every((fixture) => fixture.room === big.id)).toBe(true);
  });

  it("does nothing for nonsense, or a light that is a lamp, or one in no room", () => {
    const { floor, id } = one();
    expect(fillRoom(floor, id, 0, 3).floor).toBe(floor);
    expect(fillRoom(floor, id, 20, 20).floor).toBe(floor);
    expect(20 * 20).toBeGreaterThan(MAX_FILL);
    expect(fillRoom(floor, "nope", 2, 2).floor).toBe(floor);
    const outside = updateFixtures(floor, new Set([id]), () => ({ x: 50, y: 50 }));
    expect(fillRoom(outside, id, 2, 2).floor).toBe(outside);
    const makeId = counter();
    const withLamp = placeItem(room(), "basics/floor_lamp", p([1, 1]), 0, makeId);
    const bound = placeFixture(withLamp.floor, catalogue, "light.lamp", "light", p([1, 1]), makeId);
    expect(bound.floor.fixtures[0].item).toBe(withLamp.id);
    expect(fillRoom(bound.floor, bound.id, 2, 2).floor).toBe(bound.floor);
  });

  it("counts the fittings that share a light in a room", () => {
    const { floor, id } = one();
    const makeId = fresh();
    const filled = fillRoom(floor, id, 2, 2, makeId);
    const lamp = placeFixture(filled.floor, catalogue, "light.lamp", "light", p([2, 2]), makeId);
    const sharing = fittingsSharing(lamp.floor.fixtures);
    for (const fitting of filled.ids) expect(sharing.get(fitting)).toBe(4);
    expect(sharing.get(lamp.id)).toBe(1);
    // The same light in another room is counted on its own.
    const elsewhere: Fixture = { ...lamp.floor.fixtures[0], id: "far", room: "another" };
    expect(fittingsSharing([...lamp.floor.fixtures, elsewhere]).get("far")).toBe(1);
  });
});

describe("strip lights", () => {
  const strip = model("basics/led_strip");
  const unit = model("kenney/wall_unit");
  const kitchen = () => {
    const makeId = counter();
    const base = placeItem(room(), "kenney/base_unit_door", p([2, 0.36]), 0, makeId);
    const wall = placeItem(base.floor, unit.id, p([2, 0.225]), 0, makeId, unit.mount_height);
    const light = placeItem(wall.floor, strip.id, p([2.1, 0.2]), 0, makeId);
    return { floor: restack(light.floor, catalogue, new Set([light.id])), base: base.id, wall: wall.id, strip: light.id };
  };

  it("is a thin light that can be stretched", () => {
    expect(strip).toMatchObject({ kind: "light", strip: true });
    expect(strip.depth).toBeLessThan(0.05);
  });

  it("fixes itself under a wall unit it is dropped on, as long as the unit is wide", () => {
    const { floor, wall, strip: id } = kitchen();
    const fixed = itemOf(floor, id);
    const over = itemOf(floor, wall);
    expect(fixed.on).toBe(wall);
    expect(fixed.x).toBeCloseTo(over.x);
    expect(fixed.y).toBeCloseTo(over.y);
    expect(fixed.z).toBeCloseTo(unit.mount_height! - strip.height);
    expect(itemSize(fixed, strip).width).toBeCloseTo(unit.width);
    expect(unitOver(floor, catalogue, p([2, 0.2]))?.id).toBe(wall);
    expect(unitOver(floor, catalogue, p([4, 3]))).toBeUndefined();
  });

  it("goes with the unit, and stays under it when the unit is raised", () => {
    const { floor, wall, strip: id } = kitchen();
    const moved = moveItems(floor, new Map([[wall, p([4, 0.225])]]));
    expect(itemOf(moved, id).x).toBeCloseTo(4);
    const raised = settleStacks(updateItems(floor, new Set([wall]), () => ({ z: 1.6 })), catalogue);
    expect(itemOf(raised, id).z).toBeCloseTo(1.6 - strip.height);
  });

  it("keeps its height when dragged off a unit: under a shelf, behind a television", () => {
    const { floor, strip: id } = kitchen();
    const height = itemOf(floor, id).z;
    const off = restack(moveItems(floor, new Map([[id, p([4, 3])]])), catalogue, new Set([id]));
    expect(itemOf(off, id)).toMatchObject({ on: null, z: height });
    // Left alone on the floor it is not picked up by a table, either.
    const makeId = fresh();
    const withTable = placeItem(room(), "basics/dining_table", p([3, 2]), 0, makeId);
    const loose = placeItem(withTable.floor, strip.id, p([3, 2]), 0, makeId);
    expect(itemOf(restack(loose.floor, catalogue, new Set([loose.id])), loose.id)).toMatchObject({ on: null, z: 0 });
  });

  it("lights the worktop under it along its whole length", () => {
    const { floor, strip: id } = kitchen();
    const bound = placeFixture(floor, catalogue, "light.under_cabinet", "light", p([2, 0.225]), fresh());
    const fixture = bound.floor.fixtures[0];
    expect(fixture.item).toBe(id);
    const light = stripLight(fixture, bound.floor, catalogue)!;
    expect(light.length).toBeCloseTo(unit.width);
    expect(light.z).toBeCloseTo(unit.mount_height! - strip.height);
    // The base unit's worktop, not the floor and not the wall unit above.
    expect(light.below).toBeCloseTo(0.9);
    expect(fixtureHeight(fixture, bound.floor, catalogue)).toBeCloseTo(light.z);
    // Stretched over a run of units it is that long.
    const longer = updateItems(bound.floor, new Set([id]), (item) => resizeItem(item, strip, "width", 2.4));
    expect(stripLight(fixture, longer, catalogue)!.length).toBeCloseTo(2.4);
  });

  it("can be hit although it is only two centimetres across", () => {
    const { floor, strip: id } = kitchen();
    const item = itemOf(floor, id);
    const ys = pickFootprint(item, strip).map((corner) => corner.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.16);
    // A device dropped a few centimetres off it still becomes the strip.
    const bound = placeFixture(floor, catalogue, "light.under", "light", p([2.1, 0.17]), fresh());
    expect(bound.floor.fixtures[0].item).toBe(id);
    // Other furniture is picked by its own outline.
    const base = floor.items[0];
    expect(pickFootprint(base, model(base.model))).toEqual(itemFootprint(base, model(base.model)));
  });

  it("shines on the floor when there is nothing under it, and is not a strip unless bound to one", () => {
    const makeId = counter();
    const loose = placeItem(room(), strip.id, p([3, 2]), 30, makeId, 2.2);
    const bound = placeFixture(loose.floor, catalogue, "light.cove", "light", p([3, 2]), makeId);
    expect(stripLight(bound.floor.fixtures[0], bound.floor, catalogue)).toMatchObject({ below: 0, rotation: 30, z: 2.2 });
    const plain = placeFixture(room(), catalogue, "light.plain", "light", p([1, 1]), counter());
    expect(stripLight(plain.floor.fixtures[0], plain.floor, catalogue)).toBeUndefined();
  });
});

describe("sliding doors", () => {
  const withDoor = () => {
    const floor = room();
    const wall = floor.walls[0].id;
    const placed = placeOpening(floor, wall, "door", p([3, 0]), fresh());
    const wide = updateOpening(placed.floor, placed.id!, { width: 2.4, offset: 1.8 });
    return { floor: wide, id: placed.id! };
  };

  it("swings unless told to slide", () => {
    const { floor } = withDoor();
    const door = floor.openings[0];
    expect(door).toMatchObject({ style: "hinged", glazed: false });
    expect(slidingPanels(door)).toEqual([]);
    expect(doorLeaves(door)).toHaveLength(1);
  });

  it("has two panels that lap, one fixed and one that slides across it", () => {
    const { floor, id } = withDoor();
    const door = updateOpening(floor, id, { style: "sliding", glazed: true }).openings[0];
    expect(doorLeaves(door)).toEqual([]);
    const [fixed, slider] = slidingPanels(door);
    expect(fixed.travel).toBe(0);
    expect(fixed.from).toBeCloseTo(door.offset);
    expect(fixed.width).toBeCloseTo(1.22);
    expect(fixed.track).not.toBe(slider.track);
    // Shut, between them they close the opening, lapping in the middle.
    expect(slider.from + slider.width).toBeCloseTo(door.offset + door.width);
    expect(fixed.from + fixed.width).toBeGreaterThan(slider.from);
    // Open, the slider is right over the fixed one.
    expect(slider.from + slider.travel).toBeCloseTo(fixed.from);
  });

  it("slides the other way when asked", () => {
    const { floor, id } = withDoor();
    const door = updateOpening(floor, id, { style: "sliding", hinge: "end" }).openings[0];
    const [fixed, slider] = slidingPanels(door);
    expect(fixed.from + fixed.width).toBeCloseTo(door.offset + door.width);
    expect(slider.from).toBeCloseTo(door.offset);
    expect(slider.travel).toBeGreaterThan(0);
    expect(slider.from + slider.travel).toBeCloseTo(fixed.from);
  });

  it("is nothing of the kind for a window or an archway", () => {
    const { floor, id } = withDoor();
    const arch = updateOpening(updateOpening(floor, id, { style: "sliding" }), id, { type: "archway" }).openings[0];
    expect(slidingPanels(arch)).toEqual([]);
  });
});

describe("more lights", () => {
  it("has a desk lamp for a desk, light panels for a wall and printers for a bench", () => {
    expect(model("basics/desk_lamp")).toMatchObject({ kind: "light", tabletop: true });
    for (const id of ["light_panel_triangle", "light_panel_triangle_down", "light_panel_hexagon"]) {
      const one = model(`basics/${id}`);
      expect(one).toMatchObject({ kind: "light", lit: true, against_wall: true });
      expect(one.mount_height).toBeGreaterThan(1);
    }
    expect(model("basics/printer")).toMatchObject({ kind: "light", tabletop: true });
    expect(model("basics/printer_large").width).toBeGreaterThan(model("basics/printer").width);
    expect(model("basics/sim_rig_triple").width).toBeGreaterThan(model("basics/sim_rig").width);
  });

  it("lets a panel a centimetre thick be hit", () => {
    const hexagon = model("basics/light_panel_hexagon");
    const placed = placeItem(room(), hexagon.id, p([3, 0.06]), 0, counter(), hexagon.mount_height);
    const ys = pickFootprint(placed.floor.items[0], hexagon).map((corner) => corner.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.16);
    const bound = placeFixture(placed.floor, catalogue, "light.wall", "light", p([3, 0.1]), fresh());
    expect(bound.floor.fixtures[0].item).toBe(placed.id);
  });

  it("copies a panel with its light, so that a wall of them is one light", () => {
    const hexagon = model("basics/light_panel_hexagon");
    const makeId = fresh();
    const placed = placeItem(room(), hexagon.id, p([3, 0.06]), 0, makeId, hexagon.mount_height);
    const bound = placeFixture(placed.floor, catalogue, "light.wall", "light", p([3, 0.06]), makeId);
    const copied = duplicateItems(bound.floor, new Set([placed.id]), 0.23, makeId);
    expect(copied.floor.fixtures).toHaveLength(2);
    const [first, second] = copied.floor.fixtures;
    expect(second).toMatchObject({ entity_id: "light.wall", kind: "light", item: copied.ids[0] });
    expect(second.id).not.toBe(first.id);
    expect(second.x).toBeCloseTo(first.x + 0.23);
    // Moving the copy takes its light along, and leaves the first where it was.
    const moved = moveItems(copied.floor, new Map([[copied.ids[0], p([5, 0.06])]]));
    expect(moved.fixtures.map((fixture) => fixture.x)).toEqual([3, 5]);
    // A piece with no light is copied as before.
    const plain = placeItem(room(), "basics/chair", p([1, 1]), 0, makeId);
    expect(duplicateItems(plain.floor, new Set([plain.id]), 0.3, makeId).floor.fixtures).toEqual([]);
  });
});
