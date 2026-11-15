import { describe, expect, it } from "vitest";
import { addWall } from "../src/core/plan";
import type { Floor, House } from "../src/core/scene";
import { cameraFor, camerasFor, floorsNeeded, resolveView, roomOnly } from "../src/core/views";
import { assertConsistent, counter, draw, emptyFloor, p, rectangle, DOOR_DEFAULTS, ITEM_DEFAULTS } from "./helpers";

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
      { id: "o1", wall: floor.walls[0].id, type: "door", offset: 0.5, width: 0.8, height: 2, sill: 0, entity_id: null , ...DOOR_DEFAULTS},
    ],
    items: [
      { id: "i1", model: "basics/floor_lamp", x: 1, y: 1, z: 0, rotation: 0, scale: 1, room: left.id , ...ITEM_DEFAULTS},
      { id: "i2", model: "basics/sofa_2", x: 6, y: 2, z: 0, rotation: 0, scale: 1, room: right.id , ...ITEM_DEFAULTS},
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
  cameras: [],
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

describe("the house view with its floors spaced apart", () => {
  it("lifts each floor by a gap more than the one below", () => {
    const home = house({ id: "f2", name: "Up", elevation: 2.7 }, { id: "f1", name: "Ground" }, { id: "f3", name: "Loft", elevation: 5.4 });
    const loaded = new Map([["f1", twoRooms("f1")], ["f2", twoRooms("f2")], ["f3", twoRooms("f3")]]);
    const result = resolveView(home, loaded, { view: "house", floor_gap: 2 });
    if (result.status !== "ready") throw new Error("not ready");
    // In the order the house lists them, each at its own height.
    expect(result.floors.map((entry) => [entry.floor.id, entry.elevation])).toEqual([
      ["f2", 4.7],
      ["f1", 0],
      ["f3", 9.4],
    ]);
  });

  it("ignores the gap for a single floor", () => {
    const home = house({ id: "f1", name: "Ground" });
    const result = resolveView(home, new Map([["f1", twoRooms("f1")]]), { view: "floor", floor: "f1", floor_gap: 2 });
    expect(result).toMatchObject({ status: "ready", floors: [{ elevation: 0 }] });
  });
});

describe("saved camera views", () => {
  const cameras = [
    { id: "c1", name: "Everything", floor: null, position: [10, 8, 10] as [number, number, number], target: [4, 1, 2] as [number, number, number] },
    { id: "c2", name: "Landing", floor: "f2", position: [3, 2, 3] as [number, number, number], target: [1, 1, 1] as [number, number, number] },
  ];
  const shown = [
    { floor: twoRooms("f1"), elevation: 0 },
    { floor: twoRooms("f2"), elevation: 4.7 },
  ];

  it("uses a view saved on no floor as it is", () => {
    expect(cameraFor({ cameras }, shown, "c1")).toEqual({ position: [10, 8, 10], target: [4, 1, 2] });
  });

  it("lifts a view saved on a floor to where that floor is shown", () => {
    expect(cameraFor({ cameras }, shown, "c2")).toEqual({ position: [3, 6.7, 3], target: [1, 5.7, 1] });
    // Alone on the ground, it is as it was saved.
    expect(cameraFor({ cameras }, [{ floor: twoRooms("f2"), elevation: 0 }], "c2")).toEqual({
      position: [3, 2, 3],
      target: [1, 1, 1],
    });
  });

  it("has nothing for an unknown view, or one whose floor is not shown", () => {
    expect(cameraFor({ cameras }, shown, "nope")).toBeUndefined();
    expect(cameraFor({ cameras }, shown, undefined)).toBeUndefined();
    expect(cameraFor({ cameras }, [shown[0]], "c2")).toBeUndefined();
  });

  it("offers the views that suit what is shown", () => {
    expect(camerasFor({ cameras }, { view: "house" }).map((camera) => camera.id)).toEqual(["c1", "c2"]);
    expect(camerasFor({ cameras }, { view: "floor", floor: "f2" }).map((camera) => camera.id)).toEqual(["c1", "c2"]);
    expect(camerasFor({ cameras }, { view: "room", floor: "f1", room: "r1" }).map((camera) => camera.id)).toEqual(["c1"]);
  });
});
