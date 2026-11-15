import { describe, expect, it } from "vitest";
import { DAYLIGHT, lightingFromSun, sunLighting } from "../src/core/sun";

const length = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);

describe("sunLighting", () => {
  it("is bright at midday and dim at night", () => {
    const noon = sunLighting(55, 180);
    const night = sunLighting(-30, 0);
    expect(noon.sun).toBe(1);
    expect(noon.sky).toBe(1);
    expect(night.sun).toBeLessThan(0.1);
    expect(night.sky).toBeLessThan(0.3);
    // Never black: the house is still to be seen.
    expect(night.sky).toBeGreaterThan(0.15);
  });

  it("gets steadily lighter through dawn", () => {
    const levels = [-12, -6, -3, 0, 4, 10, 30].map((elevation) => sunLighting(elevation, 90).sky);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    expect(levels[1]).toBeLessThan(levels[5]);
  });

  it("points at the sun: south at noon, east in the morning, west in the evening", () => {
    const noon = sunLighting(50, 180).direction;
    expect(noon[2]).toBeGreaterThan(0.5); // south is down the plan, +z
    expect(Math.abs(noon[0])).toBeLessThan(1e-9);
    expect(sunLighting(20, 90).direction[0]).toBeGreaterThan(0.9); // east is +x
    expect(sunLighting(20, 270).direction[0]).toBeLessThan(-0.9);
    expect(sunLighting(20, 0).direction[2]).toBeLessThan(-0.9); // north is up the plan
    for (const elevation of [-40, 0, 14, 60, 90]) {
      expect(length(sunLighting(elevation, 123).direction)).toBeCloseTo(1);
    }
  });

  it("never draws the light from below a low angle", () => {
    expect(sunLighting(2, 180).direction[1]).toBeCloseTo(Math.sin((14 * Math.PI) / 180));
    expect(sunLighting(-50, 180).direction[1]).toBeGreaterThan(0.2);
    expect(sunLighting(70, 180).direction[1]).toBeCloseTo(Math.sin((70 * Math.PI) / 180));
  });

  it("is bluish at night, warm at dusk and near white by day", () => {
    const night = sunLighting(-20, 0).colour;
    const dusk = sunLighting(2, 270).colour;
    const day = sunLighting(50, 180).colour;
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(dusk[0]).toBeGreaterThan(dusk[2]);
    expect(day[2]).toBeGreaterThan(dusk[2]);
    for (const colour of [night, dusk, day]) {
      for (const channel of colour) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws shadows by day only", () => {
    expect(sunLighting(30, 180).shadows).toBe(true);
    expect(sunLighting(-10, 180).shadows).toBe(false);
  });

  it("copes with nonsense elevations", () => {
    expect(sunLighting(500, 0).sun).toBe(1);
    expect(sunLighting(-500, 0).sun).toBeLessThan(0.1);
  });
});

describe("lightingFromSun", () => {
  it("reads sun.sun", () => {
    expect(lightingFromSun({ attributes: { elevation: 40, azimuth: 180 } })).toEqual(sunLighting(40, 180));
  });

  it("is undefined without the numbers", () => {
    expect(lightingFromSun(undefined)).toBeUndefined();
    expect(lightingFromSun({ attributes: {} })).toBeUndefined();
    expect(lightingFromSun({ attributes: { elevation: "high", azimuth: 180 } })).toBeUndefined();
  });

  it("has a daylight to fall back on", () => {
    expect(length(DAYLIGHT.direction)).toBeCloseTo(1, 1);
    expect(DAYLIGHT.shadows).toBe(true);
  });
});
