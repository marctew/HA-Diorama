// Day and night in the model, from where Home Assistant says the sun is.

import type { Colour } from "./mesh";

export interface SunLighting {
  /** Which way the sunlight comes from: a unit vector in model axes (x east,
   * y up, z south), pointing at the sun. */
  direction: [number, number, number];
  /** Strength of the direct light, 0 to 1 of full daylight. */
  sun: number;
  /** Strength of the light from the sky and bouncing about, 0 to 1 of full daylight. */
  sky: number;
  /** The colour of the light, as seen (sRGB). */
  colour: Colour;
  /** Whether it is worth drawing shadows. */
  shadows: boolean;
}

/** The lighting used when day and night are not followed: a fixed afternoon. */
export const DAYLIGHT: SunLighting = {
  direction: [-0.38, 0.88, 0.28],
  sun: 1,
  sky: 1,
  colour: [1, 0.96, 0.88],
  shadows: true,
};

function mix(a: Colour, b: Colour, t: number): Colour {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Lighting for a sun at an elevation above the horizon and an azimuth
 * clockwise from north, both in degrees, as `sun.sun` reports them. The top
 * of the plan is taken to be north. */
export function sunLighting(elevation: number, azimuth: number): SunLighting {
  const clamped = Math.min(90, Math.max(-90, elevation));
  // The light is never drawn from lower than this: shadows would run for
  // miles, and at night the "sun" stands in for a little moonlight.
  const drawn = (Math.max(14, clamped) * Math.PI) / 180;
  const bearing = (azimuth * Math.PI) / 180;
  const direction: [number, number, number] = [
    Math.sin(bearing) * Math.cos(drawn),
    Math.sin(drawn),
    -Math.cos(bearing) * Math.cos(drawn),
  ];
  // Full day above 10 degrees, full night below -6 (the end of civil twilight).
  const day = Math.min(1, Math.max(0, (clamped + 6) / 16));
  const noon = Math.min(1, Math.max(0, (clamped - 5) / 25));
  const night: Colour = [0.55, 0.65, 1];
  const dusk: Colour = [1, 0.72, 0.5];
  const white: Colour = [1, 0.96, 0.88];
  return {
    direction,
    sun: Number((0.06 + 0.94 * day).toFixed(3)),
    sky: Number((0.22 + 0.78 * day).toFixed(3)),
    colour: day < 0.5 ? mix(night, dusk, day * 2) : mix(dusk, white, Math.max(noon, (day - 0.5) * 2 * 0.4)),
    shadows: day > 0.35,
  };
}

/** Lighting from the state of `sun.sun`, or undefined if it is not usable. */
export function lightingFromSun(
  entity: { attributes: Record<string, unknown> } | undefined,
): SunLighting | undefined {
  const elevation = entity?.attributes.elevation;
  const azimuth = entity?.attributes.azimuth;
  if (typeof elevation !== "number" || typeof azimuth !== "number") return undefined;
  return sunLighting(elevation, azimuth);
}
