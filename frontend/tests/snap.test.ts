import { describe, expect, it } from "vitest";
import { snap } from "../src/core/snap";
import { counter, emptyFloor, rectangle, vertexAt, wallBetween } from "./helpers";

const room = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
const options = { tolerance: 0.15, grid: 0.05 };

describe("snap", () => {
  it("snaps to a corner", () => {
    const result = snap({ x: 3.92, y: 0.07 }, room, options);
    expect(result).toMatchObject({ kind: "vertex", point: { x: 4, y: 0 } });
    expect(result.vertexId).toBe(vertexAt(room, 4, 0));
  });

  it("prefers the nearest corner", () => {
    const tiny = rectangle(emptyFloor(), counter(), 0, 0, 0.2, 0.2);
    expect(snap({ x: 0.14, y: 0.02 }, tiny, options).point).toEqual({ x: 0.2, y: 0 });
  });

  it("snaps to the middle of a wall", () => {
    const result = snap({ x: 2.08, y: 0.05 }, room, options);
    expect(result).toMatchObject({ kind: "midpoint", point: { x: 2, y: 0 } });
    expect(result.wallId).toBe(wallBetween(room, [0, 0], [4, 0]));
  });

  it("snaps onto a wall", () => {
    const result = snap({ x: 1.03, y: -0.1 }, room, options);
    expect(result.kind).toBe("wall");
    expect(result.point.x).toBeCloseTo(1.03);
    expect(result.point.y).toBeCloseTo(0);
  });

  it("falls back to the grid", () => {
    expect(snap({ x: 10.02, y: 7.48 }, room, options)).toMatchObject({
      kind: "grid",
      point: { x: 10, y: 7.5 },
    });
  });

  it("lines up with a corner on one axis and the grid on the other", () => {
    const result = snap({ x: 4.06, y: 7.52 }, room, options);
    expect(result.kind).toBe("align");
    expect(result.point).toEqual({ x: 4, y: 7.5 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].to).toEqual({ x: 4, y: 7.5 });
  });

  it("holds a wall being drawn to 90 degrees and a grid length", () => {
    const result = snap({ x: 9.03, y: 6.12 }, room, { ...options, from: { x: 6, y: 6 } });
    expect(result).toMatchObject({ kind: "angle", point: { x: 9.05, y: 6 } });
  });

  it("holds a wall being drawn to 45 degrees", () => {
    const result = snap({ x: 8.02, y: 8.08 }, room, { ...options, from: { x: 6, y: 6 } });
    expect(result.kind).toBe("angle");
    expect(result.point.x).toBeCloseTo(result.point.y);
  });

  it("leaves the direction free when it is not near 45 or 90", () => {
    const result = snap({ x: 9, y: 7.02 }, room, { ...options, from: { x: 6, y: 6 } });
    expect(result).toMatchObject({ kind: "grid", point: { x: 9, y: 7 } });
  });

  it("stops a wall being drawn level with another corner", () => {
    // Going down from (7, 0): stop level with the room's bottom wall at y = 3.
    const result = snap({ x: 7.04, y: 3.07 }, room, { ...options, from: { x: 7, y: 0 } });
    expect(result).toMatchObject({ kind: "align", point: { x: 7, y: 3 } });
    expect(result.guides).toHaveLength(1);
  });

  it("lands a wall being drawn squarely on the wall it meets", () => {
    // Coming down from above the room towards its top wall, a little off line.
    const result = snap({ x: 1.04, y: -0.03 }, room, { ...options, from: { x: 1, y: -2 } });
    expect(result).toMatchObject({ kind: "wall", point: { x: 1, y: 0 } });
    expect(result.wallId).toBe(wallBetween(room, [0, 0], [4, 0]));
  });

  it("lands on the nearest point of a wall when coming in at an odd angle", () => {
    const result = snap({ x: 1.5, y: -0.03 }, room, { ...options, from: { x: 1, y: -2 } });
    expect(result.kind).toBe("wall");
    expect(result.point.x).toBeCloseTo(1.5);
    expect(result.point.y).toBeCloseTo(0);
  });

  it("never gives a wall being drawn no length", () => {
    const result = snap({ x: 6.01, y: 6 }, room, { ...options, from: { x: 6, y: 6 } });
    expect(result.point).toEqual({ x: 6.05, y: 6 });
  });

  it("ignores the vertices being dragged", () => {
    const corner = vertexAt(room, 4, 0);
    const result = snap({ x: 4.02, y: 0.03 }, room, { ...options, exclude: new Set([corner]) });
    expect(result.kind).not.toBe("vertex");
    expect(result.kind).not.toBe("wall");
  });

  it("does nothing when turned off", () => {
    const point = { x: 3.92, y: 0.07 };
    expect(snap(point, room, { ...options, enabled: false })).toEqual({
      point,
      kind: "none",
      guides: [],
    });
  });

  it("works without a grid", () => {
    expect(snap({ x: 10.02, y: 7.48 }, room, { tolerance: 0.15, grid: 0 })).toMatchObject({
      kind: "none",
      point: { x: 10.02, y: 7.48 },
    });
  });
});
