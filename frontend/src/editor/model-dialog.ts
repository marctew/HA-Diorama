import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CatalogueModel } from "../core/catalogue";
import {
  MODEL_FILE_MAX_BYTES,
  MODEL_MAX_BYTES,
  MODEL_NAME_LENGTH,
  modelName,
  scaledSize,
  scaleFor,
  likelyScale,
  sizeProblem,
  uploadPath,
  type Dimension,
  type ModelKind,
} from "../core/upload";
import { lengthForInput, parseLength, type UnitSystem } from "../core/units";
import type { ReadModel } from "../render/model-import";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** Add a model of your own: shows what is in the file and asks how big it
 * really is, since a file says nothing reliable about that. Fires
 * `model-added` with the new catalogue entry, and `model-close`. */
@customElement("diorama-model-dialog")
export class DioramaModelDialog extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) file?: File;
  @property() units: UnitSystem = "metric";

  @state() private status: "reading" | "ready" | "sending" | "unreadable" = "reading";
  @state() private model?: ReadModel;
  @state() private scale = 1;
  @state() private name = "";
  @state() private againstWall = false;
  @state() private kind: ModelKind | "" = "";
  @state() private error?: string;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("file") && this.file) void this.read(this.file);
  }

  private async read(file: File): Promise<void> {
    this.status = "reading";
    this.model = undefined;
    this.error = undefined;
    this.name = modelName(file.name);
    try {
      if (file.size > MODEL_FILE_MAX_BYTES) {
        throw new Error(`The file is ${megabytes(file.size)} MB, which is too big to read here.`);
      }
      const { readModel } = await import("../render/model-import");
      const model = await readModel(await file.arrayBuffer());
      if (this.file !== file) return;
      this.model = model;
      this.scale = likelyScale(model.size);
      this.status = "ready";
    } catch (error) {
      if (this.file !== file) return;
      console.warn("Diorama: could not read the model", error);
      this.status = "unreadable";
      this.error =
        error instanceof Error && error.message.startsWith("The file")
          ? error.message
          : "This file could not be read as a model. It needs to be a binary glTF file (.glb): most 3D programs can export one.";
    }
  }

  protected override render(): TemplateResult {
    return html`
      <div class="backdrop" @click=${this.close}></div>
      <section role="dialog" aria-modal="true" aria-label="Add a model">
        <header>
          <h2>Add a model</h2>
          <button class="icon" title="Close" aria-label="Close" @click=${this.close}>
            ${icon("close")}
          </button>
        </header>
        ${this.status === "reading"
          ? html`<p class="note">Reading ${this.file?.name ?? "the file"}...</p>`
          : this.model
            ? this.renderForm(this.model)
            : nothing}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <footer>
          <button @click=${this.close}>Cancel</button>
          <button
            class="primary"
            ?disabled=${this.status !== "ready" || !this.canAdd()}
            @click=${this.add}
          >
            ${this.status === "sending" ? "Adding..." : "Add to my models"}
          </button>
        </footer>
      </section>
    `;
  }

  private canAdd(): boolean {
    return Boolean(
      this.model && this.name.trim() && !sizeProblem(scaledSize(this.model.size, this.scale)),
    );
  }

  private renderForm(model: ReadModel): TemplateResult {
    const size = scaledSize(model.size, this.scale);
    const problem = sizeProblem(size);
    const unit = this.units === "metric" ? "m" : "ft";
    const field = (label: string, dimension: Dimension) => html`
      <label>
        <span>${label} (${unit})</span>
        <input
          type="text"
          inputmode="decimal"
          .value=${lengthForInput(size[dimension], this.units)}
          @change=${(event: Event) => {
            const input = event.target as HTMLInputElement;
            const metres = parseLength(input.value.trim(), this.units);
            const scale = metres === undefined ? undefined : scaleFor(model.size, dimension, metres);
            if (scale === undefined) input.value = lengthForInput(size[dimension], this.units);
            else this.scale = scale;
          }}
        />
      </label>
    `;
    return html`
      <div class="body">
        <div class="picture">
          ${model.picture ? html`<img src=${model.picture} alt="" />` : icon("cube")}
        </div>
        <div class="fields">
          <label>
            <span>Name</span>
            <input
              type="text"
              maxlength=${MODEL_NAME_LENGTH}
              .value=${this.name}
              @input=${(event: Event) => (this.name = (event.target as HTMLInputElement).value)}
            />
          </label>
          <div class="sizes">
            ${field("Width", "width")}${field("Depth", "depth")}${field("Height", "height")}
          </div>
          <p class="note ${problem ? "problem" : ""}">
            ${problem ??
            "Check the size: a file does not say reliably how big its model is. Change the one you know and the others follow."}
          </p>
          <label>
            <span>It is</span>
            <select
              @change=${(event: Event) =>
                (this.kind = (event.target as HTMLSelectElement).value as ModelKind | "")}
            >
              <option value="" ?selected=${this.kind === ""}>Furniture, nothing more</option>
              <option value="light" ?selected=${this.kind === "light"}>A light</option>
              <option value="switch" ?selected=${this.kind === "switch"}>
                Something switched on and off
              </option>
              <option value="media" ?selected=${this.kind === "media"}>
                A television or speaker
              </option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              .checked=${this.againstWall}
              @change=${(event: Event) =>
                (this.againstWall = (event.target as HTMLInputElement).checked)}
            />
            <span>It stands with its back to a wall</span>
          </label>
        </div>
      </div>
      <p class="note small">
        Say it is a light and a light dropped on it becomes it, and glows. It is kept without its
        textures, in flat colours like the rest. Its front should face
        forwards in the file; you can turn each piece once it is placed.
      </p>
    `;
  }

  private add = async (): Promise<void> => {
    const model = this.model;
    const hass = this.hass;
    if (!model || !hass || this.status !== "ready") return;
    this.status = "sending";
    this.error = undefined;
    try {
      const { prepareModel } = await import("../render/model-import");
      const body = await prepareModel(model, this.scale);
      if (body.byteLength > MODEL_MAX_BYTES) {
        throw new Error(
          `Even without its textures this model is ${megabytes(body.byteLength)} MB; the most that can be kept is ${megabytes(MODEL_MAX_BYTES)} MB. Simplify it and try again.`,
        );
      }
      const response = await hass.fetchWithAuth(
        uploadPath({
          name: this.name,
          ...scaledSize(model.size, this.scale),
          against_wall: this.againstWall,
          kind: this.kind || null,
        }),
        { method: "POST", body, headers: { "Content-Type": "model/gltf-binary" } },
      );
      const reply = (await response.json().catch(() => ({}))) as {
        model?: CatalogueModel;
        message?: string;
      };
      if (!response.ok || !reply.model) {
        throw new Error(reply.message ?? "Home Assistant would not take the model.");
      }
      this.dispatchEvent(new CustomEvent("model-added", { detail: { model: reply.model } }));
    } catch (error) {
      this.status = "ready";
      this.error = error instanceof Error ? error.message : "The model could not be added.";
    }
  };

  private close = (): void => {
    this.dispatchEvent(new CustomEvent("model-close"));
  };

  static override styles = [
    themeStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
        font-size: 14px;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.42);
      }
      section {
        position: relative;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        width: min(560px, 100%);
        max-height: 100%;
        border-radius: 18px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        overflow: auto;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 12px 8px 24px;
      }
      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
      }
      .body {
        display: grid;
        grid-template-columns: 148px minmax(0, 1fr);
        gap: 18px;
        padding: 4px 24px 0;
      }
      .picture {
        display: grid;
        place-items: center;
        width: 148px;
        height: 148px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--diorama-text) 5%, transparent);
        color: var(--diorama-text-muted);
      }
      .picture img {
        width: 144px;
        height: 144px;
        object-fit: contain;
      }
      .fields {
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .sizes {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      label {
        display: grid;
        gap: 4px;
      }
      label > span {
        font-size: 12px;
        color: var(--diorama-text-muted);
      }
      input[type="text"],
      select {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
        height: 38px;
        padding: 0 10px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 8px;
        background: var(--primary-background-color, #fafafa);
        color: inherit;
        font: inherit;
      }
      label.check {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      label.check > span {
        font-size: 14px;
        color: inherit;
      }
      .note {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--diorama-text-muted);
      }
      section > .note {
        padding: 14px 24px 0;
      }
      .note.problem,
      .error {
        color: var(--error-color, #c62828);
      }
      .error {
        margin: 0;
        padding: 12px 24px 0;
        font-size: 13px;
        line-height: 1.45;
      }
      footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 18px 24px 20px;
      }
      footer button {
        height: 38px;
        padding: 0 16px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      footer button.primary {
        border-color: var(--diorama-accent);
        background: var(--diorama-accent);
        color: #fff;
        font-weight: 500;
      }
      button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      button.icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      button.icon:hover {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      @media (max-width: 520px) {
        .body {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-model-dialog": DioramaModelDialog;
  }
}
