// A plan image to draw over. It is placed by the position of its top left
// corner and a scale, in metres for each pixel of the image.

import { distance, type Point } from "./geometry";
import type { Trace } from "./scene";

/** How wide a newly added image is shown, in metres, until its scale is set. */
const FIRST_WIDTH = 10;

/** A new trace, centred on a point of the plan. */
export function newTrace(image: string, naturalWidth: number, naturalHeight: number, centre: Point): Trace {
  const scale = FIRST_WIDTH / Math.max(1, naturalWidth);
  return {
    image,
    scale: Number(scale.toPrecision(8)),
    x: round(centre.x - (naturalWidth * scale) / 2),
    y: round(centre.y - (naturalHeight * scale) / 2),
    opacity: 0.4,
  };
}

/** Where the image lies on the plan. */
export function traceBox(
  trace: Pick<Trace, "scale" | "x" | "y">,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: trace.x,
    y: trace.y,
    width: naturalWidth * trace.scale,
    height: naturalHeight * trace.scale,
  };
}

/** Set the scale from two points picked on the image and the real distance
 * between them. The first point stays where it is on the plan. Returns the
 * trace unchanged if the points are the same or the distance is nonsense. */
export function calibrate(trace: Trace, first: Point, second: Point, realDistance: number): Trace {
  const shown = distance(first, second);
  if (!(shown > 1e-6) || !(realDistance > 0) || !Number.isFinite(realDistance)) return trace;
  const factor = realDistance / shown;
  const scale = trace.scale * factor;
  if (!(scale >= 0.00001 && scale <= 10)) return trace;
  return {
    ...trace,
    scale: Number(scale.toPrecision(8)),
    x: round(first.x - (first.x - trace.x) * factor),
    y: round(first.y - (first.y - trace.y) * factor),
  };
}

/** Slide the image across the plan. */
export function moveTrace(trace: Trace, dx: number, dy: number): Trace {
  if ((dx === 0 && dy === 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return trace;
  return { ...trace, x: round(trace.x + dx), y: round(trace.y + dy) };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
