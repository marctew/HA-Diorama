// What fixtures add to the 3D scene: a marker to see and tap; for lights a
// glow and a wash of colour over the floor of their room; a reading beside a
// sensor; a tint over the floor of a room that is warm, cold or occupied; a
// leaf in every door, shut or open as its sensor says, and a blind in a
// window that has one.
// Lights are faked rather than simulated: it looks right for the style and
// costs almost nothing, on any device.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
} from "three";
import { MISSING, type FixtureVisual } from "../core/bindings";
import type { Catalogue } from "../core/catalogue";
import {
  allFixtures,
  fittingsSharing,
  fixtureHeight,
  isOpeningFixture,
  stripLight,
} from "../core/fixtures";
import { findModel, modelUrl } from "../core/catalogue";
import { itemScale } from "../core/items";
import { loadModel } from "./models";
import { triangulate } from "../core/geometry";
import { doorLeaves, slidingPanels } from "../core/openings";
import { roomPolygon } from "../core/rooms";
import type { Fixture, Floor, Opening } from "../core/scene";

/** How close to a fixture a tap has to land, in CSS pixels: a 44 pixel
 * target however small the fixture is on screen. */
const TAP_RADIUS = 22;
const WASH_HEIGHT = 0.012;
const TINT_HEIGHT = 0.007;
/** How far a door with a sensor swings when it is open, in radians. */
const DOOR_SWING = 1.3;
const LABEL_WIDTH = 256;
const LABEL_HEIGHT = 96;
/** How tall a reading is drawn, in metres, and the least it may be on
 * screen, in CSS pixels: from far off it is drawn bigger, to stay readable. */
const LABEL_SIZE = 0.26;
const LABEL_MIN_PIXELS = 22;

/** Finds the mesh of a wall, so that what is in the wall is lowered with it. */
export type WallLookup = (floorId: string, wallId: string) => Object3D | undefined;

