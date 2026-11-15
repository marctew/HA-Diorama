import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Catalogue } from "../core/catalogue";
import { hexColour, type Colour } from "../core/mesh";
import { deviceHints, pickQuality, type Quality } from "../core/quality";
import { themeStyles } from "../shared/theme";
import { SceneRenderer, type SceneFloor } from "./scene-renderer";

/** A 3D view of one or more floors. Give it the floors; it does the rest. */
@customElement("diorama-scene-view")
export class DioramaSceneView extends LitElement {
  @property({ attribute: false }) floors: readonly SceneFloor[] = [];
  /** Where furniture models come from. */
  @property({ attribute: false }) catalogue?: Catalogue;
  /** A room to pick out, by id. */
  @property({ attribute: false }) highlightRoom: string | null = null;
  /** Leave unset to choose by device. */
  @property() quality?: Quality;

  @state() private failed = false;

  private renderer?: SceneRenderer;
  private resizeObserver?: ResizeObserver;

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.renderer?.canvas.remove();
    this.renderer = undefined;
  }

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
        : html`<button class="frame" title="Show everything" @click=${this.frame}>
            Reset view
          </button>`}
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.failed) return;
    if (!this.renderer) {
      try {
        this.renderer = new SceneRenderer(this.quality ?? pickQuality(deviceHints()));
      } catch (error) {
        console.error("Diorama: could not start the 3D view", error);
        this.failed = true;
        return;
      }
      this.renderRoot.querySelector(".canvas")!.append(this.renderer.canvas);
      this.resize();
      this.show();
      return;
    }
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
