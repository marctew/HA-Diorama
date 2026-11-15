// Small pictures of furniture models for the catalogue drawer, drawn with one
// tiny renderer that is reused for all of them.

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { loadModel } from "./models";

const SIZE = 144;

let renderer: WebGLRenderer | undefined;
let failed = false;
const scene = new Scene();
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const material = new MeshLambertMaterial({ vertexColors: true });
const pictures = new Map<string, Promise<string | undefined>>();
let queue: Promise<unknown> = Promise.resolve();

scene.add(new HemisphereLight(0xffffff, 0xb8b0a4, 1.5), new AmbientLight(0xffffff, 0.3));
const sun = new DirectionalLight(0xfff4e0, 1.6);
sun.position.set(-0.6, 1.4, 0.9);
scene.add(sun);

/** A picture of the model at `url`, as a data URL. Undefined if this browser
 * cannot draw it or the model cannot be loaded. */
export function thumbnail(url: string): Promise<string | undefined> {
  let picture = pictures.get(url);
  if (!picture) {
    // One at a time: they share a renderer.
    picture = queue.then(() => draw(url)).catch(() => undefined);
    queue = picture;
    pictures.set(url, picture);
  }
  return picture;
}

async function draw(url: string): Promise<string | undefined> {
  if (failed) return undefined;
  const geometry = await loadModel(url);
  if (!renderer) {
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      failed = true;
      return undefined;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
  }
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  const box = geometry.boundingBox ?? new Box3().setFromObject(mesh);
  const centre = box.getCenter(new Vector3());
  const radius = Math.max(0.2, box.getSize(new Vector3()).length() / 2);
  // From the front right, a little above: the usual catalogue angle.
  const direction = new Vector3(0.75, 0.62, 1).normalize();
  camera.position.copy(centre).addScaledVector(direction, radius * 4);
  camera.left = camera.bottom = -radius * 1.02;
  camera.right = camera.top = radius * 1.02;
  camera.near = 0.01;
  camera.far = radius * 10;
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  scene.remove(mesh);
  return renderer.domElement.toDataURL("image/png");
}
