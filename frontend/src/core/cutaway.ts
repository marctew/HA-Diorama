// Which walls to lower so that the camera can see into the house: the ones on
// the camera's side of it. Looking down from above, nothing is in the way and
// every wall stays up.

export type WallMode = "auto" | "full" | "low";

/** How tall a lowered wall is drawn, in metres: enough to read as a wall. */
export const LOW_WALL = 0.3;

/** Steeper than this, measured from straight down, and walls are in the way. */
const CLEAR_ANGLE = (28 * Math.PI) / 180;

export interface WallPlace {
  id: string;
  /** The middle of the wall on the floor: [x, z]. */
  centre: readonly [number, number];
}

/** The ids of the walls to lower.
 *
 * `target` is what the camera looks at and `camera` where it is, both
 * [x, y, z]. A wall is in the way if it lies on the camera's side of the
 * target by more than `margin` metres. */
export function wallsToLower(
  walls: readonly WallPlace[],
  mode: WallMode,
  camera: readonly [number, number, number],
  target: readonly [number, number, number],
  margin = 0.25,
): Set<string> {
  if (mode === "full") return new Set();
  if (mode === "low") return new Set(walls.map((wall) => wall.id));
  const dx = camera[0] - target[0];
  const dy = camera[1] - target[1];
  const dz = camera[2] - target[2];
  const flat = Math.hypot(dx, dz);
  // Nearly overhead (or below, which the controls do not allow): see everything.
  if (flat < 1e-6 || Math.atan2(flat, Math.max(dy, 0)) < CLEAR_ANGLE) return new Set();
  const ux = dx / flat;
  const uz = dz / flat;
  const lowered = new Set<string>();
  for (const wall of walls) {
    const along = (wall.centre[0] - target[0]) * ux + (wall.centre[1] - target[2]) * uz;
    if (along > margin) lowered.add(wall.id);
  }
  return lowered;
}
