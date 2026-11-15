import { describe, expect, it } from "vitest";
import {
  aspectRatioValue,
  DEFAULT_CARD_CONFIG,
  parseCardConfig,
  tidyCardConfig,
} from "../src/core/card-config";

describe("parseCardConfig", () => {
  it("fills in the defaults for an empty configuration", () => {
    expect(parseCardConfig({ type: "custom:diorama-card" })).toEqual(DEFAULT_CARD_CONFIG);
  });

  it("keeps what the user set", () => {
    const config = parseCardConfig({
      view: "room",
      room: " r1 ",
      floor: "f_ground",
      camera: "sofa",
      interactive: false,
      controls: false,
      day_night: false,
      aspect_ratio: "4:3",
      walls: "low",
      floor_gap: 2.5,
    });
    expect(config).toEqual({
      view: "room",
      room: "r1",
      floor: "f_ground",
      camera: "sofa",
      interactive: false,
      controls: false,
      day_night: false,
      aspect_ratio: "4:3",
      walls: "low",
      floor_gap: 2.5,
    });
  });

  it("drops floor and room for the house view", () => {
    const config = parseCardConfig({ view: "house", floor: "f1", room: "r1" });
    expect(config.floor).toBeUndefined();
    expect(config.room).toBeUndefined();
  });

  it("needs a floor for the floor view", () => {
    expect(() => parseCardConfig({ view: "floor" })).toThrow("needs a floor");
    expect(parseCardConfig({ view: "floor", floor: "f1" }).floor).toBe("f1");
  });

  it("needs a room for the room view", () => {
    expect(() => parseCardConfig({ view: "room", floor: "f1" })).toThrow("needs a room");
  });

  it.each([
    [null, "must be a mapping"],
    ["house", "must be a mapping"],
    [{ view: "garden" }, "view must be one of"],
    [{ view: 3 }, "view must be one of"],
    [{ interactive: "yes" }, "interactive must be true or false"],
    [{ camera: 5 }, "camera must be text"],
    [{ camera: "  " }, "camera must be text"],
    [{ aspect_ratio: "wide" }, "aspect_ratio must look like"],
    [{ aspect_ratio: "16:0" }, "aspect_ratio must look like"],
    [{ walls: "glass" }, "walls must be one of"],
    [{ floor_gap: -1 }, "floor_gap must be"],
    [{ floor_gap: "wide" }, "floor_gap must be"],
  ])("rejects %j", (raw, message) => {
    expect(() => parseCardConfig(raw)).toThrow(message);
  });
});

describe("aspectRatioValue", () => {
  it("reads colon and slash forms", () => {
    expect(aspectRatioValue("16:9")).toBeCloseTo(16 / 9);
    expect(aspectRatioValue(" 4 / 3 ")).toBeCloseTo(4 / 3);
    expect(aspectRatioValue("1.5:1")).toBe(1.5);
  });
});

describe("tidyCardConfig", () => {
  it("keeps only what differs from the defaults", () => {
    expect(
      tidyCardConfig({ type: "custom:diorama-card", view: "house", interactive: true, walls: "auto", floor: "f1" }),
    ).toEqual({ type: "custom:diorama-card", view: "house" });
  });

  it("keeps the floor and room a view needs, and anything changed", () => {
    expect(
      tidyCardConfig({ view: "room", floor: "f1", room: "r1", interactive: false, aspect_ratio: "1:1", walls: "low" }),
    ).toEqual({
      type: "custom:diorama-card",
      view: "room",
      floor: "f1",
      room: "r1",
      interactive: false,
      aspect_ratio: "1:1",
      walls: "low",
    });
  });

  it("keeps the gap between floors only for the house view", () => {
    expect(tidyCardConfig({ view: "house", floor_gap: 2.5 })).toMatchObject({ floor_gap: 2.5 });
    expect(tidyCardConfig({ view: "floor", floor: "f1", floor_gap: 2.5 })).not.toHaveProperty("floor_gap");
    expect(tidyCardConfig({ view: "house", floor_gap: 0 })).not.toHaveProperty("floor_gap");
  });

  it("refuses what the card would refuse", () => {
    expect(() => tidyCardConfig({ view: "floor" })).toThrow("needs a floor");
  });
});
