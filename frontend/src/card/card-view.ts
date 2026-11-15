import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { aspectRatioValue, type CardConfig } from "../core/card-config";
import { roomIllustration } from "../shared/illustration";
import { navigate } from "../shared/navigate";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";

/** What the card shows. Loaded on demand by the `diorama-card` stub, so the
 * dashboard only pays for it when a Diorama card is on it. */
@customElement("diorama-card-view")
export class DioramaCardView extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) config?: CardConfig;

  protected override render(): TemplateResult | typeof nothing {
    if (!this.config) return nothing;
    const ratio = aspectRatioValue(this.config.aspect_ratio);
    return html`
      <ha-card>
        <div class="stage" style="aspect-ratio: ${ratio}">
          <div class="empty">
            ${roomIllustration()}
            <p class="title">No house drawn yet</p>
            <p class="hint">${this.hint()}</p>
          </div>
        </div>
      </ha-card>
    `;
  }

  private hint(): TemplateResult {
    if (this.hass?.user?.is_admin) {
      return html`Open <a href="/diorama" @click=${this.openPanel}>Diorama</a> in the sidebar to draw it.`;
    }
    return html`Ask an administrator to draw it in Diorama.`;
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
        display: grid;
        place-items: center;
        width: 100%;
        min-height: 120px;
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
