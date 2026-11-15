import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { DioramaApi, errorMessage, isConflict } from "../core/api";
import { browserStorage, clearDraft, loadDraft, saveDraft, type Draft } from "../core/draft";
import { History } from "../core/history";
import { deleteVertices, deleteWalls } from "../core/plan";
import type { Floor, SceneEvent } from "../core/scene";
import type { UnitSystem } from "../core/units";
import { themeStyles } from "../shared/theme";
import type { HomeAssistant } from "../types/hass";
import { icon } from "./icons";
import "./inspector";
import "./plan-view";
import type { DioramaPlanView, Tool } from "./plan-view";
import { isEmpty, NO_SELECTION, prune, type Selection } from "./selection";

const DRAFT_DELAY = 400;

/** What the floor holds, without the two keys the server owns. */
function content(floor: Floor): string {
  return JSON.stringify({ ...floor, revision: 0, schema_version: 0 });
}

/** The editor for one floor: the plan, the tools, the inspector, and
 * everything about saving (undo, drafts, conflicts with other people). */
@customElement("diorama-editor")
export class DioramaEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property() floorId?: string;
  /** On a narrow screen the plan can be looked at but not changed. */
  @property({ type: Boolean, reflect: true }) narrow = false;

  /** The floor as it is saved. */
  @state() private saved?: Floor;
  /** The floor as it is being edited. */
  @state() private floor?: Floor;
  @state() private tool: Tool = "select";
  @state() private selection: Selection = NO_SELECTION;
  @state() private loadError?: string;
  @state() private saveError?: string;
  @state() private saving = false;
  /** Someone else saved this floor while it was being edited here. */
  @state() private conflict = false;
  /** Unsaved edits found from an earlier visit. */
  @state() private draftOffer?: Draft;

  @query("diorama-plan-view") private plan?: DioramaPlanView;

  private history?: History<Floor>;
  /** The state of the history that matches what is saved. */
  private savedState?: Floor;
  private loadedId?: string;
  private unsubscribe?: () => Promise<void> | void;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private readonly storage = browserStorage();

  private get api(): DioramaApi | undefined {
    return this.hass ? new DioramaApi(this.hass) : undefined;
  }

  private get units(): UnitSystem {
    return this.hass?.config?.unit_system?.length === "mi" ? "imperial" : "metric";
  }

  private get dirty(): boolean {
    return this.floor !== undefined && this.floor !== this.savedState;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("beforeunload", this.onBeforeUnload);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.flushDraft();
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    this.loadedId = undefined;
    if (unsubscribe) void unsubscribe();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if ((changed.has("hass") || changed.has("floorId")) && this.hass && this.floorId) {
      if (this.loadedId !== this.floorId) void this.load(this.floorId);
    }
  }

  // Loading and saving.

  private async load(floorId: string): Promise<void> {
    const api = this.api;
    if (!api) return;
    this.flushDraft();
    this.loadedId = floorId;
    this.loadError = undefined;
    this.floor = undefined;
    this.saved = undefined;
    try {
      const floor = await api.getFloor(floorId);
      if (this.loadedId !== floorId) return;
      this.adopt(floor);
      const draft = loadDraft(this.storage, floorId);
      if (draft && content(draft.floor) !== content(floor)) this.draftOffer = draft;
      else clearDraft(this.storage, floorId);
    } catch (error) {
      if (this.loadedId === floorId) this.loadError = errorMessage(error);
      return;
    }
    if (!this.unsubscribe) {
      try {
        const unsubscribe = await api.subscribe(this.onSceneEvent);
        if (this.isConnected && !this.unsubscribe) this.unsubscribe = unsubscribe;
        else void unsubscribe();
      } catch {
        // Without it, a change made elsewhere shows up as a conflict on save.
      }
    }
  }

  /** Take a floor from the server as both the saved and the edited state. */
  private adopt(floor: Floor): void {
    this.saved = floor;
    this.floor = floor;
    this.savedState = floor;
    this.history = new History(floor);
    this.selection = prune(this.selection, floor);
    this.conflict = false;
    this.saveError = undefined;
    this.draftOffer = undefined;
  }

  private async save(overwrite = false): Promise<void> {
    const api = this.api;
    const floor = this.floor;
    if (!api || !floor || !this.saved || this.saving || (!this.dirty && !overwrite)) return;
    this.saving = true;
    this.saveError = undefined;
    try {
      let revision = this.saved.revision;
      if (overwrite) revision = (await api.getFloor(floor.id)).revision;
      const result = await api.saveFloor({ ...floor, revision });
      this.saved = result;
      // Edits made while the save was on its way stay unsaved.
      this.savedState = floor;
      this.conflict = false;
      if (!this.dirty) clearDraft(this.storage, floor.id);
      this.requestUpdate();
    } catch (error) {
      if (isConflict(error)) this.conflict = true;
      else this.saveError = errorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  /** Throw away the edits made here and show what is saved. */
  private async reload(): Promise<void> {
    if (!this.floorId) return;
    clearDraft(this.storage, this.floorId);
    this.loadedId = undefined;
    await this.load(this.floorId);
  }

  private onSceneEvent = (event: SceneEvent): void => {
    if (!this.saved) return;
    const mine = event.type === "floor" && event.floor_id === this.saved.id;
    if (!mine && event.type !== "reset") return;
    // Our own save: the reply has, or will have, the same revision.
    if (this.saving || event.revision <= this.saved.revision) return;
    if (this.dirty) this.conflict = true;
    else void this.reload();
  };

  // Editing.

  private applyEdit(floor: Floor): void {
    if (!this.history || floor === this.floor) return;
    this.history.push(floor);
    this.setFloor(floor);
  }

  private setFloor(floor: Floor): void {
    this.floor = floor;
    this.selection = prune(this.selection, floor);
    this.scheduleDraft();
  }

  private undo(): void {
    if (this.history?.canUndo) this.setFloor(this.history.undo());
  }

  private redo(): void {
    if (this.history?.canRedo) this.setFloor(this.history.redo());
  }

  private deleteSelection(): void {
    const floor = this.floor;
    if (!floor || isEmpty(this.selection)) return;
    let result = deleteWalls(floor, new Set(this.selection.walls));
    result = deleteVertices(result, new Set(this.selection.vertices));
    this.applyEdit(result);
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool === "wall") this.selection = NO_SELECTION;
  }

  // Drafts.

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.flushDraft(), DRAFT_DELAY);
  }

  private flushDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (!this.floor || !this.saved) return;
    if (this.dirty) {
      saveDraft(this.storage, {
        baseRevision: this.saved.revision,
        floor: this.floor,
        savedAt: Date.now(),
      });
    } else if (!this.draftOffer) {
      clearDraft(this.storage, this.floor.id);
    }
  }

  private restoreDraft(): void {
    const draft = this.draftOffer;
    this.draftOffer = undefined;
    if (draft) this.applyEdit({ ...draft.floor });
  }

  private discardDraft(): void {
    this.draftOffer = undefined;
    if (this.floorId) clearDraft(this.storage, this.floorId);
  }

  // Keyboard.

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.narrow || !this.floor || isTyping(event)) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (command) {
      const lower = key.toLowerCase();
      if (lower === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (lower === "y") {
        event.preventDefault();
        this.redo();
      } else if (lower === "s") {
        event.preventDefault();
        void this.save();
      }
      return;
    }
    if (event.altKey) return;
    if (this.plan?.typeKey(key)) {
      event.preventDefault();
      return;
    }
    if (key === "Escape") {
      if (!this.plan?.cancel()) {
        if (this.tool !== "select") this.setTool("select");
        else this.selection = NO_SELECTION;
      }
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      this.deleteSelection();
    } else if (key === " ") {
      event.preventDefault();
      this.plan?.setSpace(true);
    } else if (key.toLowerCase() === "w" && !this.plan?.drawing) {
      this.setTool("wall");
    } else if (key.toLowerCase() === "v" && !this.plan?.drawing) {
      this.setTool("select");
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === " ") this.plan?.setSpace(false);
  };

  private onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    this.flushDraft();
    event.preventDefault();
  };

  // Rendering.

  protected override render(): TemplateResult {
    if (this.loadError) {
      return html`
        <div class="message" role="alert">
          <p>${this.loadError}</p>
          <button class="primary" @click=${() => this.reload()}>Try again</button>
        </div>
      `;
    }
    if (!this.floor) return html`<div class="message"><p>Loading the floor...</p></div>`;
    return html`
      <div class="stage">
        <diorama-plan-view
          .floor=${this.floor}
          .tool=${this.tool}
          .selection=${this.selection}
          .units=${this.units}
          ?readonly=${this.narrow}
          @plan-edit=${(event: CustomEvent<{ floor: Floor }>) => this.applyEdit(event.detail.floor)}
          @plan-select=${(event: CustomEvent<{ selection: Selection }>) =>
            (this.selection = event.detail.selection)}
        ></diorama-plan-view>
        ${this.narrow ? this.renderNarrowNotice() : [this.renderTools(), this.renderSave()]}
        <div class="notices">${this.renderNotices()}</div>
      </div>
      ${this.narrow
        ? nothing
        : html`<diorama-inspector
            .floor=${this.floor}
            .selection=${this.selection}
            .hass=${this.hass}
            .units=${this.units}
            @inspector-edit=${(event: CustomEvent<{ floor: Floor }>) =>
              this.applyEdit(event.detail.floor)}
            @inspector-delete=${this.deleteSelection}
          ></diorama-inspector>`}
    `;
  }

  private renderTools(): TemplateResult {
    const tool = (id: Tool, label: string, key: string) => html`
      <button
        class=${this.tool === id ? "active" : ""}
        title="${label} (${key})"
        aria-label=${label}
        aria-pressed=${this.tool === id}
        @click=${() => this.setTool(id)}
      >
        ${icon(id)}
      </button>
    `;
    return html`
      <div class="toolbar tools" role="toolbar" aria-label="Tools">
        ${tool("select", "Select and move", "V")} ${tool("wall", "Draw walls", "W")}
        <span class="divider"></span>
        <button
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          ?disabled=${!this.history?.canUndo}
          @click=${this.undo}
        >
          ${icon("undo")}
        </button>
        <button
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          ?disabled=${!this.history?.canRedo}
          @click=${this.redo}
        >
          ${icon("redo")}
        </button>
      </div>
      ${this.floor && this.floor.walls.length === 0 && this.tool === "select"
        ? html`
            <div class="start">
              <p>Nothing drawn on this floor yet.</p>
              <button class="primary" @click=${() => this.setTool("wall")}>
                ${icon("wall")} Draw walls
              </button>
            </div>
          `
        : nothing}
      ${this.tool === "wall"
        ? html`<p class="hint">
            Click to place each corner. Type a length and press Enter for an exact wall. Esc to
            finish.
          </p>`
        : nothing}
    `;
  }

  private renderSave(): TemplateResult {
    const status = this.saving ? "Saving..." : this.dirty ? "Unsaved changes" : "Saved";
    return html`
      <div class="toolbar save">
        <span class="status ${this.dirty ? "dirty" : ""}" aria-live="polite">${status}</span>
        <button
          class="primary"
          title="Save (Ctrl+S)"
          ?disabled=${!this.dirty || this.saving}
          @click=${() => this.save()}
        >
          ${icon("check")} Save
        </button>
      </div>
    `;
  }

  private renderNarrowNotice(): TemplateResult {
    return html`<p class="hint">Drawing needs a wider screen. Here you can look around.</p>`;
  }

  private renderNotices(): TemplateResult | typeof nothing {
    if (this.conflict) {
      return html`
        <div class="notice" role="alert">
          <p>
            <strong>This floor was changed somewhere else.</strong> You can load that version and
            lose what you changed here, or save yours over it.
          </p>
          <div class="actions">
            <button @click=${() => this.reload()}>Load their version</button>
            <button class="primary" ?disabled=${this.saving} @click=${() => this.save(true)}>
              Save mine over it
            </button>
          </div>
        </div>
      `;
    }
    if (this.saveError) {
      return html`
        <div class="notice error" role="alert">
          <p><strong>Not saved.</strong> ${this.saveError}</p>
          <div class="actions">
            <button @click=${() => (this.saveError = undefined)}>Dismiss</button>
          </div>
        </div>
      `;
    }
    if (this.draftOffer) {
      const stale = this.saved && this.draftOffer.baseRevision !== this.saved.revision;
      return html`
        <div class="notice">
          <p>
            <strong>You have unsaved changes from ${formatWhen(this.draftOffer.savedAt)}.</strong>
            ${stale
              ? "The floor has been saved since then; restoring puts your older changes on top."
              : "Restore them to carry on where you left off."}
          </p>
          <div class="actions">
            <button @click=${this.discardDraft}>Discard</button>
            <button class="primary" @click=${this.restoreDraft}>Restore</button>
          </div>
        </div>
      `;
    }
    return nothing;
  }

  static override styles = [
    themeStyles,
    css`
      :host {
        display: flex;
        min-height: 0;
        height: 100%;
        color: var(--diorama-text);
        font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
        font-size: 14px;
      }
      .stage {
        position: relative;
        flex: 1;
        min-width: 0;
      }
      diorama-plan-view {
        position: absolute;
        inset: 0;
      }
      diorama-inspector {
        flex: none;
        width: 300px;
        border-left: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: var(--card-background-color, #fff);
      }
      .toolbar {
        position: absolute;
        top: 16px;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 14px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }
      .tools {
        left: 16px;
      }
      .save {
        right: 16px;
        gap: 10px;
        padding-left: 14px;
      }
      .toolbar button:not(.primary) {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border: 0;
        border-radius: 10px;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      .toolbar button:not(.primary):hover:not(:disabled) {
        background: color-mix(in srgb, var(--diorama-text) 8%, transparent);
      }
      .toolbar button.active {
        background: color-mix(in srgb, var(--diorama-accent) 16%, transparent);
        color: var(--diorama-accent);
      }
      button:disabled {
        opacity: 0.38;
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--diorama-accent);
        outline-offset: 1px;
      }
      .divider {
        width: 1px;
        height: 22px;
        margin: 0 4px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .status {
        font-size: 13px;
        color: var(--diorama-text-muted);
        white-space: nowrap;
      }
      .status.dirty {
        color: var(--diorama-text);
      }
      button.primary,
      .notice button,
      .message button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 38px;
        padding: 0 16px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
        border-radius: 10px;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
      button.primary {
        padding-left: 12px;
        border-color: transparent;
        background: var(--diorama-accent);
        color: var(--text-primary-color, #fff);
      }
      .notice button.primary,
      .message button.primary {
        padding-left: 16px;
      }
      .hint {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        max-width: calc(100% - 220px);
        margin: 0;
        padding: 8px 14px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--diorama-text) 86%, transparent);
        color: var(--primary-background-color, #fff);
        font-size: 13px;
        text-align: center;
        pointer-events: none;
      }
      :host([narrow]) .hint {
        bottom: 64px;
        max-width: calc(100% - 32px);
        width: max-content;
      }
      .start {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: grid;
        justify-items: center;
        gap: 12px;
        padding: 24px 28px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-radius: 16px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .start p {
        margin: 0;
        color: var(--diorama-text-muted);
      }
      .notices {
        position: absolute;
        top: 76px;
        left: 50%;
        transform: translateX(-50%);
        width: min(520px, calc(100% - 32px));
      }
      .notice {
        padding: 14px 16px;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-left: 4px solid var(--diorama-accent);
        border-radius: 12px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
      }
      .notice.error {
        border-left-color: var(--error-color, #db4437);
      }
      .notice p {
        margin: 0 0 12px;
        line-height: 1.45;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .message {
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 12px;
        flex: 1;
        padding: 24px;
        text-align: center;
        color: var(--diorama-text-muted);
      }
      .message p {
        margin: 0;
      }
    `,
  ];
}

/** Keys typed into a field are for the field. */
function isTyping(event: KeyboardEvent): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (target.isContentEditable) return true;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  }
  return false;
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? `${time} today` : `${date.toLocaleDateString()} at ${time}`;
}

declare global {
  interface HTMLElementTagNameMap {
    "diorama-editor": DioramaEditor;
  }
}
