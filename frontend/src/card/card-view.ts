import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { aspectRatioValue, type CardConfig } from "../core/card-config";
import type { Floor, House } from "../core/scene";
import { cameraFor, resolveView, type ViewResult } from "../core/views";
import { roomIllustration } from "../shared/illustration";
import { navigate } from "../shared/navigate";
import { SceneController } from "../shared/scene-controller";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";

/** What the card shows. Loaded on demand by the `diorama-card` stub, so the
 * dashboard only pays for it when a Diorama card is on it. The 3D view is
 * loaded on top of that, only once there is something to draw. */
@customElement("diorama-card-view")
export class DioramaCardView extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) config?: CardConfig;

  @state() private sceneLoaded = false;
  @state() private sceneFailed = false;

  private readonly scene = new SceneController(this);
  private view: ViewResult = { status: "loading" };
  /** The saved view the card looks from, worked out with `view`. */
  private camera?: ReturnType<typeof cameraFor>;
  /** What `view` was worked out from, to do it again only when one changes. */
  private viewFrom: [House?, ReadonlyMap<string, Floor>?, CardConfig?] = [];
  private sceneLoading = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("hass")) this.scene.setHass(this.hass);
    if (changed.has("config")) this.scene.setRequest(this.config);
    const { house, floors } = this.scene;
    const [fromHouse, fromFloors, fromConfig] = this.viewFrom;
    if (house !== fromHouse || floors !== fromFloors || this.config !== fromConfig) {
      this.viewFrom = [house, floors, this.config];
      this.view = house && this.config ? resolveView(house, floors, this.config) : { status: "loading" };
      this.camera =
        house && this.config && this.view.status === "ready"
          ? cameraFor(house, this.view.floors, this.config.camera)
          : undefined;
    }
    if (this.view.status === "ready" && !this.sceneLoaded && !this.sceneFailed) void this.loadScene();
  }

  private async loadScene(): Promise<void> {
    if (this.sceneLoading) return;
    this.sceneLoading = true;
    try {
      await import("../render/scene-view");
      this.sceneLoaded = true;
    } catch (error) {
      console.error("Diorama: the 3D view could not be loaded", error);
      this.sceneFailed = true;
    } finally {
      this.sceneLoading = false;
    }
  }

  protected override render(): TemplateResult | typeof nothing {
    const config = this.config;
    if (!config) return nothing;
    return html`
      <ha-card>
        <div class="stage" style="aspect-ratio: ${aspectRatioValue(config.aspect_ratio)}">
          ${this.renderStage(config)}
        </div>
      </ha-card>
    `;
  }

  private renderStage(config: CardConfig): TemplateResult {
    const view = this.view;
    if (this.scene.error && view.status !== "ready") {
      return this.message("Diorama is not available", html`${this.scene.error}`, true);
    }
    if (view.status === "empty") return this.message("No house drawn yet", this.hint("to draw it"));
    if (view.status === "missing") {
      return this.message(
        view.what === "room" ? "This room is no longer there" : "This floor is no longer there",
        html`Edit the card and choose another.`,
      );
    }
    if (this.sceneFailed) {
      return this.message("The 3D view could not be loaded", html`Reload the page to try again.`, true);
    }
    if (view.status === "loading" || !this.sceneLoaded) return html`<p class="loading">Loading...</p>`;
    return html`<diorama-scene-view
      .floors=${view.floors}
      .camera=${this.camera}
      .catalogue=${this.scene.catalogue}
      .hass=${this.hass}
      .walls=${config.walls}
      .interactive=${config.interactive}
      .controls=${config.controls}
      ?day-night=${config.day_night}
      no-reset
      aria-label=${view.title}
    ></diorama-scene-view>`;
  }

  private message(title: string, detail: TemplateResult, alert = false): TemplateResult {
    return html`
      <div class="empty">
        ${roomIllustration()}
        <p class="title">${title}</p>
        <p class="hint" role=${alert ? "alert" : nothing}>${detail}</p>
      </div>
    `;
  }

  private hint(purpose: string): TemplateResult {
    if (this.hass?.user?.is_admin) {
      return html`Open <a href="/diorama" @click=${this.openPanel}>Diorama</a> in the sidebar
        ${purpose}.`;
    }
    return html`Ask an administrator ${purpose}.`;
  }

  private openPanel(event: Event): void {
    event.preventDefault();
    navigate("/diorama");
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: block;
      }
      ha-card {
        overflow: hidden;
      }
      .stage {
        position: relative;
        display: grid;
        place-items: center;
        width: 100%;
        min-height: 120px;
      }
      diorama-scene-view {
        position: absolute;
        inset: 0;
        /* The card shows through by day; the view sets how far into the night it is. */
        background: color-mix(in srgb, #0d1524 var(--diorama-night, 0%), transparent);
      }
      .loading {
        margin: 0;
        font-size: 0.875rem;
        color: var(--diorama-text-muted);
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 4px;
        padding: 16px;
        text-align: center;
        color: var(--diorama-text);
      }
      svg {
        width: min(45%, 180px);
        height: auto;
        margin-bottom: 8px;
      }
      p {
        margin: 0;
      }
      .title {
        font-size: 1rem;
        font-weight: 500;
      }
      .hint {
        font-size: 0.875rem;
        color: var(--diorama-text-muted);
      }
      a {
        color: var(--diorama-accent);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-card-view": DioramaCardView;
  }
}
