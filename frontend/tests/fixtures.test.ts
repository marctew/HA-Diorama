import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  domainOf,
  fixtureVisual,
  kelvinToColour,
  kindForEntity,
  MISSING,
  tapAction,
  toggleCall,
} from "../src/core/bindings";
import type { Catalogue } from "../src/core/catalogue";
import {
  bindableEntities,
  deleteFixtures,
  entityArea,
  fixtureHeight,
  itemToBind,
  MARKER_HEIGHT,
  moveFixtures,
  placeFixture,
  syncFixtures,
  updateFixtures,
} from "../src/core/fixtures";
import { deleteItems, moveItems, placeItem, roomAt } from "../src/core/items";
import { addWall } from "../src/core/plan";
import type { Floor } from "../src/core/scene";
import { counter, emptyFloor, p, rectangle } from "./helpers";

const catalogue: Catalogue = {
  ...JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../custom_components/diorama/assets/catalogue.json"), "utf8"),
  ),
  base_url: "/diorama_assets/1.2.3",
};

const state = (value: string, attributes: Record<string, unknown> = {}) => ({ state: value, attributes });

describe("kinds and actions", () => {
  it.each([
    ["light.kitchen", "light"],
    ["switch.kettle", "switch"],
    ["input_boolean.guest_mode", "switch"],
    ["fan.bedroom", "switch"],
    ["sensor.temperature", undefined],
    ["lock.front_door", undefined],
    ["nonsense", undefined],
  ])("%s is %s", (entityId, kind) => {
    expect(kindForEntity(entityId)).toBe(kind);
  });

  it("reads the domain", () => {
    expect(domainOf("light.kitchen.extra")).toBe("light");
  });

  it("toggles with the entity's own service", () => {
    expect(toggleCall("light.kitchen")).toEqual({ domain: "light", service: "toggle" });
    expect(toggleCall("input_boolean.x")).toEqual({ domain: "input_boolean", service: "toggle" });
    expect(toggleCall("cover.blind")).toEqual({ domain: "homeassistant", service: "toggle" });
  });

  it("lets a fixture override what a tap does", () => {
    expect(tapAction("light", {})).toBe("toggle");
    expect(tapAction("light", { tap: "more-info" })).toBe("more-info");
    expect(tapAction("light", { tap: "none" })).toBe("none");
    expect(tapAction("light", { tap: "explode" })).toBe("toggle");
    // A kind with no binding yet never toggles by accident.
    expect(tapAction("lock", {})).toBe("more-info");
  });
});

describe("fixtureVisual", () => {
  it("shows a light that is off", () => {
    expect(fixtureVisual("light", state("off"))).toMatchObject({ available: true, on: false, level: 0, glows: false });
  });

  it("uses brightness and colour of a light that is on", () => {
    const visual = fixtureVisual("light", state("on", { brightness: 128, rgb_color: [255, 0, 128] }));
    expect(visual).toMatchObject({ available: true, on: true, glows: true });
    expect(visual.level).toBeCloseTo(128 / 255);
    expect(visual.colour).toEqual([1, 0, 128 / 255]);
  });

  it("uses colour temperature when there is no colour", () => {
    const warm = fixtureVisual("light", state("on", { color_temp_kelvin: 2200 })).colour;
    const cool = fixtureVisual("light", state("on", { color_temp_kelvin: 6500 })).colour;
    expect(warm[2]).toBeLessThan(cool[2]);
    expect(warm[0]).toBe(1);
  });

  it("treats a light with no brightness as fully on, and never quite invisible", () => {
    expect(fixtureVisual("light", state("on")).level).toBe(1);
    expect(fixtureVisual("light", state("on", { brightness: 1 })).level).toBe(0.08);
  });

  it("prefers rgb over temperature, and ignores a broken rgb", () => {
    const both = fixtureVisual("light", state("on", { rgb_color: [0, 255, 0], color_temp_kelvin: 2700 }));
    expect(both.colour).toEqual([0, 1, 0]);
    const broken = fixtureVisual("light", state("on", { rgb_color: [null, null, null] }));
    expect(broken.colour).toEqual([1, 0.84, 0.6]);
  });

  it("shows a switch on or off without throwing light", () => {
    expect(fixtureVisual("switch", state("on"))).toMatchObject({ on: true, level: 1, glows: false });
    expect(fixtureVisual("switch", state("off"))).toMatchObject({ on: false, level: 0 });
  });

  it.each(["unavailable", "unknown"])("greys out an entity that is %s", (value) => {
    expect(fixtureVisual("light", state(value))).toBe(MISSING);
    expect(fixtureVisual("switch", state(value))).toBe(MISSING);
  });

  it("greys out a missing entity and a kind that is not built", () => {
    expect(fixtureVisual("light", undefined)).toBe(MISSING);
    expect(fixtureVisual("lock", state("locked"))).toBe(MISSING);
  });
});

