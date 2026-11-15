// Loads furniture models. Whatever is in the .glb file, what comes out is
// one geometry with a colour on every vertex, ready to be drawn many times
// with a single shared material.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  type Material,
  type MeshStandardMaterial,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { needsSignIn } from "../core/catalogue";
import type { Colour } from "../core/mesh";

/** Fetches a file of Home Assistant's as the signed-in user. */
type PrivateFetch = (path: string) => Promise<Response>;

const loader = new GLTFLoader();
let privateFetch: PrivateFetch | undefined;
const cache = new Map<string, Promise<BufferGeometry>>();
const loaded = new Map<string, BufferGeometry>();

/** The geometry of the model at `url` if it has already been loaded. Lets a
 * scene be rebuilt in one go, with no frame where the furniture is missing. */
export function loadedModel(url: string): BufferGeometry | undefined {
  return loaded.get(url);
}

/** The geometry of the model at `url`. Each file is fetched once. */
export function loadModel(url: string): Promise<BufferGeometry> {
  let pending = cache.get(url);
  if (!pending) {
    pending = loadGltf(url).then((gltf) => {
      const merged = reduce(gltf, url);
      loaded.set(url, merged);
      return merged;
    });
    // A failed download can be tried again later.
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}


/** Say how to fetch the models people added themselves, which are only
 * handed to someone signed in. Call it whenever `hass` is at hand. */
export function setPrivateFetch(fetcher: PrivateFetch | undefined): void {
  privateFetch = fetcher;
}

async function loadGltf(url: string): Promise<GLTF> {
  if (!needsSignIn(url)) return loader.loadAsync(url);
  if (!privateFetch) throw new Error(`Not signed in to fetch ${url}`);
  const response = await privateFetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return loader.parseAsync(await response.arrayBuffer(), "");
}

/** Reads the colour of a texture at a point of it (linear light), or
 * nothing if the texture cannot be read. */
export type TextureReader = (map: Texture) => ((u: number, v: number) => Colour) | undefined;

/** Whatever is in the file, as one geometry with a colour on every vertex.
 * With `readTexture`, a face with a picture on it takes the colour of the
 * picture at its middle; without, pictures are left out. */
export function reduce(gltf: GLTF, from: string, readTexture?: TextureReader): BufferGeometry {
  gltf.scene.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const source = object.geometry as BufferGeometry;
    const part = new BufferGeometry();
    const expanded = source.index ? source.toNonIndexed() : source;
    part.setAttribute("position", expanded.getAttribute("position").clone());
    if (expanded.getAttribute("normal")) {
      part.setAttribute("normal", expanded.getAttribute("normal").clone());
    }
    part.applyMatrix4(object.matrixWorld);
    if (!part.getAttribute("normal")) part.computeVertexNormals();
    part.setAttribute("color", vertexColours(expanded, object.material, readTexture));
    parts.push(part);
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) throw new Error(`No meshes in ${from}`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** The colours of a mesh: its material's colour, times its own vertex
 * colours if it has them, times the colour of its picture at the middle of
 * each face if pictures are being read. The geometry is not indexed: every
 * three vertices are a face. */
function vertexColours(
  geometry: BufferGeometry,
  material: Material | Material[],
  readTexture?: TextureReader,
): BufferAttribute {
  const count = geometry.getAttribute("position").count;
  const own = geometry.getAttribute("color");
  const uv = geometry.getAttribute("uv");
  const colours = new Float32Array(count * 3);
  const base = new Color(1, 1, 1);
  const first = Array.isArray(material) ? material[0] : material;
  if (first && "color" in first) base.copy((first as MeshStandardMaterial).color);
  const map = first && "map" in first ? (first as MeshStandardMaterial).map : null;
  const picture = map && uv && readTexture ? readTexture(map) : undefined;
  for (let face = 0; face < count; face += 3) {
    // One colour for the whole face, as the rest of the furniture has.
    const paint: Colour = picture
      ? picture(
          (uv.getX(face) + uv.getX(face + 1) + uv.getX(face + 2)) / 3,
          (uv.getY(face) + uv.getY(face + 1) + uv.getY(face + 2)) / 3,
        )
      : [1, 1, 1];
    for (let i = face; i < Math.min(face + 3, count); i++) {
      colours[i * 3] = base.r * paint[0] * (own ? own.getX(i) : 1);
      colours[i * 3 + 1] = base.g * paint[1] * (own ? own.getY(i) : 1);
      colours[i * 3 + 2] = base.b * paint[2] * (own ? own.getZ(i) : 1);
    }
  }
  return new BufferAttribute(colours, 3);
}
