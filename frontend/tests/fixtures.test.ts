import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  domainOf,
  fixtureVisual,
  kelvinToColour,
  kindForEntity,
  MISSING,
  shortReading,
  tapAction,
  tapChoices,
  temperatureColour,
  toggleCall,
  toggledState,
  toggleVerb,
} from "../src/core/bindings";
import type { Catalogue } from "../src/core/catalogue";
import {
  allFixtures,
  bindableEntities,
  deleteFixtures,
  entityArea,
  fixtureHeight,
  isOpeningFixture,
  itemToBind,
  MARKER_HEIGHT,
  openingFixtureId,
  openingFixtures,
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
    ["cover.blind", "cover"],
    ["climate.hall", "climate"],
    ["media_player.tv", "media"],
    ["lock.front_door", "lock"],
    ["sensor.humidity", "label"],
    ["binary_sensor.something", "label"],
    ["automation.morning", undefined],
    ["nonsense", undefined],
  ])("%s is %s", (entityId, kind) => {
    expect(kindForEntity(entityId)).toBe(kind);
  });

  it("goes by the device class of a sensor", () => {
    expect(kindForEntity("sensor.hall", { device_class: "temperature" })).toBe("climate");
    expect(kindForEntity("sensor.hall", { device_class: "humidity" })).toBe("label");
    expect(kindForEntity("binary_sensor.front", { device_class: "door" })).toBe("opening");
    expect(kindForEntity("binary_sensor.front", { device_class: "window" })).toBe("opening");
    expect(kindForEntity("binary_sensor.hall", { device_class: "motion" })).toBe("presence");
    expect(kindForEntity("binary_sensor.hall", { device_class: "occupancy" })).toBe("presence");
    expect(kindForEntity("binary_sensor.leak", { device_class: "moisture" })).toBe("label");
  });

  it("knows what a toggle will do", () => {
    expect(toggledState("light.a", "on")).toBe("off");
    expect(toggledState("light.a", "off")).toBe("on");
    expect(toggledState("cover.a", "closed")).toBe("open");
    expect(toggledState("cover.a", "closing")).toBe("open");
    expect(toggledState("cover.a", "open")).toBe("closed");
    expect(toggleVerb("cover.a", "closed")).toBe("open");
    expect(toggleVerb("cover.a", "open")).toBe("close");
    expect(toggleVerb("switch.a", "off")).toBe("switch_on");
    expect(toggleVerb("switch.a", "on")).toBe("switch_off");
  });

  it("reads the domain", () => {
    expect(domainOf("light.kitchen.extra")).toBe("light");
  });

  it("toggles with the entity's own service", () => {
    expect(toggleCall("light.kitchen")).toEqual({ domain: "light", service: "toggle" });
    expect(toggleCall("input_boolean.x")).toEqual({ domain: "input_boolean", service: "toggle" });
    expect(toggleCall("cover.blind")).toEqual({ domain: "cover", service: "toggle" });
    expect(toggleCall("scene.evening")).toEqual({ domain: "homeassistant", service: "toggle" });
  });

  it("lets a fixture override what a tap does", () => {
    expect(tapAction("light", {})).toBe("toggle");
    expect(tapAction("light", { tap: "more-info" })).toBe("more-info");
    expect(tapAction("light", { tap: "none" })).toBe("none");
    expect(tapAction("light", { tap: "explode" })).toBe("toggle");
    expect(tapAction("light", { tap: "confirm" })).toBe("confirm");
  });

  it("never lets a tap unlock a door, whatever the fixture says", () => {
    expect(tapAction("lock", {})).toBe("more-info");
    expect(tapAction("lock", { tap: "toggle" })).toBe("more-info");
    expect(tapAction("lock", { tap: "confirm" })).toBe("more-info");
    expect(tapAction("lock", { tap: "none" })).toBe("none");
    expect(tapChoices("lock")).toEqual(["more-info", "none"]);
    expect(tapChoices("light")).toContain("toggle");
  });

  it("asks before moving a garage door or gate, but not a blind", () => {
    expect(tapAction("cover", {}, { device_class: "blind" })).toBe("toggle");
    expect(tapAction("cover", {})).toBe("toggle");
    expect(tapAction("cover", {}, { device_class: "garage" })).toBe("confirm");
    expect(tapAction("cover", {}, { device_class: "gate" })).toBe("confirm");
    // Unless its owner has said otherwise.
    expect(tapAction("cover", { tap: "toggle" }, { device_class: "garage" })).toBe("toggle");
    expect(tapAction("cover", { tap: "more-info" }, { device_class: "garage" })).toBe("more-info");
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

  it("greys out a missing entity", () => {
    expect(fixtureVisual("light", undefined)).toBe(MISSING);
    expect(fixtureVisual("lock", undefined)).toBe(MISSING);
  });

  it("shows how far a blind is open", () => {
    expect(fixtureVisual("cover", state("open", { current_position: 40 }))).toMatchObject({ on: true, level: 0.4, open: 0.4 });
    expect(fixtureVisual("cover", state("closed", { current_position: 0 }))).toMatchObject({ on: false, open: 0 });
    // One that does not report a position is open or shut.
    expect(fixtureVisual("cover", state("open")).open).toBe(1);
    expect(fixtureVisual("cover", state("closed")).open).toBe(0);
    expect(fixtureVisual("cover", state("opening")).open).toBe(1);
  });

  it("shows a door or window sensor open or shut", () => {
    expect(fixtureVisual("opening", state("on"))).toMatchObject({ on: true, open: 1 });
    expect(fixtureVisual("opening", state("off"))).toMatchObject({ on: false, open: 0 });
    expect(fixtureVisual("opening", state("on")).colour).not.toEqual(fixtureVisual("opening", state("off")).colour);
  });

  it("labels and colours a temperature, from a thermostat or a sensor", () => {
    const thermostat = fixtureVisual("climate", state("heat", { current_temperature: 19.44, hvac_action: "heating" }));
    expect(thermostat).toMatchObject({ label: "19.4°", on: true, tint: 0.14 });
    const sensor = fixtureVisual("climate", state("26.2", { unit_of_measurement: "°C" }));
    expect(sensor).toMatchObject({ label: "26.2°", on: false });
    // Warmer is redder, colder is bluer.
    expect(sensor.colour[0]).toBeGreaterThan(thermostat.colour[0]);
    expect(thermostat.colour[2]).toBeGreaterThan(sensor.colour[2]);
    expect(fixtureVisual("climate", state("off", {})).label).toBe("off");
  });

  it("reads Fahrenheit as Fahrenheit", () => {
    expect(temperatureColour(70, "°F")).toEqual(temperatureColour((70 - 32) * (5 / 9), "°C"));
    expect(temperatureColour(-40, "°C")).toEqual(temperatureColour(5, "°C"));
    expect(temperatureColour(50, "°C")).toEqual(temperatureColour(30, "°C"));
  });

  it("tints the room when someone is there", () => {
    expect(fixtureVisual("presence", state("on"))).toMatchObject({ on: true, tint: 0.22 });
    expect(fixtureVisual("presence", state("off"))).toMatchObject({ on: false, tint: 0 });
  });

  it("glows for a media player that is playing", () => {
    expect(fixtureVisual("media", state("playing"))).toMatchObject({ on: true, glows: true });
    expect(fixtureVisual("media", state("paused"))).toMatchObject({ on: true, glows: false });
    expect(fixtureVisual("media", state("off"))).toMatchObject({ on: false, glows: false });
  });

  it("flags a lock that is not locked", () => {
    expect(fixtureVisual("lock", state("locked"))).toMatchObject({ on: false });
    expect(fixtureVisual("lock", state("unlocked"))).toMatchObject({ on: true });
    expect(fixtureVisual("lock", state("jammed"))).toMatchObject({ on: true });
  });

  it("shows a sensor's reading", () => {
    expect(fixtureVisual("label", state("48.26", { unit_of_measurement: "%" })).label).toBe("48.3 %");
    expect(fixtureVisual("label", state("1234.56", { unit_of_measurement: "W" })).label).toBe("1235 W");
    expect(fixtureVisual("label", state("on"))).toMatchObject({ label: "on", on: true });
    expect(shortReading(state("not_home"))).toBe("not home");
    expect(shortReading(state("21", { unit_of_measurement: "°C" }))).toBe("21°");
    expect(shortReading(state("a very long state indeed")).length).toBeLessThanOrEqual(12);
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
    const placed = placeFixture(floor, catalogue, "light.kitchen", "light", { x: 1.23456, y: 2 }, counter());
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
    const placed = placeFixture(house(), catalogue, "switch.kettle", "switch", { x: 6, y: 2 }, counter());
    expect(placed.floor.fixtures[0]).toMatchObject({ kind: "switch", model: null, item: null, z: MARKER_HEIGHT });
  });

  it("attaches a light to a lamp it is dropped on", () => {
    const makeId = counter();
    let floor = placeItem(house(), "basics/floor_lamp", { x: 1, y: 1 }, 0, makeId).floor;
    expect(itemToBind(floor, catalogue, "light", { x: 1.1, y: 1.05 })?.id).toBe("i1");
    floor = placeFixture(floor, catalogue, "light.lamp", "light", { x: 1.1, y: 1.05 }, makeId).floor;
    expect(floor.fixtures[0]).toMatchObject({ item: "i1", model: null, x: 1, y: 1, z: 0 });
  });

  it("does not attach to furniture of another kind, or a lamp already taken", () => {
    const makeId = counter();
    let floor = placeItem(house(), "basics/sofa_2", { x: 1, y: 1 }, 0, makeId).floor;
    floor = placeItem(floor, "basics/floor_lamp", { x: 3, y: 3 }, 0, makeId).floor;
    expect(itemToBind(floor, catalogue, "light", { x: 1, y: 1 })).toBeUndefined();
    floor = placeFixture(floor, catalogue, "light.one", "light", { x: 3, y: 3 }, makeId).floor;
    floor = placeFixture(floor, catalogue, "light.two", "light", { x: 3, y: 3 }, makeId).floor;
    expect(floor.fixtures.map((fixture) => fixture.item)).toEqual(["i2", null]);
    // A switch does not become the lamp.
    expect(itemToBind(floor, catalogue, "switch", { x: 3, y: 3 })).toBeUndefined();
  });

  it("attaches a media player to the TV and a thermostat to the radiator", () => {
    const makeId = counter();
    let floor = placeItem(house(), "basics/tv_unit", { x: 1, y: 1 }, 0, makeId).floor;
    floor = placeItem(floor, "basics/radiator", { x: 3, y: 3 }, 0, makeId).floor;
    floor = placeFixture(floor, catalogue, "media_player.tv", "media", { x: 1, y: 1 }, makeId).floor;
    floor = placeFixture(floor, catalogue, "climate.lounge", "climate", { x: 3, y: 3 }, makeId).floor;
    expect(floor.fixtures.map((fixture) => fixture.item)).toEqual(["i1", "i2"]);
  });

  it("gives everything else a marker", () => {
    const placed = placeFixture(house(), catalogue, "lock.front", "lock", { x: 1, y: 1 }, counter());
    expect(placed.floor.fixtures[0]).toMatchObject({ kind: "lock", model: null, item: null, z: MARKER_HEIGHT });
  });
});