describe("kelvinToColour", () => {
  it("runs from orange through white towards blue", () => {
    const [candle, bulb, day, sky] = [1900, 2700, 6500, 10000].map(kelvinToColour);
    expect(candle[2]).toBeLessThan(bulb[2]);
    expect(bulb[2]).toBeLessThan(day[2]);
    expect(day.every((channel) => channel > 0.93)).toBe(true);
    expect(sky[0]).toBeLessThan(sky[2]);
    for (const colour of [candle, bulb, day, sky]) {
      for (const channel of colour) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("placing fixtures", () => {
  const house = (): Floor => {
    const makeId = counter();
    return addWall(rectangle(emptyFloor(), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
  };

  it("gives a light dropped on the floor a ceiling light", () => {
    const floor = house();
    const placed = placeFixture(floor, catalogue, "light.kitchen", { x: 1.23456, y: 2 }, counter());
    expect(placed.id).toBe("x1");
    expect(placed.floor.fixtures).toEqual([
      {
        id: "x1",
        entity_id: "light.kitchen",
        kind: "light",
        x: 1.2346,
        y: 2,
        z: 0,
        room: roomAt(floor, { x: 1, y: 2 }),
        item: null,
        model: "basics/ceiling_light",
        options: {},
      },
    ]);
  });

  it("gives a switch a marker at switch height", () => {
    const placed = placeFixture(house(), catalogue, "switch.kettle", { x: 6, y: 2 }, counter());
    expect(placed.floor.fixtures[0]).toMatchObject({ kind: "switch", model: null, item: null, z: MARKER_HEIGHT });
  });

  it("attaches a light to a lamp it is dropped on", () => {
    const makeId = counter();
    let floor = placeItem(house(), "basics/floor_lamp", { x: 1, y: 1 }, 0, makeId).floor;
    expect(itemToBind(floor, catalogue, "light", { x: 1.1, y: 1.05 })?.id).toBe("i1");
    floor = placeFixture(floor, catalogue, "light.lamp", { x: 1.1, y: 1.05 }, makeId).floor;
    expect(floor.fixtures[0]).toMatchObject({ item: "i1", model: null, x: 1, y: 1, z: 0 });
  });

  it("does not attach to furniture of another kind, or a lamp already taken", () => {
    const makeId = counter();
    let floor = placeItem(house(), "basics/sofa_2", { x: 1, y: 1 }, 0, makeId).floor;
    floor = placeItem(floor, "basics/floor_lamp", { x: 3, y: 3 }, 0, makeId).floor;
    expect(itemToBind(floor, catalogue, "light", { x: 1, y: 1 })).toBeUndefined();
    floor = placeFixture(floor, catalogue, "light.one", { x: 3, y: 3 }, makeId).floor;
    floor = placeFixture(floor, catalogue, "light.two", { x: 3, y: 3 }, makeId).floor;
    expect(floor.fixtures.map((fixture) => fixture.item)).toEqual(["i2", null]);
    // A switch does not become the lamp.
    expect(itemToBind(floor, catalogue, "switch", { x: 3, y: 3 })).toBeUndefined();
  });

  it("refuses an entity nothing can show yet", () => {
    const floor = house();
    const placed = placeFixture(floor, catalogue, "sensor.temperature", { x: 1, y: 1 }, counter());
    expect(placed.floor).toBe(floor);
    expect(placed.id).toBeUndefined();
  });
});

describe("fixtures follow the floor", () => {
  const withLamp = () => {
    const makeId = counter();
    let floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
    floor = placeItem(floor, "basics/floor_lamp", { x: 1, y: 1 }, 0, makeId).floor;
    floor = placeFixture(floor, catalogue, "light.lamp", { x: 1, y: 1 }, makeId).floor;
    floor = placeFixture(floor, catalogue, "switch.kettle", { x: 2, y: 3 }, makeId).floor;
    return floor;
  };

  it("moves with the furniture it is attached to, into the next room", () => {
    const floor = withLamp();
    const moved = moveItems(floor, new Map([["i1", { x: 6, y: 2 }]]));
    expect(moved.fixtures[0]).toMatchObject({ x: 6, y: 2, item: "i1", room: roomAt(floor, { x: 6, y: 2 }) });
    expect(moved.fixtures[1]).toBe(floor.fixtures[1]);
  });

  it("comes off its furniture when dragged on its own", () => {
    const floor = withLamp();
    const moved = moveFixtures(floor, new Map([["x1", { x: 3, y: 3 }]]));
    expect(moved.fixtures[0]).toMatchObject({ x: 3, y: 3, item: null, z: MARKER_HEIGHT });
    expect(moved.items).toBe(floor.items);
  });

  it("stays where it was when its furniture is deleted", () => {
    const floor = withLamp();
    const result = deleteItems(floor, new Set(["i1"]));
    expect(result.fixtures[0]).toMatchObject({ x: 1, y: 1, item: null });
  });

  it("changes room when a wall moves over it", () => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 8, 4);
    floor = placeFixture(floor, catalogue, "switch.kettle", { x: 6, y: 2 }, makeId).floor;
    const whole = floor.fixtures[0].room;
    floor = addWall(floor, p([4, 0]), p([4, 4]), makeId);
    expect(floor.fixtures[0].room).not.toBeNull();
    expect(floor.fixtures[0].room).toBe(roomAt(floor, { x: 6, y: 2 }));
    expect(floor.rooms.some((room) => room.id === whole)).toBe(true);
  });

  it("returns the same floor when nothing needs changing", () => {
    const floor = withLamp();
    expect(syncFixtures(floor)).toBe(floor);
    expect(updateFixtures(floor, new Set(["nope"]), () => ({ z: 2 }))).toBe(floor);
    expect(deleteFixtures(floor, new Set(["nope"]))).toBe(floor);
    expect(syncFixtures(emptyFloor())).toEqual(emptyFloor());
  });

  it("updates and deletes", () => {
    let floor = withLamp();
    floor = updateFixtures(floor, new Set(["x2"]), () => ({ options: { tap: "more-info" } }));
    expect(floor.fixtures[1].options).toEqual({ tap: "more-info" });
    floor = deleteFixtures(floor, new Set(["x1"]));
    expect(floor.fixtures.map((fixture) => fixture.id)).toEqual(["x2"]);
  });

  it("knows how high each fixture's light or marker is", () => {
    const makeId = counter();
    let floor = withLamp();
    floor = placeFixture(floor, catalogue, "light.ceiling", { x: 6, y: 2 }, makeId).floor;
    const [lamp, kettle, ceiling] = floor.fixtures;
    // The shade of a 1.6 m floor lamp, a switch on the wall, a pendant under the ceiling.
    expect(fixtureHeight(lamp, floor, catalogue)).toBeCloseTo(1.6 * 0.88, 1);
    expect(fixtureHeight(kettle, floor, catalogue)).toBe(MARKER_HEIGHT);
    expect(fixtureHeight(ceiling, floor, catalogue)).toBeCloseTo(1.9, 1);
  });
});

describe("entities to offer", () => {
  const registries = {
    states: {
      "light.kitchen": { attributes: { friendly_name: "Kitchen light" } },
      "light.bedside": { attributes: { friendly_name: "Bedside" } },
      "switch.kettle": { attributes: {} },
      "sensor.temperature": { attributes: { friendly_name: "Temperature" } },
      "light.hidden": { attributes: { friendly_name: "A hidden one" } },
    },
    entities: {
      "light.kitchen": { area_id: null, device_id: "d1" },
      "light.bedside": { area_id: "bedroom", device_id: "d1" },
      "light.hidden": { area_id: "kitchen", hidden: true },
    },
    devices: { d1: { area_id: "kitchen" } },
  };

  it("finds an entity's area, falling back to its device's", () => {
    expect(entityArea(registries, "light.kitchen")).toBe("kitchen");
    expect(entityArea(registries, "light.bedside")).toBe("bedroom");
    expect(entityArea(registries, "switch.kettle")).toBeNull();
  });

  it("lists what can be placed, by name, without hidden or unsupported entities", () => {
    expect(bindableEntities(registries)).toEqual([
      { entity_id: "light.bedside", name: "Bedside", kind: "light", area_id: "bedroom" },
      { entity_id: "light.kitchen", name: "Kitchen light", kind: "light", area_id: "kitchen" },
      { entity_id: "switch.kettle", name: "switch.kettle", kind: "switch", area_id: null },
    ]);
  });

  it("copes without the registries", () => {
    expect(bindableEntities({ states: registries.states }).map((choice) => choice.area_id)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});
