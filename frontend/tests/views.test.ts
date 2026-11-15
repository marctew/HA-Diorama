import { describe, expect, it } from "vitest";
import { addWall } from "../src/core/plan";
import type { Floor, House } from "../src/core/scene";
import { floorsNeeded, resolveView, roomOnly } from "../src/core/views";
import { assertConsistent, counter, draw, emptyFloor, p, rectangle } from "./helpers";

function twoRooms(id = "f1"): Floor {
  const makeId = counter();
  let floor = addWall(rectangle(emptyFloor(id), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
  // A stub wall in the left room, and one loose outside.
  floor = draw(floor, makeId, [0, 2], [1.5, 2]);
  floor = draw(floor, makeId, [20, 20], [22, 20]);
  const [left, right] = floor.rooms;
  return {
    ...floor,
    rooms: [
      { ...left, name: "Kitchen" },
      { ...right, name: "" },
    ],
    openings: [
      { id: "o1", wall: floor.walls[0].id, type: "door", offset: 0.5, width: 0.8, height: 2, sill: 0, entity_id: null },
    ],
    items: [
      { id: "i1", model: "basics/floor_lamp", x: 1, y: 1, z: 0, rotation: 0, scale: 1, room: left.id },
      { id: "i2", model: "basics/sofa_2", x: 6, y: 2, z: 0, rotation: 0, scale: 1, room: right.id },
    ],
    fixtures: [
      { id: "x1", entity_id: "light.a", kind: "light", x: 1, y: 1, z: 0, room: left.id, item: "i1", model: null, options: {} },
      { id: "x2", entity_id: "light.b", kind: "light", x: 6, y: 1, z: 0, room: right.id, item: null, model: null, options: {} },
    ],
  };
}

const house = (...floors: { id: string; name: string; elevation?: number }[]): House => ({
  schema_version: 1,
  revision: 1,
  settings: { name: "Number 12" },
  floors: floors.map((floor) => ({ elevation: 0, ha_floor_id: null, ...floor })),
});

describe("roomOnly", () => {
  it("keeps the room, its walls and what is in it", () => {
    const floor = twoRooms();
    const kitchen = floor.rooms[0];
    const cut = roomOnly(floor, kitchen.id);

    expect(cut.rooms).toEqual([kitchen]);
    // Its four sides (the top and bottom runs were split by the divider) and the stub.
    expect(cut.walls).toHaveLength(6);
    expect(cut.items.map((item) => item.id)).toEqual(["i1"]);
    expect(cut.fixtures.map((fixture) => fixture.id)).toEqual(["x1"]);
    expect(Math.max(...cut.vertices.map((vertex) => vertex.x))).toBe(4);
    assertConsistent(cut);
  });

  it("keeps only the openings of the walls it keeps", () => {
    const floor = twoRooms();
    const withDoor = floor.rooms.find((room) => roomOnly(floor, room.id).openings.length === 1);
    const without = floor.rooms.find((room) => room !== withDoor);
    expect(withDoor).toBeDefined();
    expect(roomOnly(floor, without!.id).openings).toEqual([]);
  });

  it("detaches a fixture whose furniture is in another room", () => {
    const floor = twoRooms();
    const [left, right] = floor.rooms;
    const odd = { ...floor, fixtures: [{ ...floor.fixtures[0], room: right.id }] };
    expect(roomOnly(odd, right.id).fixtures[0].item).toBeNull();
    expect(roomOnly(odd, left.id).fixtures).toEqual([]);
  });

  it("leaves the floor alone when the room is not on it", () => {
    const floor = twoRooms();
    expect(roomOnly(floor, "nope")).toBe(floor);
  });
});

describe("floorsNeeded", () => {
  const home = house({ id: "f1", name: "Ground" }, { id: "f2", name: "Up" });

  it("is every floor for the house", () => {
    expect(floorsNeeded(home, { view: "house" })).toEqual(["f1", "f2"]);
  });

  it("is one floor for a floor, or for a room that says its floor", () => {
    expect(floorsNeeded(home, { view: "floor", floor: "f2" })).toEqual(["f2"]);
    expect(floorsNeeded(home, { view: "room", floor: "f2", room: "r1" })).toEqual(["f2"]);
  });

  it("is every floor for a room that does not say", () => {
    expect(floorsNeeded(home, { view: "room", room: "r1" })).toEqual(["f1", "f2"]);
  });

  it("is nothing for a floor that is gone", () => {
    expect(floorsNeeded(home, { view: "floor", floor: "gone" })).toEqual([]);
  });
});

describe("resolveView", () => {
  const home = house({ id: "f1", name: "Ground", elevation: -2.6 }, { id: "f2", name: "Up" });
  const f1 = twoRooms("f1");
  const f2 = twoRooms("f2");
  const both = new Map([["f1", f1], ["f2", f2]]);

  it("says a house with no floors is empty", () => {
    expect(resolveView(house(), new Map(), { view: "house" })).toEqual({ status: "empty" });
  });

  it("waits for every floor of the house, then stacks them from the lowest", () => {
    expect(resolveView(home, new Map([["f1", f1]]), { view: "house" })).toEqual({ status: "loading" });
    expect(resolveView(home, both, { view: "house" })).toEqual({
      status: "ready",
      title: "Number 12",
      floors: [
        { floor: f1, elevation: 0 },
        { floor: f2, elevation: 2.6 },
      ],
    });
  });

  it("shows one floor on the ground", () => {
    expect(resolveView(home, both, { view: "floor", floor: "f2" })).toEqual({
      status: "ready",
      title: "Up",
      floors: [{ floor: f2, elevation: 0 }],
    });
    expect(resolveView(home, new Map(), { view: "floor", floor: "f2" })).toEqual({ status: "loading" });
    expect(resolveView(home, both, { view: "floor", floor: "gone" })).toEqual({ status: "missing", what: "floor" });
  });

  it("shows one room, named after it", () => {
    const kitchen = f1.rooms[0];
    const result = resolveView(home, both, { view: "room", floor: "f1", room: kitchen.id });
    expect(result).toMatchObject({ status: "ready", title: "Kitchen" });
    if (result.status !== "ready") throw new Error("not ready");
    expect(result.floors).toHaveLength(1);
    expect(result.floors[0].floor.rooms).toEqual([kitchen]);
    expect(result.floors[0].elevation).toBe(0);
  });

  it("gives an unnamed room a title all the same", () => {
    const result = resolveView(home, both, { view: "room", floor: "f1", room: f1.rooms[1].id });
    expect(result).toMatchObject({ status: "ready", title: "Room" });
  });

  it("finds a room without being told its floor, as soon as that floor is loaded", () => {
    const upstairs = { ...f2, rooms: [{ ...f2.rooms[0], id: "r_up" }, f2.rooms[1]] };
    const request = { view: "room" as const, room: "r_up" };
    expect(resolveView(home, new Map([["f1", f1]]), request)).toEqual({ status: "loading" });
    expect(resolveView(home, new Map([["f2", upstairs]]), request)).toMatchObject({ status: "ready" });
  });

  it("says when the room is gone", () => {
    expect(resolveView(home, both, { view: "room", floor: "f1", room: "gone" })).toEqual({ status: "missing", what: "room" });
    expect(resolveView(home, both, { view: "room", room: "gone" })).toEqual({ status: "missing", what: "room" });
    expect(resolveView(home, both, { view: "room", floor: "gone", room: "r1" })).toEqual({ status: "missing", what: "room" });
  });
});
