import { describe, expect, it } from "vitest";
import { NO_SELECTION, isEmpty, prune, selectionCount, toggle } from "../src/editor/selection";
import { fit, gridStep, scaleBarLength, toScreen, toWorld, zoomAt } from "../src/editor/view";
import { counter, emptyFloor, rectangle, ITEM_DEFAULTS } from "./helpers";

describe("view", () => {
  const view = { scale: 50, x: 100, y: 40 };

  it("converts both ways", () => {
    const screen = toScreen(view, { x: 2, y: 3 });
    expect(screen).toEqual({ x: 200, y: 190 });
    expect(toWorld(view, screen)).toEqual({ x: 2, y: 3 });
  });

  it("zooms about a point", () => {
    const anchor = { x: 300, y: 200 };
    const zoomed = zoomAt(view, anchor, 2);
    expect(zoomed.scale).toBe(100);
    expect(toWorld(zoomed, anchor)).toEqual(toWorld(view, anchor));
  });

  it("stops zooming at the limits", () => {
    expect(zoomAt(view, { x: 0, y: 0 }, 1e6).scale).toBe(1500);
    expect(zoomAt(view, { x: 0, y: 0 }, 1e-6).scale).toBe(4);
  });

  it("fits a floor into the window, centred", () => {
    const floor = rectangle(emptyFloor(), counter(), 2, 1, 8, 4);
    const fitted = fit(floor, 1000, 600);
    expect(fitted.scale).toBeCloseTo(105);
    expect(toScreen(fitted, { x: 6, y: 3 })).toEqual({ x: 500, y: 300 });
    const corner = toScreen(fitted, { x: 2, y: 1 });
    expect(corner.x).toBeGreaterThanOrEqual(79);
    expect(corner.y).toBeGreaterThanOrEqual(79);
  });

  it("keeps other points in view too, such as a plan image", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 2);
    const fitted = fit(floor, 1000, 600, 80, [{ x: -6, y: -4 }, { x: 10, y: 8 }]);
    for (const point of [{ x: -6, y: -4 }, { x: 10, y: 8 }]) {
      const screen = toScreen(fitted, point);
      expect(screen.x).toBeGreaterThanOrEqual(79);
      expect(screen.x).toBeLessThanOrEqual(921);
      expect(screen.y).toBeGreaterThanOrEqual(79);
      expect(screen.y).toBeLessThanOrEqual(521);
    }
    // And an image alone, before anything is drawn.
    expect(fit(emptyFloor(), 1000, 600, 80, [{ x: 0, y: 0 }, { x: 10, y: 5 }]).scale).toBeCloseTo(84);
  });

  it("puts the origin in the middle of an empty floor", () => {
    expect(fit(emptyFloor(), 800, 600)).toEqual({ scale: 60, x: 400, y: 300 });
  });

  it("does not zoom absurdly far into a tiny floor", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 0.2, 0.2);
    expect(fit(floor, 1000, 600).scale).toBe(160);
  });

  it("picks a grid that stays readable", () => {
    expect(gridStep(400)).toBe(0.05);
    expect(gridStep(100)).toBe(0.1);
    expect(gridStep(60)).toBe(0.5);
    expect(gridStep(12)).toBe(1);
    expect(gridStep(4)).toBe(5);
  });

  it("picks a round scale bar", () => {
    expect(scaleBarLength(60)).toBe(1);
    expect(scaleBarLength(200)).toBe(0.5);
    expect(scaleBarLength(8)).toBe(10);
  });
});

describe("selection", () => {
  it("knows when it is empty", () => {
    expect(isEmpty(NO_SELECTION)).toBe(true);
    expect(isEmpty({ ...NO_SELECTION, room: "r1" })).toBe(false);
  });

  it("toggles", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });

  it("drops what the floor no longer has", () => {
    const floor = rectangle(emptyFloor(), counter(), 0, 0, 4, 3);
    const withSofa = { ...floor, items: [{ id: "i1", model: "basics/sofa_2", x: 1, y: 1, z: 0, rotation: 0, scale: 1, room: null , ...ITEM_DEFAULTS}] };
    const kept = { vertices: [floor.vertices[0].id], walls: [floor.walls[0].id], items: ["i1"], fixtures: [], openings: [], room: floor.rooms[0].id };
    expect(prune(kept, withSofa)).toBe(kept);
    expect(
      prune({ vertices: ["gone", floor.vertices[0].id], walls: ["gone"], items: ["i1", "i9"], fixtures: ["x9"], openings: ["o9"], room: "gone" }, withSofa),
    ).toEqual({ vertices: [floor.vertices[0].id], walls: [], items: ["i1"], fixtures: [], openings: [], room: null });
    expect(selectionCount(kept)).toBe(3);
  });
});