describe("fixtures follow the floor", () => {
  const withLamp = () => {
    const makeId = counter();
    let floor = addWall(rectangle(emptyFloor(), makeId, 0, 0, 8, 4), p([4, 0]), p([4, 4]), makeId);
    floor = placeItem(floor, "basics/floor_lamp", { x: 1, y: 1 }, 0, makeId).floor;
    floor = placeFixture(floor, catalogue, "light.lamp", "light", { x: 1, y: 1 }, makeId).floor;
    floor = placeFixture(floor, catalogue, "switch.kettle", "switch", { x: 2, y: 3 }, makeId).floor;
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
    floor = placeFixture(floor, catalogue, "switch.kettle", "switch", { x: 6, y: 2 }, makeId).floor;
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
    floor = placeFixture(floor, catalogue, "light.ceiling", "light", { x: 6, y: 2 }, makeId).floor;
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
      "sensor.temperature": { attributes: { friendly_name: "Temperature", device_class: "temperature" } },
      "sensor.signal": { attributes: { friendly_name: "Signal strength" } },
      "automation.morning": { attributes: { friendly_name: "Morning" } },
      "light.hidden": { attributes: { friendly_name: "A hidden one" } },
    },
    entities: {
      "light.kitchen": { area_id: null, device_id: "d1" },
      "light.bedside": { area_id: "bedroom", device_id: "d1" },
      "light.hidden": { area_id: "kitchen", hidden: true },
      "sensor.signal": { entity_category: "diagnostic" },
    },
    devices: { d1: { area_id: "kitchen" } },
  };

  it("finds an entity's area, falling back to its device's", () => {
    expect(entityArea(registries, "light.kitchen")).toBe("kitchen");
    expect(entityArea(registries, "light.bedside")).toBe("bedroom");
    expect(entityArea(registries, "switch.kettle")).toBeNull();
  });

  it("lists what can be placed, by name, without hidden or diagnostic entities", () => {
    expect(bindableEntities(registries)).toEqual([
      { entity_id: "light.bedside", name: "Bedside", kind: "light", area_id: "bedroom" },
      { entity_id: "light.kitchen", name: "Kitchen light", kind: "light", area_id: "kitchen" },
      { entity_id: "switch.kettle", name: "switch.kettle", kind: "switch", area_id: null },
      { entity_id: "sensor.temperature", name: "Temperature", kind: "climate", area_id: null },
    ]);
  });

  it("copes without the registries", () => {
    const choices = bindableEntities({ states: registries.states });
    expect(choices).toHaveLength(6);
    expect(choices.every((choice) => choice.area_id === null)).toBe(true);
  });
});

