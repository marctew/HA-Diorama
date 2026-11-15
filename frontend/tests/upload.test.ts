import { describe, expect, it } from "vitest";
import {
  acceptableSize,
  likelyScale,
  modelFileId,
  modelName,
  scaledSize,
  scaleFor,
  sizeProblem,
  uploadPath,
} from "../src/core/upload";
import {
  findModel,
  isOwnModel,
  modelUrl,
  needsSignIn,
  type Catalogue,
  type CatalogueModel,
} from "../src/core/catalogue";

describe("modelName", () => {
  it("makes a name from a file name", () => {
    expect(modelName("my_arm-chair.v2.glb")).toBe("My arm chair v2");
    expect(modelName("C:\\Models\\Piano.GLB")).toBe("Piano");
    expect(modelName("/home/me/desk.gltf")).toBe("Desk");
    expect(modelName(".glb")).toBe("My model");
    expect(modelName("___.glb")).toBe("My model");
    expect(modelName(`${"long ".repeat(30)}.glb`).length).toBeLessThanOrEqual(60);
  });
});

describe("sizes", () => {
  const box = { width: 2, depth: 1, height: 0.5 };

  it("scales every dimension together", () => {
    expect(scaledSize(box, 0.5)).toEqual({ width: 1, depth: 0.5, height: 0.25 });
    expect(scaledSize({ width: 1 / 3, depth: 1, height: 1 }, 1).width).toBe(0.333);
  });

  it("works out the scale from the one dimension you know", () => {
    expect(scaleFor(box, "width", 1)).toBe(0.5);
    expect(scaleFor(box, "height", 1)).toBe(2);
    expect(scaleFor(box, "depth", 0)).toBeUndefined();
    expect(scaleFor(box, "depth", -1)).toBeUndefined();
    expect(scaleFor(box, "depth", Number.NaN)).toBeUndefined();
    expect(scaleFor({ ...box, depth: 0 }, "depth", 1)).toBeUndefined();
  });

  it("guesses millimetres and centimetres", () => {
    expect(likelyScale({ width: 1.8, depth: 0.9, height: 0.8 })).toBe(1);
    expect(likelyScale({ width: 180, depth: 90, height: 80 })).toBe(0.01);
    expect(likelyScale({ width: 1800, depth: 900, height: 800 })).toBe(0.001);
    // A long dining table in metres is left alone.
    expect(likelyScale({ width: 3.2, depth: 1.1, height: 0.75 })).toBe(1);
  });

  it("says when a size cannot be right", () => {
    expect(sizeProblem(box)).toBeUndefined();
    expect(sizeProblem({ width: 2, depth: 1.4, height: 0.004 })).toBeUndefined(); // a rug
    expect(sizeProblem({ width: 31, depth: 1, height: 1 })).toMatch(/more than 30 m/);
    expect(sizeProblem({ width: 0.01, depth: 0.02, height: 0.01 })).toMatch(/too small/);
    expect(sizeProblem({ width: Number.NaN, depth: 1, height: 1 })).toMatch(/no size/);
  });

  it("keeps a size within what the server takes", () => {
    expect(acceptableSize({ width: 2, depth: 1.4, height: 0.004 })).toEqual({ width: 2, depth: 1.4, height: 0.01 });
    expect(acceptableSize({ width: 45, depth: 1, height: 1 }).width).toBe(30);
  });
});

describe("uploadPath", () => {
  it("puts the details in the query string", () => {
    const path = uploadPath({ name: "  Grand piano & stool ", width: 1.5, depth: 2.2, height: 1.02, against_wall: true });
    const url = new URL(path, "http://ha.local");
    expect(url.pathname).toBe("/api/diorama/models");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: "Grand piano & stool",
      width: "1.5",
      depth: "2.2",
      height: "1.02",
      against_wall: "true",
    });
  });

  it("says what the model is, when it is something", () => {
    const base = { name: "Lamp", width: 0.3, depth: 0.3, height: 0.5, against_wall: false };
    const kindOf = (path: string) => new URL(path, "http://ha.local").searchParams.get("kind");
    expect(kindOf(uploadPath({ ...base, kind: "light" }))).toBe("light");
    expect(kindOf(uploadPath({ ...base, kind: null }))).toBeNull();
    expect(kindOf(uploadPath(base))).toBeNull();
  });

  it("finds the file id in a catalogue id", () => {
    expect(modelFileId("user/m_0123456789abcdef")).toBe("m_0123456789abcdef");
  });
});

describe("a catalogue with models of your own", () => {
  const model = (change: Partial<CatalogueModel>): CatalogueModel => ({
    id: "basics/sofa",
    name: "Sofa",
    category: "Living room",
    tags: [],
    source: "basics",
    file: "models/basics/sofa.glb",
    width: 1,
    depth: 1,
    height: 1,
    centre: [0, 0],
    against_wall: false,
    ...change,
  });
  const own = model({ id: "user/m_0123456789abcdef", source: "user", file: "", url: "/api/diorama/models/m_0123456789abcdef", category: "My models" });
  const catalogue: Catalogue = { version: 1, base_url: "/diorama_assets/0.1.0", sources: [], models: [model({}), own] };

  it("fetches bundled models from the public folder and your own signed in", () => {
    expect(modelUrl(catalogue, catalogue.models[0])).toBe("/diorama_assets/0.1.0/models/basics/sofa.glb");
    expect(modelUrl(catalogue, own)).toBe("/api/diorama/models/m_0123456789abcdef");
    expect(needsSignIn("/diorama_assets/0.1.0/models/basics/sofa.glb")).toBe(false);
    expect(needsSignIn(modelUrl(catalogue, own))).toBe(true);
  });

  it("knows which are yours", () => {
    expect(isOwnModel(own)).toBe(true);
    expect(isOwnModel(catalogue.models[0])).toBe(false);
    expect(findModel(catalogue, own.id)).toBe(own);
  });
});
