// Draws floors with three.js. This file and everything it imports from three
// is only loaded when a 3D view is actually on screen.

import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { findModel, modelUrl, type Catalogue } from "../core/catalogue";
import { buildFloorMesh, type Colour, type MeshData } from "../core/mesh";
import { QUALITY, type Quality } from "../core/quality";
import type { Floor, Item } from "../core/scene";
import { loadedModel, loadModel } from "./models";
import { FLOOR_COLOURS, OUTSIDE_COLOUR, WALL_TOP_COLOUR } from "./palette";

export interface SceneFloor {
  floor: Floor;
  /** Height of this floor's ground above the house's, in metres. */
  elevation: number;
}

export interface SceneContent {
  floors: readonly SceneFloor[];
  /** Where furniture models come from. Without it, furniture is not drawn. */
  catalogue?: Catalogue;
  highlightRoom?: string | null;
  highlightColour?: Colour;
}

const FIELD_OF_VIEW = 35;

export class SceneRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 500);
  private readonly controls: OrbitControls;
  private readonly house = new Group();
  private readonly sun = new DirectionalLight(0xfff4e0, 1.6);
  private readonly ground: Mesh;
  private readonly wallMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly slabMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly itemMaterial = new MeshLambertMaterial({ vertexColors: true });
  private readonly unknownMaterial = new MeshLambertMaterial({ color: 0xb8bcc2 });
  private readonly unknownGeometry = new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0);
  /** Goes up with every setContent: a model that arrives late knows whether
   * the scene it was for is still the one shown. */
  private generation = 0;
  private readonly quality: Quality;

  private frameRequest = 0;
  private disposed = false;
  /** Which floors the camera was last framed on. */
  private framedOn = "";
  /** Whether someone has moved the camera since it was last framed. */
  private cameraMoved = false;
  private centre = new Vector3();
  private radius = 5;

  /** Throws if the browser cannot give us WebGL. */
  constructor(quality: Quality) {
    this.quality = quality;
    const settings = QUALITY[quality];
    this.renderer = new WebGLRenderer({ antialias: settings.antialias, alpha: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";

    // Balanced so that a floor in full sun shows its own colour, neither
    // darker nor washed out, and one in shadow is a little over half as bright.
    this.scene.add(new HemisphereLight(0xffffff, 0xb8b0a4, 1.5));
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    this.sun.castShadow = settings.shadows;
    if (settings.shadows) {
      this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sun, this.sun.target);

    // Catches the house's shadow and is otherwise invisible.
    this.ground = new Mesh(
      new PlaneGeometry(1, 1),
      new ShadowMaterial({ opacity: 0.16, transparent: true }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.002;
    this.ground.receiveShadow = true;
    this.ground.visible = settings.shadows;
    this.scene.add(this.ground, this.house);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener("change", this.requestRender);
    this.controls.addEventListener("start", this.onCameraMoved);
  }

  /** Replace what is shown. The camera stays where it is unless the set of
   * floors changed or nothing was shown before. */
  setContent(content: SceneContent): void {
    this.generation++;
    this.clearHouse();
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { floor, elevation } of content.floors) {
      const mesh = buildFloorMesh(floor, {
        floorColours: FLOOR_COLOURS,
        outsideColour: OUTSIDE_COLOUR,
        wallTopColour: WALL_TOP_COLOUR,
        highlightRoom: content.highlightRoom,
        highlightColour: content.highlightColour,
      });
      this.addMesh(mesh.slabs, this.slabMaterial, elevation, false);
      this.addMesh(mesh.walls, this.wallMaterial, elevation, true);
      this.addItems(floor.items, elevation, content.catalogue);
      if (mesh.bounds) {
        min.min(new Vector3(mesh.bounds.min[0], mesh.bounds.min[1] + elevation, mesh.bounds.min[2]));
        max.max(new Vector3(mesh.bounds.max[0], mesh.bounds.max[1] + elevation, mesh.bounds.max[2]));
      }
    }

    const empty = !Number.isFinite(min.x);
    if (empty) {
      this.centre.set(0, 0, 0);
      this.radius = 4;
    } else {
      this.centre.copy(min).add(max).multiplyScalar(0.5);
      this.radius = Math.max(1.5, min.distanceTo(max) / 2);
    }
    this.placeLights();

    const key = empty ? "" : content.floors.map(({ floor }) => floor.id).join(",");
    if (key !== this.framedOn) {
      this.framedOn = key;
      this.frame();
    } else {
      this.limitZoom();
    }
    this.requestRender();
  }

  /** Point the camera at the whole house from the default angle. */
  frame(): void {
    this.cameraMoved = false;
    const direction = new Vector3(0.55, 0.95, 0.8).normalize();
    this.controls.target.copy(this.centre);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, this.fitDistance());
    this.limitZoom();
    this.controls.update();
    this.requestRender();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.quality].maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Until someone moves the camera, keep the whole house in the window.
    if (this.cameraMoved) this.limitZoom();
    else this.frame();
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.removeEventListener("start", this.onCameraMoved);
    this.controls.dispose();
    this.clearHouse();
    this.itemMaterial.dispose();
    this.unknownMaterial.dispose();
    this.unknownGeometry.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as ShadowMaterial).dispose();
    this.wallMaterial.dispose();
    this.slabMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private addMesh(
    data: MeshData,
    material: MeshLambertMaterial,
    elevation: number,
    castShadow: boolean,
  ): void {
    if (data.positions.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(data.positions), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(data.normals), 3));
    // Colours are written as they should look on screen; the renderer works
    // in linear light.
    const colours = new Float32Array(data.colours.length);
    const colour = new Color();
    for (let i = 0; i < colours.length; i += 3) {
      colour.setRGB(data.colours[i], data.colours[i + 1], data.colours[i + 2], SRGBColorSpace);
      colours[i] = colour.r;
      colours[i + 1] = colour.g;
      colours[i + 2] = colour.b;
    }
    geometry.setAttribute("color", new BufferAttribute(colours, 3));
    const mesh = new Mesh(geometry, material);
    mesh.position.y = elevation;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.ownsGeometry = true;
    this.house.add(mesh);
  }

  private clearHouse(): void {
    for (const child of [...this.house.children]) {
      this.house.remove(child);
      if (child instanceof InstancedMesh) child.dispose();
      // Furniture geometry is shared and cached; walls and floors are ours.
      else if (child instanceof Mesh && child.userData.ownsGeometry) child.geometry.dispose();
    }
  }

  /** Draw the furniture of one floor: one instanced mesh per model. */
  private addItems(items: readonly Item[], elevation: number, catalogue?: Catalogue): void {
    if (!catalogue || items.length === 0) return;
    const byModel = new Map<string, Item[]>();
    for (const item of items) byModel.set(item.model, [...(byModel.get(item.model) ?? []), item]);
    for (const [modelId, group] of byModel) {
      const model = findModel(catalogue, modelId);
      if (!model) {
        this.addInstances(this.unknownGeometry, this.unknownMaterial, group, elevation);
        continue;
      }
      const url = modelUrl(catalogue, model);
      const ready = loadedModel(url);
      if (ready) {
        this.addInstances(ready, this.itemMaterial, group, elevation);
        continue;
      }
      const generation = this.generation;
      loadModel(url).then(
        (geometry) => {
          if (this.disposed || generation !== this.generation) return;
          this.addInstances(geometry, this.itemMaterial, group, elevation);
          this.requestRender();
        },
        (error) => {
          console.warn(`Diorama: could not load the model ${modelId}`, error);
          if (this.disposed || generation !== this.generation) return;
          this.addInstances(this.unknownGeometry, this.unknownMaterial, group, elevation);
          this.requestRender();
        },
      );
    }
  }

  private addInstances(
    geometry: BufferGeometry,
    material: MeshLambertMaterial,
    items: readonly Item[],
    elevation: number,
  ): void {
    const mesh = new InstancedMesh(geometry, material, items.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const turn = new Quaternion();
    const scale = new Vector3();
    items.forEach((item, index) => {
      position.set(item.x, elevation + item.z, item.y);
      // The plan turns clockwise seen from above; three.js turns the other way.
      turn.setFromEuler(new Euler(0, (-item.rotation * Math.PI) / 180, 0));
      scale.setScalar(item.scale);
      mesh.setMatrixAt(index, matrix.compose(position, turn, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Instances are spread about; the model's own bounds would cull them.
    mesh.frustumCulled = false;
    this.house.add(mesh);
  }

  /** The distance from which a sphere round the house just fits the view,
   * allowing for a tall, narrow window. */
  private fitDistance(): number {
    const vertical = (FIELD_OF_VIEW * Math.PI) / 180 / 2;
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.2, this.camera.aspect));
    return (this.radius / Math.sin(Math.min(vertical, horizontal))) * 1.18;
  }

  private limitZoom(): void {
    this.controls.minDistance = Math.max(1, this.radius * 0.25);
    this.controls.maxDistance = this.fitDistance() * 3;
  }

  /** Keep the sun, its shadow and the ground sized to the house. */
  private placeLights(): void {
    const reach = this.radius * 1.6;
    this.sun.target.position.copy(this.centre);
    this.sun.position.copy(this.centre).add(new Vector3(-0.6, 1.4, 0.45).multiplyScalar(reach));
    const shadow = this.sun.shadow.camera;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = 0.1;
    shadow.far = reach * 5;
    shadow.updateProjectionMatrix();
    this.ground.scale.set(reach * 6, reach * 6, 1);
    this.ground.position.set(this.centre.x, -0.002, this.centre.z);
    this.camera.far = Math.max(500, reach * 30);
    this.camera.updateProjectionMatrix();
  }

  private onCameraMoved = (): void => {
    this.cameraMoved = true;
  };

  /** Draw once, soon. Nothing is drawn unless something asks. */
  private requestRender = (): void => {
    if (this.disposed || this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      if (this.disposed) return;
      // With damping the controls keep gliding: update() moves the camera a
      // little and fires "change", which asks for the next frame. When the
      // glide ends, so do the frames.
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  };
}