describe("the entity of a door or window", () => {
  const withOpenings = (): Floor => {
    const makeId = counter();
    let floor = rectangle(emptyFloor(), makeId, 0, 0, 6, 4);
    const top = floor.walls.find((wall) => {
      const a = floor.vertices.find((v) => v.id === wall.a)!;
      const b = floor.vertices.find((v) => v.id === wall.b)!;
      return a.y === 0 && b.y === 0;
    })!;
    floor = {
      ...floor,
      openings: [
        { id: "o1", wall: top.id, type: "door", offset: 1, width: 0.8, height: 2, sill: 0, entity_id: "binary_sensor.front_door" },
        { id: "o2", wall: top.id, type: "window", offset: 3, width: 1.2, height: 1.2, sill: 0.9, entity_id: "cover.blind" },
        { id: "o3", wall: top.id, type: "window", offset: 5, width: 0.8, height: 1, sill: 1, entity_id: null },
      ],
    };
    return floor;
  };

  it("becomes a fixture in the middle of the opening", () => {
    const fixtures = openingFixtures(withOpenings(), (id) => kindForEntity(id, { device_class: "door" }));
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]).toMatchObject({ id: "opening:o1", entity_id: "binary_sensor.front_door", kind: "opening", y: 0, z: 1 });
    expect(Math.abs(fixtures[0].x - 1.4) < 1e-6 || Math.abs(fixtures[0].x - 4.6) < 1e-6).toBe(true);
    expect(fixtures[1]).toMatchObject({ id: "opening:o2", kind: "cover", z: 1.5 });
    expect(isOpeningFixture(fixtures[0])).toBe(true);
    expect(openingFixtureId("o1")).toBe("opening:o1");
  });

  it("treats anything that is not a cover as open or shut", () => {
    const fixtures = openingFixtures(withOpenings(), () => undefined);
    expect(fixtures.map((fixture) => fixture.kind)).toEqual(["opening", "opening"]);
  });

  it("is listed with the fixtures placed on the floor", () => {
    const floor = withOpenings();
    expect(allFixtures(floor).map((fixture) => [fixture.id, fixture.kind])).toEqual([
      ["opening:o1", "opening"],
      ["opening:o2", "cover"],
    ]);
    // Nothing to add: the very same list, so that nothing is redrawn for it.
    const plain = { ...floor, openings: [] };
    expect(allFixtures(plain)).toBe(plain.fixtures);
  });

  it("is not a stored fixture", () => {
    const floor = withOpenings();
    expect(floor.fixtures).toEqual([]);
    expect(isOpeningFixture({ id: "x_abc" })).toBe(false);
  });
});
