import type { Colour } from "../core/mesh";

// Colours here are written as they should look on screen (sRGB, 0 to 1).

/** Flat colours for the floor finishes the inspector offers. */
export const FLOOR_COLOURS: Readonly<Record<string, Colour>> = {
  default: [0.86, 0.84, 0.79],
  wood_light: [0.85, 0.71, 0.52],
  wood_dark: [0.52, 0.38, 0.27],
  tile: [0.8, 0.84, 0.86],
  carpet: [0.7, 0.68, 0.78],
  concrete: [0.68, 0.68, 0.66],
};

export const OUTSIDE_COLOUR: Colour = [0.93, 0.91, 0.87];
export const WALL_TOP_COLOUR: Colour = [0.3, 0.33, 0.36];
