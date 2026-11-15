// The plan's viewport: where the drawing sits on screen and how big.

import type { Point } from "../core/geometry";
import type { Floor } from "../core/scene";

export interface View {
  /** Pixels per metre. */
  scale: number;
  /** Screen position of the plan's origin. */
  x: number;
  y: number;
}

export const MIN_SCALE = 4;
export const MAX_SCALE = 1500;
export const DEFAULT_SCALE = 60;

export function toScreen(view: View, point: Point): Point {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

export function toWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Zoom by a factor, keeping the plan under `anchor` (a screen point) still. */
export function zoomAt(view: View, anchor: Point, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const world = toWorld(view, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

/** A view that shows the whole floor with some room around it, or the origin
 * at a comfortable scale when there is nothing drawn. */
export function fit(floor: Pick<Floor, "vertices">, width: number, height: number, padding = 80): View {
  if (floor.vertices.length === 0 || width <= 0 || height <= 0) {
    return { scale: DEFAULT_SCALE, x: width / 2, y: height / 2 };
  }
  const xs = floor.vertices.map((vertex) => vertex.x);
  const ys = floor.vertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const availableWidth = Math.max(40, width - padding * 2);
  const availableHeight = Math.max(40, height - padding * 2);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(
      MIN_SCALE,
      Math.min(
        availableWidth / Math.max(maxX - minX, 0.5),
        availableHeight / Math.max(maxY - minY, 0.5),
        160,
      ),
    ),
  );
  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  };
}

/** Grid spacing in metres for a zoom level: fine lines at least 10 pixels
 * apart, heavy lines every tenth. */
export function gridStep(scale: number): number {
  for (const step of [0.05, 0.1, 0.5, 1, 5, 10, 50]) {
    if (step * scale >= 10) return step;
  }
  return 100;
}

/** A round length for the scale bar that is 60 to 150 pixels long. */
export function scaleBarLength(scale: number): number {
  for (const metres of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
    if (metres * scale >= 60) return metres;
  }
  return 200;
}