const WASH_VERTEX = `
  varying vec2 vPlan;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPlan = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const WASH_FRAGMENT = `
  uniform vec2 uCentre;
  uniform float uRadius;
  uniform float uStrength;
  uniform vec3 uColour;
  varying vec2 vPlan;
  void main() {
    float fade = 1.0 - smoothstep(0.0, uRadius, distance(vPlan, uCentre));
    gl_FragColor = vec4(uColour * uStrength * fade * fade, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A door leaf: its angle when shut and which way it turns to open, or for
 * a sliding panel where it is when shut and how far it slides. */
interface Leaf {
  mesh: Mesh;
  shut: number;
  turn: number;
  slide?: { from: Vector3; by: Vector3 };
  /** How far open it stands when no sensor says: hinged doors open, so that
   * the rooms join up; sliding ones shut, as glass hides nothing. */
  rest: number;
}

interface Entry {
  fixture: Fixture;
  /** Where its light or marker is, in the scene. */
  anchor: Vector3;
  marker: Mesh;
  markerMaterial: MeshBasicMaterial;
  glow: Sprite;
  glowMaterial: SpriteMaterial;
  wash?: Mesh;
  washMaterial?: ShaderMaterial;
  tint?: Mesh;
  tintMaterial?: MeshBasicMaterial;
  label?: { sprite: Sprite; material: SpriteMaterial; texture: CanvasTexture; shown: string };
  /** The leaves of the door this fixture is the sensor of. */
  leaves?: Leaf[];
  /** How many fittings in the room are on the same entity as this one. */
  sharing: number;
  /** How big its glow is, against that of a lamp. */
  glowSize: number;
  /** A light panel: a skin over the whole piece, in the light's colour. */
  skin?: { mesh?: Mesh; material: MeshBasicMaterial };
  /** A strip of light: the bar itself, and the light it throws below. */
  strip?: { bar: Mesh; barMaterial: MeshBasicMaterial; pool: Mesh; poolMaterial: MeshBasicMaterial };
  /** The blind of a window, and the height of the window. */
  blind?: { mesh: Mesh; height: number };
}

export class FixtureLayer {
  readonly group = new Group();

  private entries: Entry[] = [];
  /** Every door leaf, with or without a sensor. */
  private leaves: Leaf[] = [];
  private visuals: ReadonlyMap<string, FixtureVisual> = new Map();
  private readonly lamps: PointLight[] = [];
  private readonly glowTexture = makeGlowTexture();
  private readonly markerGeometry = new SphereGeometry(0.075, 14, 10);
  private readonly stemGeometry = new CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0);
  private readonly stemMaterial = new MeshBasicMaterial({ color: 0x8a8f96 });
  private readonly discGeometry = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly barGeometry = new BoxGeometry(1, 0.022, 0.034);
  private readonly poolGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly leafMaterial = new MeshLambertMaterial({ color: 0xa9825a });
  private readonly glassMaterial = new MeshLambertMaterial({
    color: 0xbfdde6,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private readonly frameMaterial = new LineBasicMaterial({ color: 0x4d555c });
  private readonly blindMaterial = new MeshLambertMaterial({ color: 0xe9e4d8 });
  /** 0 by day to 1 at night: lights show up more in the dark. */
  private night = 0;

  /** `realLights` is how many true point lights to spend on lights that are
   * on, for devices that can afford it. */
  constructor(realLights: number) {
    for (let i = 0; i < realLights; i++) {
      const lamp = new PointLight(0xffffff, 0, 7, 1.6);
      lamp.visible = false;
      this.lamps.push(lamp);
      this.group.add(lamp);
    }
  }

  /** Replace the fixtures shown. `visuals` set before are applied again. */
  setFloors(
    floors: readonly { floor: Floor; elevation: number }[],
    catalogue: Catalogue | undefined,
    wallMesh: WallLookup = () => undefined,
  ): void {
    this.clear();
    for (const { floor, elevation } of floors) {
      // Every door has its leaves; a sensor, if it has one, moves them.
      const doors = new Map<string, Leaf[]>();
      for (const opening of floor.openings) {
        const leaves = this.buildLeaves(opening, floor, elevation, wallMesh);
        if (leaves.length > 0) doors.set(opening.id, leaves);
        this.leaves.push(...leaves);
      }
      const fixtures = allFixtures(floor);
      const sharing = fittingsSharing(fixtures);
      for (const fixture of fixtures) {
        const entry = this.build(fixture, floor, elevation, catalogue);
        entry.sharing = sharing.get(fixture.id) ?? 1;
        if (isOpeningFixture(fixture)) {
          this.buildOpening(entry, floor, elevation, wallMesh, doors);
        }
        this.entries.push(entry);
      }
    }
    this.apply();
  }

  /** Call before each picture is drawn, with the height of the picture in
   * CSS pixels: keeps readings big enough to read. */
  beforeDraw(camera: PerspectiveCamera, viewHeight: number): void {
    if (viewHeight <= 0) return;
    const perPixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewHeight;
    for (const entry of this.entries) {
      const sprite = entry.label?.sprite;
      if (!sprite?.visible) continue;
      const size = Math.max(
        LABEL_SIZE,
        camera.position.distanceTo(entry.anchor) * perPixel * LABEL_MIN_PIXELS,
      );
      sprite.scale.set((size * LABEL_WIDTH) / LABEL_HEIGHT, size, 1);
      sprite.position.y = entry.anchor.y + 0.13 + size / 2;
    }
  }

  /** How dark it is, 0 (day) to 1 (night). */
  setNight(night: number): void {
    this.night = Math.min(1, Math.max(0, night));
    this.apply();
  }

  /** Show each fixture as its entity now is. Fixtures left out are greyed. */
  setVisuals(visuals: ReadonlyMap<string, FixtureVisual>): void {
    this.visuals = visuals;
    this.apply();
  }

  /** The fixture nearest a point on screen, if one is within reach of a tap.
   * `x` and `y` are in CSS pixels from the top left of a canvas that is
   * `width` by `height`. */
  pick(x: number, y: number, width: number, height: number, camera: Camera): Fixture | undefined {
    let best: { fixture: Fixture; distance: number } | undefined;
    const projected = new Vector3();
    for (const entry of this.entries) {
      projected.copy(entry.anchor).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const px = ((projected.x + 1) / 2) * width;
      const py = ((1 - projected.y) / 2) * height;
      const distance = Math.hypot(px - x, py - y);
      if (distance <= TAP_RADIUS && (!best || distance < best.distance)) {
        best = { fixture: entry.fixture, distance };
      }
    }
    return best?.fixture;
  }

  dispose(): void {
    this.clear();
    this.glowTexture.dispose();
    this.markerGeometry.dispose();
    this.stemGeometry.dispose();
    this.stemMaterial.dispose();
    this.discGeometry.dispose();
    this.leafMaterial.dispose();
    this.glassMaterial.dispose();
    this.frameMaterial.dispose();
    this.blindMaterial.dispose();
    this.barGeometry.dispose();
    this.poolGeometry.dispose();
    for (const lamp of this.lamps) lamp.dispose();
  }

  private clear(): void {
    for (const entry of this.entries) {
      entry.markerMaterial.dispose();
      entry.glowMaterial.dispose();
      entry.washMaterial?.dispose();
      if (entry.wash && entry.wash.geometry !== this.discGeometry) entry.wash.geometry.dispose();
      entry.tintMaterial?.dispose();
      entry.tint?.geometry.dispose();
      entry.label?.material.dispose();
      entry.label?.texture.dispose();
      // This hangs off a wall, not this group.
      entry.blind?.mesh.removeFromParent();
      entry.blind?.mesh.geometry.dispose();
      entry.skin?.material.dispose();
      entry.strip?.barMaterial.dispose();
      entry.strip?.poolMaterial.dispose();
    }
    for (const leaf of this.leaves) {
      leaf.mesh.removeFromParent();
      leaf.mesh.geometry.dispose();
      for (const frame of leaf.mesh.children) {
        if (frame instanceof LineSegments) frame.geometry.dispose();
      }
    }
    this.leaves = [];
    this.entries = [];
    for (const child of [...this.group.children]) {
      if (!(child instanceof PointLight)) this.group.remove(child);
    }
  }

  private build(
    fixture: Fixture,
    floor: Floor,
    elevation: number,
    catalogue: Catalogue | undefined,
  ): Entry {
    const height = catalogue ? fixtureHeight(fixture, floor, catalogue) : fixture.z || 1.2;
    const anchor = new Vector3(fixture.x, elevation + height, fixture.y);
    const hasModel = fixture.item !== null || fixture.model !== null;
    const inWall = isOpeningFixture(fixture);

    const markerMaterial = new MeshBasicMaterial();
    const marker = new Mesh(this.markerGeometry, markerMaterial);
    marker.position.copy(anchor);
    if (inWall) marker.scale.setScalar(0.8);
    // A downlight is small: a marker the usual size would swallow it.
    const ownModel = catalogue && fixture.model ? findModel(catalogue, fixture.model) : undefined;
    const small = ownModel !== undefined && Math.max(ownModel.width, ownModel.depth) <= 0.15;
    if (small) marker.scale.setScalar(0.5);
    this.group.add(marker);
    const strip = catalogue ? stripLight(fixture, floor, catalogue) : undefined;
    const boundItem =
      fixture.item !== null ? floor.items.find((one) => one.id === fixture.item) : undefined;
    const boundModel = catalogue && boundItem ? findModel(catalogue, boundItem.model) : undefined;
    if (!hasModel && !inWall) {
      // Something to stand on, so that a marker in mid-air reads as being
      // somewhere in the room.
      const stem = new Mesh(this.stemGeometry, this.stemMaterial);
      stem.position.set(fixture.x, elevation, fixture.y);
      stem.scale.y = Math.max(0.01, height - 0.07);
      this.group.add(stem);
    }

    const glowMaterial = new SpriteMaterial({
      map: this.glowTexture,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const glow = new Sprite(glowMaterial);
    glow.position.copy(anchor);
    glow.visible = false;
    this.group.add(glow);

    const entry: Entry = {
      fixture,
      anchor,
      marker,
      markerMaterial,
      glow,
      glowMaterial,
      sharing: 1,
      // A downlight is a point of light, not a lampshade.
      glowSize: small ? 0.4 : 1,
    };
    if (catalogue && boundItem && boundModel?.lit) {
      // The whole panel takes the light's colour. Its shape is the model's
      // own, which may still be on its way.
      marker.visible = false;
      const material = new MeshBasicMaterial();
      const skin: Entry["skin"] = { material };
      entry.skin = skin;
      entry.glowSize = 0.6;
      const [sx, sy, sz] = itemScale(boundItem);
      void loadModel(modelUrl(catalogue, boundModel)).then(
        (geometry) => {
          if (!this.entries.includes(entry)) return;
          const mesh = new Mesh(geometry, material);
          mesh.position.set(boundItem.x, elevation + boundItem.z, boundItem.y);
          mesh.rotation.y = (-boundItem.rotation * Math.PI) / 180;
          // A hair bigger than the piece, so that it is the skin that shows.
          mesh.scale.set(sx * 1.02, sy * 1.02, sz * 1.5);
          skin.mesh = mesh;
          this.group.add(mesh);
          this.apply();
        },
        () => undefined,
      );
    }
    if (strip) {
      // The bar lights up along its length, and throws a band of light on
      // whatever is under it. No round marker: the bar is the thing to tap.
      marker.visible = false;
      const turn = (-strip.rotation * Math.PI) / 180;
      const barMaterial = new MeshBasicMaterial();
      const bar = new Mesh(this.barGeometry, barMaterial);
      bar.position.set(strip.x, elevation + strip.z + 0.008, strip.y);
      bar.scale.set(strip.length, 1, 1);
      bar.rotation.y = turn;
      const poolMaterial = new MeshBasicMaterial({
        map: this.glowTexture,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const pool = new Mesh(this.poolGeometry, poolMaterial);
      pool.position.set(strip.x, elevation + strip.below + 0.014, strip.y);
      pool.scale.set(strip.length + 0.35, 1, 0.75);
      pool.rotation.y = turn;
      pool.visible = false;
      this.group.add(bar, pool);
      entry.strip = { bar, barMaterial, pool, poolMaterial };
    }
    if (fixture.kind === "light") {
      entry.washMaterial = new ShaderMaterial({
        vertexShader: WASH_VERTEX,
        fragmentShader: WASH_FRAGMENT,
        uniforms: {
          uCentre: { value: new Vector2(fixture.x, fixture.y) },
          uRadius: { value: 3 },
          uStrength: { value: 0 },
          uColour: { value: new Color(1, 1, 1) },
        },
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      entry.wash = this.buildWash(fixture, floor, elevation, entry.washMaterial);
      entry.wash.visible = false;
      this.group.add(entry.wash);
    }
    if (fixture.kind === "climate" || fixture.kind === "presence") {
      const geometry = this.roomGeometry(fixture, floor, elevation + TINT_HEIGHT);
      if (geometry) {
        entry.tintMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
        entry.tint = new Mesh(geometry, entry.tintMaterial);
        entry.tint.visible = false;
        this.group.add(entry.tint);
      }
    }
    return entry;
  }

  /** The leaves of a door, hung in its wall and standing open. */
  private buildLeaves(
    opening: Opening,
    floor: Floor,
    elevation: number,
    wallMesh: WallLookup,
  ): Leaf[] {
    const wall = floor.walls.find((candidate) => candidate.id === opening.wall);
    const a = floor.vertices.find((vertex) => vertex.id === wall?.a);
    const b = floor.vertices.find((vertex) => vertex.id === wall?.b);
    if (!wall || !a || !b) return [];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return [];
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // Turning about the vertical runs the other way in three.js from the plan.
    const angle = -Math.atan2(along.y, along.x);
    const parent = wallMesh(floor.id, wall.id);
    // A wall's mesh is already at its floor's height.
    const base = parent ? 0 : elevation;
    const panel = (thickness: number): Mesh => {
      const geometry = new BoxGeometry(1, 1, thickness).translate(0.5, 0.5, 0);
      if (!opening.glazed) {
        const solid = new Mesh(geometry, this.leafMaterial);
        solid.castShadow = true;
        solid.receiveShadow = true;
        return solid;
      }
      // Glass, with its frame drawn as the edges of the pane.
      const glass = new Mesh(geometry, this.glassMaterial);
      glass.renderOrder = 1;
      glass.add(new LineSegments(new EdgesGeometry(geometry), this.frameMaterial));
      return glass;
    };
    const hinged: Leaf[] = doorLeaves(opening).map((leaf) => {
      const mesh = panel(0.045);
      mesh.position.set(a.x + along.x * leaf.hinge, base + opening.sill, a.y + along.y * leaf.hinge);
      mesh.scale.set(leaf.width, opening.height, 1);
      // A leaf hung from the far end lies back along the wall, and turns the
      // other way to open to the same side.
      const shut = leaf.towards === 1 ? angle : angle + Math.PI;
      const turn = -leaf.towards * opening.swing * DOOR_SWING;
      return { mesh, shut, turn, rest: 1 };
    });
    // Sliding panels run in two tracks, side by side in the wall.
    const sliding: Leaf[] = slidingPanels(opening).map((one) => {
      const mesh = panel(0.03);
      const across = one.track * 0.02;
      const from = new Vector3(
        a.x + along.x * one.from - along.y * across,
        base + opening.sill,
        a.y + along.y * one.from + along.x * across,
      );
      mesh.scale.set(one.width, opening.height, 1);
      const by = new Vector3(along.x * one.travel, 0, along.y * one.travel);
      return { mesh, shut: angle, turn: 0, slide: { from, by }, rest: 0 };
    });
    const leaves = [...hinged, ...sliding];
    for (const leaf of leaves) {
      setLeaf(leaf, leaf.rest);
      (parent ?? this.group).add(leaf.mesh);
    }
    return leaves;
  }

  /** What a door's or window's own entity adds: a blind for a cover, and for
   * a sensor the leaves it moves. */
  private buildOpening(
    entry: Entry,
    floor: Floor,
    elevation: number,
    wallMesh: WallLookup,
    doors: ReadonlyMap<string, Leaf[]>,
  ): void {
    const opening = floor.openings.find(
      (candidate: Opening) => `opening:${candidate.id}` === entry.fixture.id,
    );
    const wall = floor.walls.find((candidate) => candidate.id === opening?.wall);
    const a = floor.vertices.find((vertex) => vertex.id === wall?.a);
    const b = floor.vertices.find((vertex) => vertex.id === wall?.b);
    if (!opening || !wall || !a || !b) return;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return;
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const angle = -Math.atan2(along.y, along.x);
    const parent = wallMesh(floor.id, wall.id);
    const base = parent ? 0 : elevation;

    let mesh: Mesh | undefined;
    if (entry.fixture.kind === "cover" && opening.style === "sliding" && opening.type === "door") {
      // A powered sliding door: its panels follow the cover.
      entry.leaves = doors.get(opening.id);
      entry.marker.visible = false;
    } else if (entry.fixture.kind === "cover") {
      // A door that rolls or lifts has no leaves to swing.
      for (const leaf of doors.get(opening.id) ?? []) leaf.mesh.visible = false;
      // Hangs from the top of the opening; scaled to how far it is down.
      mesh = new Mesh(new BoxGeometry(1, 1, 1).translate(0, -0.5, 0), this.blindMaterial);
      const middle = opening.offset + opening.width / 2;
      mesh.position.set(a.x + along.x * middle, base + opening.sill + opening.height, a.y + along.y * middle);
      mesh.scale.set(opening.width * 0.98, opening.height, Math.max(0.04, wall.thickness * 0.5));
      mesh.rotation.y = angle;
      entry.blind = { mesh, height: opening.height };
      // The blind says it all, and would hide a marker anyway.
      entry.marker.visible = false;
    } else {
      entry.leaves = doors.get(opening.id);
    }
    if (!mesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent ?? this.group).add(mesh);
  }

  /** The floor a light falls on: its room, so that it stops at the walls; a
   * disc if it is in no room. */
  private buildWash(
    fixture: Fixture,
    floor: Floor,
    elevation: number,
    material: ShaderMaterial,
  ): Mesh {
    const geometry = this.roomGeometry(fixture, floor, elevation + WASH_HEIGHT);
    if (geometry) return new Mesh(geometry, material);
    const disc = new Mesh(this.discGeometry, material);
    disc.position.set(fixture.x, elevation + WASH_HEIGHT, fixture.y);
    disc.scale.setScalar(4.5);
    return disc;
  }

  /** The floor of a fixture's room, flat, at a height; nothing if it is in
   * no room. */
  private roomGeometry(fixture: Fixture, floor: Floor, height: number): BufferGeometry | undefined {
    const room = floor.rooms.find((candidate) => candidate.id === fixture.room);
    const outline = room ? roomPolygon(floor, room) : [];
    if (outline.length < 3) return undefined;
    const indices = triangulate(outline);
    const positions = new Float32Array(indices.length * 3);
    // Reversed, to face up: see flat() in core/mesh.ts.
    for (let i = 0; i < indices.length; i += 3) {
      [indices[i], indices[i + 2], indices[i + 1]].forEach((index, corner) => {
        positions[(i + corner) * 3] = outline[index].x;
        positions[(i + corner) * 3 + 1] = height;
        positions[(i + corner) * 3 + 2] = outline[index].y;
      });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    return geometry;
  }

  /** Show, change or hide the reading beside a fixture. */
  private applyLabel(entry: Entry, visual: FixtureVisual): void {
    const text = visual.available ? (visual.label ?? "") : "";
    if (!text) {
      if (entry.label) entry.label.sprite.visible = false;
      return;
    }
    if (!entry.label) {
      const canvas = document.createElement("canvas");
      canvas.width = LABEL_WIDTH;
      canvas.height = LABEL_HEIGHT;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new Sprite(material);
      sprite.scale.set((LABEL_SIZE * LABEL_WIDTH) / LABEL_HEIGHT, LABEL_SIZE, 1);
      sprite.position.copy(entry.anchor);
      sprite.position.y += 0.13 + LABEL_SIZE / 2;
      sprite.renderOrder = 2;
      this.group.add(sprite);
      entry.label = { sprite, material, texture, shown: "" };
    }
    entry.label.sprite.visible = true;
    const [r, g, b] = visual.colour.map((channel) => Math.round(channel * 255));
    const shown = `${text}|${r},${g},${b}`;
    if (shown === entry.label.shown) return;
    entry.label.shown = shown;
    drawLabel(entry.label.texture.image as HTMLCanvasElement, text, `rgb(${r},${g},${b})`);
    entry.label.texture.needsUpdate = true;
  }

  private apply(): void {
    const colour = new Color();
    const lit: { entry: Entry; visual: FixtureVisual }[] = [];
    // How many different lights are on in each room: three lamps do not make
    // a floor three times as bright, or it would be white.
    const lightsOn = new Map<string, Set<string>>();
    for (const entry of this.entries) {
      const visual = this.visuals.get(entry.fixture.id) ?? MISSING;
      if (!entry.wash || !visual.available || !visual.glows) continue;
      const room = entry.fixture.room ?? "";
      lightsOn.set(room, (lightsOn.get(room) ?? new Set()).add(entry.fixture.entity_id));
    }
    for (const entry of this.entries) {
      const visual = this.visuals.get(entry.fixture.id) ?? MISSING;
      colour.setRGB(visual.colour[0], visual.colour[1], visual.colour[2], SRGBColorSpace);
      entry.markerMaterial.color.copy(colour);
      entry.markerMaterial.transparent = !visual.available;
      entry.markerMaterial.opacity = visual.available ? 1 : 0.45;
      const glowing = visual.available && visual.glows;
      entry.glow.visible = glowing && !entry.strip;
      if (entry.skin) {
        entry.skin.material.color.copy(colour);
        // Off, the panel is its own white.
        if (entry.skin.mesh) entry.skin.mesh.visible = visual.available && visual.on;
      }
      if (entry.strip) {
        entry.strip.barMaterial.color.copy(colour);
        entry.strip.pool.visible = glowing;
        entry.strip.poolMaterial.color.copy(colour);
        entry.strip.poolMaterial.opacity = (0.35 + 0.45 * visual.level) * (1 + 0.3 * this.night);
      }
      if (glowing) {
        entry.glowMaterial.color.copy(colour);
        entry.glowMaterial.opacity = 0.55 + 0.45 * visual.level;
        entry.glow.scale.setScalar((0.7 + 0.9 * visual.level) * entry.glowSize);
        lit.push({ entry, visual });
      }
      if (entry.wash && entry.washMaterial) {
        entry.wash.visible = glowing;
        if (glowing) {
          const uniforms = entry.washMaterial.uniforms;
          (uniforms.uColour.value as Color).copy(colour);
          // Fittings on one switch light the room between them; a strip
          // lights what is under it more than it lights the room.
          const others = lightsOn.get(entry.fixture.room ?? "")?.size ?? 1;
          // A strip, a panel or a small lamp lights the room less than a
          // ceiling light does.
          const reach = entry.strip ? 0.3 : entry.skin || entry.glowSize < 1 ? 0.5 : 1;
          const share = reach / entry.sharing / Math.sqrt(others);
          uniforms.uStrength.value =
            (0.1 + 0.22 * visual.level) * (1 + 0.3 * this.night) * share;
          uniforms.uRadius.value = 2.4 + 1.6 * visual.level;
        }
      }
      if (entry.tint && entry.tintMaterial) {
        const strength = visual.available ? (visual.tint ?? 0) : 0;
        entry.tint.visible = strength > 0;
        entry.tintMaterial.color.copy(colour);
        entry.tintMaterial.opacity = strength;
      }
      this.applyLabel(entry, visual);
      const open = visual.available ? (visual.open ?? 0) : 0;
      for (const leaf of entry.leaves ?? []) setLeaf(leaf, open);
      if (entry.blind) {
        // Never quite gone: rolled up, it is still a strip at the top.
        const down = Math.max(0.07 / entry.blind.height, 1 - open);
        entry.blind.mesh.scale.y = Math.min(1, down) * entry.blind.height;
      }
    }
    // The brightest lights get the real point lights.
    lit.sort((a, b) => b.visual.level - a.visual.level);
    this.lamps.forEach((lamp, index) => {
      const source = lit[index];
      lamp.visible = Boolean(source);
      if (!source) return;
      lamp.position.copy(source.entry.anchor);
      lamp.color.setRGB(
        source.visual.colour[0],
        source.visual.colour[1],
        source.visual.colour[2],
        SRGBColorSpace,
      );
      lamp.intensity = 4 * source.visual.level;
    });
  }
}

/** Put a door leaf or sliding panel where it is when this far open, 0 to 1. */
function setLeaf(leaf: Leaf, open: number): void {
  leaf.mesh.rotation.y = leaf.shut + leaf.turn * open;
  if (leaf.slide) leaf.mesh.position.copy(leaf.slide.from).addScaledVector(leaf.slide.by, open);
}

/** A soft round blob: white in the middle, fading to nothing. */
function makeGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A reading on a dark pill, ringed with its colour. */
function drawLabel(canvas: HTMLCanvasElement, text: string, colour: string): void {
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  let size = 50;
  const font = () => `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  context.font = font();
  // Longer readings are set smaller rather than cut off.
  while (size > 22 && context.measureText(text).width > canvas.width - 48) {
    size -= 2;
    context.font = font();
  }
  const width = Math.min(canvas.width - 8, context.measureText(text).width + 44);
  const height = canvas.height - 16;
  const left = (canvas.width - width) / 2;
  context.beginPath();
  context.roundRect(left, 8, width, height, height / 2);
  context.fillStyle = "rgba(22, 26, 32, 0.88)";
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = colour;
  context.stroke();
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
}
