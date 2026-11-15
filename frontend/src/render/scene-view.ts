import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Catalogue } from "../core/catalogue";
import { hexColour, type Colour } from "../core/mesh";
import type { WallMode } from "../core/cutaway";
import type { Fixture } from "../core/scene";
import { FixtureStates, moreInfo } from "../shared/fixture-state";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { SceneRenderer, type SceneFloor } from "./scene-renderer";

/** A 3D view of one or more floors. Give it the floors; it does the rest. */
@customElement("diorama-scene-view")
export class DioramaSceneView extends LitElement {
  @property({ attribute: false }) floors: readonly SceneFloor[] = [];
  /** Where furniture models come from. */
  @property({ attribute: false }) catalogue?: Catalogue;
  /** For the state of the entities shown, and to act on them. */
  @property({ attribute: false }) hass?: HomeAssistant;
  /** Whether tapping a fixture does anything. Set it as a property: being
   * true by default, it cannot be switched off with an attribute. */
  @property({ attribute: false }) interactive = true;
  /** A room to pick out, by id. */
  @property({ attribute: false }) highlightRoom: string | null = null;
  /** Whether walls on the camera's side drop out of the way. */
  @property() walls: WallMode = "auto";
  /** Whether dragging and scrolling move the camera. A property, as above. */
  @property({ attribute: false }) controls = true;
  /** Hide the button that frames the house again. */
  @property({ type: Boolean, attribute: "no-reset" }) noReset = false;

  @state() private failed = false;

  private renderer?: SceneRenderer;
  private readonly states = new FixtureStates(() => this.showStates());
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  /** On screen, on a tab that is showing. Not until the browser says so: a
   * card far down a long dashboard should draw nothing at all. */
  private visible = false;
  private onScreen = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this);
    // Nothing is drawn for a view that is scrolled out of sight or on a tab
    // in the background.
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
      this.updateVisible();
    });
    this.intersectionObserver.observe(this);
    document.addEventListener("visibilitychange", this.updateVisible);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.updateVisible);
    this.states.dispose();
    this.renderer?.dispose();
    this.renderer?.canvas.remove();
    this.renderer = undefined;
  }

  private updateVisible = (): void => {
    this.visible = this.onScreen && document.visibilityState !== "hidden";
    this.renderer?.setActive(this.visible);
  };

  /** Point the camera at the whole house again. */
  frame(): void {
    this.renderer?.frame();
  }

  protected override render(): TemplateResult {
    return html`
      <div class="canvas"></div>
      ${this.failed
        ? html`<p class="message" role="alert">
            The 3D view needs WebGL, which this browser has switched off or does not have.
          </p>`
        : this.noReset || !this.controls
          ? nothing
          : html`<button class="frame" title="Show everything" @click=${this.frame}>
              Reset view
            </button>`}
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.failed) return;
    if (!this.renderer) {
      try {
        this.renderer = new SceneRenderer();
      } catch (error) {
        console.error("Diorama: could not start the 3D view", error);
        this.failed = true;
        return;
      }
      this.renderRoot.querySelector(".canvas")!.append(this.renderer.canvas);
      this.renderer.setCallbacks({
        onTap: (fixture) => {
          if (this.interactive) this.states.tap(this, this.hass, fixture);
        },
        onHold: (fixture) => {
          if (this.interactive) moreInfo(this, fixture.entity_id);
        },
      });
      this.renderer.setWallMode(this.walls);
      this.renderer.setControlsEnabled(this.controls);
      this.renderer.setActive(this.visible);
      this.resize();
      this.show();
      this.showStates();
      return;
    }
    if (changed.has("walls")) this.renderer.setWallMode(this.walls);
    if (changed.has("controls")) this.renderer.setControlsEnabled(this.controls);
    if (changed.has("floors") || changed.has("hass")) this.showStates();
    if (changed.has("floors") || changed.has("highlightRoom") || changed.has("catalogue")) {
      this.show();
    }
  }

  private show(): void {
    this.renderer?.setContent({
      floors: this.floors,
      catalogue: this.catalogue,
      highlightRoom: this.highlightRoom,
      highlightColour: this.accent(),
    });
  }

  /** Bring the fixtures into line with Home Assistant's states. Cheap when
   * nothing they show has changed, which is nearly always. */
  private showStates(): void {
    const fixtures: Fixture[] = this.floors.flatMap(({ floor }) => floor.fixtures);
    if (this.states.update(this.hass, fixtures)) this.renderer?.setVisuals(this.states.visuals);
  }

  private resize(): void {
    const box = this.getBoundingClientRect();
    this.renderer?.resize(Math.floor(box.width), Math.floor(box.height), window.devicePixelRatio || 1);
  }

  /** The theme's accent colour, lightened, for the highlighted room. */
  private accent(): Colour {
    const value = getComputedStyle(this).getPropertyValue("--primary-color").trim();
    const [r, g, b] = /^#[0-9a-f]{6}$/i.test(value) ? hexColour(value) : [0.01, 0.66, 0.96];
    const lighten = (channel: number) => channel + (1 - channel) * 0.55;
    return [lighten(r), lighten(g), lighten(b)];
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        background: linear-gradient(
          var(--primary-background-color, #fafafa),
          color-mix(in srgb, var(--diorama-text) 7%, var(--primary-background-color, #fafafa))
        );
      }
      .canvas {
        position: absolute;
        inset: 0;
        cursor: grab;
      }
      .canvas:active {
        cursor: grabbing;
      }
      .message {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        margin: 0;
        padding: 24px;
        text-align: center;
        color: var(--diorama-text-muted);
      }
      .frame {
        position: absolute;
        right: 16px;
        bottom: 16px;
        height: 34px;
        padding: 0 12px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        background: var(--card-background-color, #fff);
        color: var(--diorama-text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }
      .frame:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-scene-view": DioramaSceneView;
  }
}
