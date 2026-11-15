// Getting someone's own model ready to keep: read it, measure it, and write
// it out again the way the bundled models are (one mesh, real size, standing
// on the floor, middle on the origin, colours on its vertices, no textures).
// Whatever the file was, what is stored is small and draws like the rest.

import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Vector3, type Texture } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { decoderPath } from "../core/decoder";
import { sampleColour } from "../core/texture";
import type { ModelSize } from "../core/upload";
import { reduce, type TextureReader } from "./models";
import { pictureOf } from "./thumbnails";

let loader: GLTFLoader | undefined;

/** A loader for whatever people bring: shop and scanner models are usually
 * compressed, with Draco or Meshopt, which the bundled models never are. */
function importLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(decoderPath(import.meta.url));
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

/** The side a picture is shrunk to before its colours are read. */
const SAMPLE_SIZE = 256;

/** Reads colours out of a model's pictures. Each is drawn once, small. */
function textureReader(): TextureReader {
  const read = new Map<Texture, ReturnType<TextureReader>>();
  return (map) => {
    if (read.has(map)) return read.get(map);
    let sampler: ReturnType<TextureReader>;
    try {
      const image = map.image as CanvasImageSource & { width: number; height: number };
      const width = Math.max(1, Math.min(SAMPLE_SIZE, image.width));
      const height = Math.max(1, Math.min(SAMPLE_SIZE, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      // A picture put on upside down is read upside down.
      sampler = (u, v) => sampleColour(pixels, width, height, u, map.flipY ? 1 - v : v);
    } catch (error) {
      console.warn("Diorama: a picture on the model could not be read", error);
    }
    read.set(map, sampler);
    return sampler;
  };
}

export interface ReadModel {
  geometry: BufferGeometry;
  /** The box it fills as drawn, in whatever units the file is in. */
  size: ModelSize;
  /** A picture of it, if this browser can draw one. */
  picture?: string;
}

/** Read the bytes of a .glb file. Rejects if there is no model in them. */
export async function readModel(data: ArrayBuffer): Promise<ReadModel> {
  const gltf = await importLoader().parseAsync(data, "");
  const geometry = reduce(gltf, "the file", textureReader());
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) throw new Error("The file has nothing in it to draw.");
  const extent = box.getSize(new Vector3());
  const picture = await pictureOf(geometry).catch(() => undefined);
  return { geometry, size: { width: extent.x, depth: extent.z, height: extent.y }, picture };
}

/** The model at a scale, as the bytes of a .glb file ready to send. */
/** The same shape in fewer bytes: a colour is a byte a channel, which is
 * all a screen shows, and a corner that several faces share with the same
 * colour and facing is written once. A detailed model is a quarter of the
 * size for it. */
function compact(geometry: BufferGeometry): BufferGeometry {
  const colour = geometry.getAttribute("color");
  if (colour) {
    const bytes = new Uint8Array(colour.count * 3);
    for (let i = 0; i < colour.count; i++) {
      bytes[i * 3] = Math.round(Math.min(1, Math.max(0, colour.getX(i))) * 255);
      bytes[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, colour.getY(i))) * 255);
      bytes[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, colour.getZ(i))) * 255);
    }
    geometry.setAttribute("color", new BufferAttribute(bytes, 3, true));
  }
  return mergeVertices(geometry);
}

export async function prepareModel(model: ReadModel, scale: number): Promise<ArrayBuffer> {
  const loose = model.geometry.clone();
  const box = model.geometry.boundingBox!;
  const middle = box.getCenter(new Vector3());
  // Middle on the origin, feet on the floor, then to size.
  loose.translate(-middle.x, -box.min.y, -middle.z);
  loose.scale(scale, scale, scale);
  const geometry = compact(loose);
  loose.dispose();
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
