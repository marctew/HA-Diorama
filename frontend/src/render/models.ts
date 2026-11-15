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
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { needsSignIn } from "../core/catalogue";

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

/** Read a model from the bytes of a .glb file. */
export async function parseModel(data: ArrayBuffer): Promise<BufferGeometry> {
  return reduce(await loader.parseAsync(data, ""), "the file");
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

/** Whatever is in the file, as one geometry with a colour on every vertex. */
function reduce(gltf: GLTF, from: string): BufferGeometry {
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
    part.setAttribute("color", vertexColours(expanded, object.material));
    parts.push(part);
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) throw new Error(`No meshes in ${from}`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** The colours of a mesh: its own vertex colours if it has them, otherwise
 * its material's colour on every vertex. Textures are not used. */
function vertexColours(geometry: BufferGeometry, material: Material | Material[]): BufferAttribute {
  const count = geometry.getAttribute("position").count;
  const own = geometry.getAttribute("color");
  const colours = new Float32Array(count * 3);
  const base = new Color(1, 1, 1);
  const first = Array.isArray(material) ? material[0] : material;
  if (first && "color" in first) base.copy((first as MeshStandardMaterial).color);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = base.r * (own ? own.getX(i) : 1);
    colours[i * 3 + 1] = base.g * (own ? own.getY(i) : 1);
    colours[i * 3 + 2] = base.b * (own ? own.getZ(i) : 1);
  }
  return new BufferAttribute(colours, 3);
}
