import { describe, expect, it } from "vitest";
import { wallsToLower } from "../src/core/cutaway";

// A 4 x 4 room centred on the origin, and a wall across its middle.
const walls = [
  { id: "north", centre: [0, -2] as const },
  { id: "south", centre: [0, 2] as const },
  { id: "west", centre: [-2, 0] as const },
  { id: "east", centre: [2, 0] as const },
  { id: "middle", centre: [0, 0] as const },
];
const target = [0, 1.2, 0] as const;
const lowered = (camera: readonly [number, number, number], mode: "auto" | "full" | "low" = "auto") =>
  [...wallsToLower(walls, mode, camera, target)].sort();

describe("wallsToLower", () => {
  it("lowers the walls on the camera's side", () => {
    expect(lowered([0, 6, 10])).toEqual(["south"]);
    expect(lowered([0, 6, -10])).toEqual(["north"]);
    expect(lowered([-10, 6, 0])).toEqual(["west"]);
  });

  it("lowers both near walls from a corner", () => {
    expect(lowered([8, 6, 8])).toEqual(["east", "south"]);
  });

  it("leaves a wall through the middle standing", () => {
    expect(lowered([0, 6, 10])).not.toContain("middle");
  });

  it("lowers nothing from overhead", () => {
    expect(lowered([0, 12, 0.5])).toEqual([]);
    expect(lowered([0, 12, 0])).toEqual([]);
    expect(lowered([0, 12, 3])).toEqual([]);
    // Lower down, the near wall is in the way again.
    expect(lowered([0, 6, 6])).toEqual(["south"]);
  });

  it("does what it is told when not on auto", () => {
    expect(lowered([0, 6, 10], "full")).toEqual([]);
    expect(lowered([0, 12, 0], "low")).toEqual(["east", "middle", "north", "south", "west"]);
  });

  it("measures from what the camera looks at, not the origin", () => {
    const result = wallsToLower(walls, "auto", [10, 6, 20], [10, 1.2, 10]);
    // The whole room is to one side of the target, and not towards the camera.
    expect([...result]).toEqual([]);
  });
});
