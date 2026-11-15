// What fixtures add to the 3D scene: a marker to see and tap, and for lights
// a glow and a wash of colour over the floor of their room. Lights are faked
// this way rather than simulated: it looks right for the style and costs
// almost nothing, on any device.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
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
import { fixtureHeight } from "../core/fixtures";
import { triangulate } from "../core/geometry";
import { roomPolygon } from "../core/rooms";
import type { Fixture, Floor } from "../core/scene";

/** How close to a fixture a tap has to land, in CSS pixels: a 44 pixel
 * target however small the fixture is on screen. */
const TAP_RADIUS = 22;
const WASH_HEIGHT = 0.012;

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
}

export class FixtureLayer {
  readonly group = new Group();

  private entries: Entry[] = [];
  private visuals: ReadonlyMap<string, FixtureVisual> = new Map();
  private readonly lamps: PointLight[] = [];
  private readonly glowTexture = makeGlowTexture();
  private readonly markerGeometry = new SphereGeometry(0.075, 14, 10);
  private readonly stemGeometry = new CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0);
  private readonly stemMaterial = new MeshBasicMaterial({ color: 0x8a8f96 });
  private readonly discGeometry = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);

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
  ): void {
    this.clear();
    for (const { floor, elevation } of floors) {
      for (const fixture of floor.fixtures) {
        this.entries.push(this.build(fixture, floor, elevation, catalogue));
      }
    }
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
    for (const lamp of this.lamps) lamp.dispose();
  }

  private clear(): void {
    for (const entry of this.entries) {
      entry.markerMaterial.dispose();
      entry.glowMaterial.dispose();
      entry.washMaterial?.dispose();
      if (entry.wash && entry.wash.geometry !== this.discGeometry) entry.wash.geometry.dispose();
    }
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

    const markerMaterial = new MeshBasicMaterial();
    const marker = new Mesh(this.markerGeometry, markerMaterial);
    marker.position.copy(anchor);
    this.group.add(marker);
    if (!hasModel) {
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

    const entry: Entry = { fixture, anchor, marker, markerMaterial, glow, glowMaterial };
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
    return entry;
  }

  /** The floor a light falls on: its room, so that it stops at the walls; a
   * disc if it is in no room. */
  private buildWash(
    fixture: Fixture,
    floor: Floor,
    elevation: number,
    material: ShaderMaterial,
  ): Mesh {
    const room = floor.rooms.find((candidate) => candidate.id === fixture.room);
    const outline = room ? roomPolygon(floor, room) : [];
    if (outline.length < 3) {
      const disc = new Mesh(this.discGeometry, material);
      disc.position.set(fixture.x, elevation + WASH_HEIGHT, fixture.y);
      disc.scale.setScalar(4.5);
      return disc;
    }
    const indices = triangulate(outline);
    const positions = new Float32Array(indices.length * 3);
    // Reversed, to face up: see flat() in core/mesh.ts.
    for (let i = 0; i < indices.length; i += 3) {
      [indices[i], indices[i + 2], indices[i + 1]].forEach((index, corner) => {
        positions[(i + corner) * 3] = outline[index].x;
        positions[(i + corner) * 3 + 1] = elevation + WASH_HEIGHT;
        positions[(i + corner) * 3 + 2] = outline[index].y;
      });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    return new Mesh(geometry, material);
  }

  private apply(): void {
    const colour = new Color();
    const lit: { entry: Entry; visual: FixtureVisual }[] = [];
    for (const entry of this.entries) {
      const visual = this.visuals.get(entry.fixture.id) ?? MISSING;
      colour.setRGB(visual.colour[0], visual.colour[1], visual.colour[2], SRGBColorSpace);
      entry.markerMaterial.color.copy(colour);
      entry.markerMaterial.transparent = !visual.available;
      entry.markerMaterial.opacity = visual.available ? 1 : 0.45;
      const glowing = visual.available && visual.glows;
      entry.glow.visible = glowing;
      if (glowing) {
        entry.glowMaterial.color.copy(colour);
        entry.glowMaterial.opacity = 0.55 + 0.45 * visual.level;
        entry.glow.scale.setScalar(0.7 + 0.9 * visual.level);
        lit.push({ entry, visual });
      }
      if (entry.wash && entry.washMaterial) {
        entry.wash.visible = glowing;
        if (glowing) {
          const uniforms = entry.washMaterial.uniforms;
          (uniforms.uColour.value as Color).copy(colour);
          uniforms.uStrength.value = 0.1 + 0.22 * visual.level;
          uniforms.uRadius.value = 2.4 + 1.6 * visual.level;
        }
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
