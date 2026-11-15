// Reading colours out of a picture: for turning a textured model into one
// with a flat colour on each face. No DOM here: the pixels are handed in.

import type { Colour } from "./mesh";

/** One channel of a colour as stored in a picture (0 to 255, sRGB) as the
 * renderer works with it (0 to 1, linear light). */
export function srgbToLinear(value: number): number {
  const channel = Math.min(255, Math.max(0, value)) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The colour of a picture at a point of it, in linear light. `u` runs
 * across and `v` down, each from 0 to 1; outside that the picture repeats,
 * as textures do. `pixels` is four bytes for each pixel, row by row. */
export function sampleColour(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
): Colour {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(u) || !Number.isFinite(v)) return [1, 1, 1];
  const wrap = (value: number) => value - Math.floor(value);
  const x = Math.min(width - 1, Math.floor(wrap(u) * width));
  const y = Math.min(height - 1, Math.floor(wrap(v) * height));
  const at = (y * width + x) * 4;
  return [srgbToLinear(pixels[at]), srgbToLinear(pixels[at + 1]), srgbToLinear(pixels[at + 2])];
}
