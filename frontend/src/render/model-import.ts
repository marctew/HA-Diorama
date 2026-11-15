// Getting someone's own model ready to keep: read it, measure it, and write
// it out again the way the bundled models are (one mesh, real size, standing
// on the floor, middle on the origin, colours on its vertices, no textures).
// Whatever the file was, what is stored is small and draws like the rest.

import { BufferGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ModelSize } from "../core/upload";
import { parseModel } from "./models";
import { pictureOf } from "./thumbnails";

export interface ReadModel {
  geometry: BufferGeometry;
  /** The box it fills as drawn, in whatever units the file is in. */
  size: ModelSize;
  /** A picture of it, if this browser can draw one. */
  picture?: string;
}

/** Read the bytes of a .glb file. Rejects if there is no model in them. */
export async function readModel(data: ArrayBuffer): Promise<ReadModel> {
  const geometry = await parseModel(data);
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) throw new Error("The file has nothing in it to draw.");
  const extent = box.getSize(new Vector3());
  const picture = await pictureOf(geometry).catch(() => undefined);
  return { geometry, size: { width: extent.x, depth: extent.z, height: extent.y }, picture };
}

/** The model at a scale, as the bytes of a .glb file ready to send. */
export async function prepareModel(model: ReadModel, scale: number): Promise<ArrayBuffer> {
  const geometry = model.geometry.clone();
  const box = model.geometry.boundingBox!;
  const middle = box.getCenter(new Vector3());
  // Middle on the origin, feet on the floor, then to size.
  geometry.translate(-middle.x, -box.min.y, -middle.z);
  geometry.scale(scale, scale, scale);
  const material = new MeshStandardMaterial({ vertexColors: true });
  try {
    const result = await new GLTFExporter().parseAsync(new Mesh(geometry, material), {
      binary: true,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("The model could not be written.");
    return result;
  } finally {
    geometry.dispose();
    material.dispose();
  }
}
