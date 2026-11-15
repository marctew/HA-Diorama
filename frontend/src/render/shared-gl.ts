// One WebGL context for the whole page. Browsers allow only a handful, and a
// dashboard can hold any number of Diorama cards, so no view owns one: each
// asks this to draw its scene and gets the picture copied onto its own canvas.
// Models and materials are then also uploaded once, not once per card.

import { PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer, type Camera, type Scene } from "three";
import { deviceHints, pickQuality, QUALITY, type Quality } from "../core/quality";

export class SharedGl {
  readonly quality: Quality;
  /** How many pictures have been drawn, for anyone who wants to check that
   * nothing is drawn while nothing changes. */
  frames = 0;

  private readonly renderer: WebGLRenderer;
  private readonly restored = new Set<() => void>();

  /** Throws if the browser cannot give us WebGL. */
  constructor(quality: Quality) {
    this.quality = quality;
    const settings = QUALITY[quality];
    this.renderer = new WebGLRenderer({ antialias: settings.antialias, alpha: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
    this.renderer.setScissorTest(true);
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => event.preventDefault());
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      for (const listener of this.restored) listener();
    });
  }

  /** The most device pixels to draw for each CSS pixel. */
  get maxPixelRatio(): number {
    return QUALITY[this.quality].maxPixelRatio;
  }

  /** Draw a scene `width` by `height` device pixels and copy it onto `target`,
   * replacing what was there. */
  draw(scene: Scene, camera: Camera, target: CanvasRenderingContext2D): void {
    const width = target.canvas.width;
    const height = target.canvas.height;
    if (width <= 0 || height <= 0) return;
    const canvas = this.renderer.domElement;
    // The drawing surface only ever grows: resizing it is costly, and views of
    // different sizes take turns.
    if (canvas.width < width || canvas.height < height) {
      this.renderer.setSize(Math.max(canvas.width, width), Math.max(canvas.height, height), false);
    }
    // WebGL counts rows from the bottom; the copy below counts from the top.
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setScissor(0, 0, width, height);
    this.renderer.render(scene, camera);
    this.frames++;
    target.clearRect(0, 0, width, height);
    target.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
  }

  /** Be told when the context has come back after being lost: draw again. */
  onRestored(listener: () => void): () => void {
    this.restored.add(listener);
    return () => this.restored.delete(listener);
  }
}

let shared: SharedGl | undefined;
let unavailable = false;

/** The page's one renderer, made the first time it is asked for. Throws if
 * WebGL is not available. */
export function sharedGl(): SharedGl {
  if (unavailable) throw new Error("WebGL is not available");
  if (!shared) {
    try {
      shared = new SharedGl(pickQuality(deviceHints()));
    } catch (error) {
      unavailable = true;
      throw error;
    }
  }
  return shared;
}
