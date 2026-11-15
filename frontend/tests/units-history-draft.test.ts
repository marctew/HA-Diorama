import { describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "../src/core/draft";
import {
  interiorPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  projectOnSegment,
  roundTo,
  segmentIntersection,
  signedArea,
} from "../src/core/geometry";
import { History } from "../src/core/history";
import { newId } from "../src/core/ids";
import { formatArea, formatLength, lengthForInput, parseLength } from "../src/core/units";
import { emptyFloor } from "./helpers";

describe("units", () => {
  it("formats lengths", () => {
    expect(formatLength(3.2, "metric")).toBe("3.20 m");
    expect(formatLength(0.05, "metric")).toBe("0.05 m");
    expect(formatLength(3.2, "imperial")).toBe("10′ 6″");
    expect(formatLength(0.3048 * 6 - 0.001, "imperial")).toBe("6′ 0″");
  });

  it("formats areas", () => {
    expect(formatArea(12.345, "metric")).toBe("12.3 m²");
    expect(formatArea(12, "imperial")).toBe("129 sq ft");
  });

  it.each([
    ["3.2", "metric", 3.2],
    ["3,2", "metric", 3.2],
    [" 3.2 m ", "metric", 3.2],
    ["320cm", "metric", 3.2],
    ["3200 mm", "metric", 3.2],
    [".5", "metric", 0.5],
    ["10", "imperial", 3.048],
    ["10ft", "metric", 3.048],
    ["10' 6\"", "imperial", 3.2004],
    ["10′ 6″", "imperial", 3.2004],
    ["10ft 6in", "metric", 3.2004],
    ["6in", "imperial", 0.1524],
    ["2m", "imperial", 2],
  ] as const)("reads %j (%s)", (text, system, metres) => {
    expect(parseLength(text, system)).toBeCloseTo(metres, 5);
  });

  it.each(["", "  ", "abc", "0", "-3", "3 4 5", "3m 20cm", "1e3", "ft"])("refuses %j", (text) => {
    expect(parseLength(text, "metric")).toBeUndefined();
  });

  it("gives a field value that reads back", () => {
    for (const system of ["metric", "imperial"] as const) {
      const shown = lengthForInput(3.2, system);
      expect(parseLength(shown, system)).toBeCloseTo(3.2, 2);
    }
    expect(lengthForInput(3.2, "metric")).toBe("3.2");
  });
});

describe("History", () => {
  it("undoes and redoes", () => {
    const history = new History("a");
    history.push("b");
    history.push("c");
    expect(history.canUndo).toBe(true);
    expect(history.undo()).toBe("b");
    expect(history.undo()).toBe("a");
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBe("a");
    expect(history.redo()).toBe("b");
    expect(history.redo()).toBe("c");
    expect(history.canRedo).toBe(false);
  });

  it("forgets the redo states after a new edit", () => {
    const history = new History("a");
    history.push("b");
    history.undo();
    history.push("c");
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe("a");
  });

  it("ignores a push of the present state", () => {
    const state = { n: 1 };
    const history = new History(state);
    history.push(state);
    expect(history.canUndo).toBe(false);
  });

  it("keeps a limited number of states", () => {
    const history = new History(0, 3);
    for (let n = 1; n <= 10; n++) history.push(n);
    expect([history.undo(), history.undo(), history.undo(), history.undo()]).toEqual([9, 8, 7, 7]);
  });

  it("resets", () => {
    const history = new History("a");
    history.push("b");
    history.reset("z");
    expect(history.present).toBe("z");
    expect(history.canUndo).toBe(false);
  });
});

describe("drafts", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  };

  it("saves, loads and clears per floor", () => {
    const storage = memory();
    const draft = { baseRevision: 4, floor: emptyFloor("f1"), savedAt: 1000 };
    saveDraft(storage, draft);
    expect(loadDraft(storage, "f1")).toEqual(draft);
    expect(loadDraft(storage, "f2")).toBeUndefined();
    clearDraft(storage, "f1");
    expect(loadDraft(storage, "f1")).toBeUndefined();
  });

  it("ignores anything that is not a draft of that floor", () => {
    const storage = memory();
    for (const junk of ["{", "null", '"x"', "{}", JSON.stringify({ baseRevision: 1, savedAt: 1, floor: emptyFloor("other") })]) {
      storage.data.set("diorama.draft.f1", junk);
      expect(loadDraft(storage, "f1")).toBeUndefined();
    }
  });

  it("carries on when storage is missing or broken", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const draft = { baseRevision: 0, floor: emptyFloor(), savedAt: 0 };
    expect(() => saveDraft(broken, draft)).not.toThrow();
    expect(loadDraft(broken, "f1")).toBeUndefined();
    expect(() => clearDraft(broken, "f1")).not.toThrow();
    expect(() => saveDraft(undefined, draft)).not.toThrow();
    expect(loadDraft(undefined, "f1")).toBeUndefined();
  });
});

describe("geometry", () => {
  const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];

  it("projects onto a segment and clamps to its ends", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 0 };
    expect(projectOnSegment({ x: 1, y: 2 }, a, b)).toEqual({ point: { x: 1, y: 0 }, t: 0.25, distance: 2 });
    expect(projectOnSegment({ x: 7, y: 4 }, a, b)).toMatchObject({ point: b, t: 1, distance: 5 });
    expect(projectOnSegment({ x: 1, y: 1 }, a, a).distance).toBeCloseTo(Math.SQRT2);
  });

  it("finds where segments cross", () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toEqual({ x: 1, y: 1 });
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 3 }, { x: 3, y: 0 })).toBeNull();
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBeNull();
  });

  it("measures polygons", () => {
    expect(signedArea(square)).toBe(4);
    expect(signedArea([...square].reverse())).toBe(-4);
    expect(polygonArea([...square].reverse())).toBe(4);
    expect(polygonCentroid(square)).toEqual({ x: 1, y: 1 });
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }])).toEqual({ x: 1, y: 0 });
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false);
  });

  it("finds a point inside an L shape", () => {
    const ell = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(polygonCentroid(ell), ell)).toBe(false);
    expect(pointInPolygon(interiorPoint(ell), ell)).toBe(true);
    expect(interiorPoint(square)).toEqual({ x: 1, y: 1 });
  });

  it("rounds without float noise", () => {
    expect(roundTo(0.1 + 0.2, 0.05)).toBe(0.3);
    expect(roundTo(1.234, 0)).toBe(1.234);
  });
});

describe("newId", () => {
  it("makes ids the server accepts", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("w")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{1,32}$/);
  });
});
