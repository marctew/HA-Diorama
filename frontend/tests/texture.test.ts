import { describe, expect, it } from "vitest";
import { sampleColour, srgbToLinear } from "../src/core/texture";

// Two by two: red, green on top; blue, white below.
const pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];

describe("sampleColour", () => {
  it("reads the pixel under a point", () => {
    expect(sampleColour(pixels, 2, 2, 0.25, 0.25)).toEqual([1, 0, 0]);
    expect(sampleColour(pixels, 2, 2, 0.75, 0.25)).toEqual([0, 1, 0]);
    expect(sampleColour(pixels, 2, 2, 0.25, 0.75)).toEqual([0, 0, 1]);
    expect(sampleColour(pixels, 2, 2, 0.75, 0.75)).toEqual([1, 1, 1]);
  });

  it("repeats outside the picture, as a texture does", () => {
    expect(sampleColour(pixels, 2, 2, 1.25, 0.25)).toEqual([1, 0, 0]);
    expect(sampleColour(pixels, 2, 2, -0.25, 0.25)).toEqual([0, 1, 0]);
    expect(sampleColour(pixels, 2, 2, 0.25, 3.75)).toEqual([0, 0, 1]);
    // The very edge belongs to the first pixel again.
    expect(sampleColour(pixels, 2, 2, 1, 1)).toEqual([1, 0, 0]);
  });

  it("is white when there is nothing to read", () => {
    expect(sampleColour([], 0, 0, 0.5, 0.5)).toEqual([1, 1, 1]);
    expect(sampleColour(pixels, 2, 2, Number.NaN, 0.5)).toEqual([1, 1, 1]);
  });
});

describe("srgbToLinear", () => {
  it("keeps black and white and darkens the middle", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBe(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3);
    expect(srgbToLinear(400)).toBe(1);
    expect(srgbToLinear(-5)).toBe(0);
  });
});
