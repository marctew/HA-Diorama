// Shared by the plan and the 3D view: what each fixture looks like right now,
// and what tapping one does.

import {
  fixtureVisual,
  tapAction,
  toggleCall,
  type FixtureVisual,
} from "../core/bindings";
import type { Fixture } from "../core/scene";
import type { HomeAssistant } from "../types/hass";

/** How long a tap is shown as having worked before the state must agree. */
const OPTIMISTIC_MILLISECONDS = 3000;

/** Works out fixture visuals from Home Assistant's states, and only says so
 * when something a fixture shows has actually changed: `hass` is replaced on
 * every state change in the house, nearly all of them irrelevant here. */
export class FixtureStates {
  private seen: unknown[] = [];
  private current: ReadonlyMap<string, FixtureVisual> = new Map();
  /** Entities just toggled here: shown in their new state straight away. */
  private readonly pending = new Map<string, { on: boolean; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly onChange: () => void) {}

  get visuals(): ReadonlyMap<string, FixtureVisual> {
    return this.current;
  }

  /** Returns true if the visuals changed. */
  update(hass: HomeAssistant | undefined, fixtures: readonly Fixture[]): boolean {
    const seen: unknown[] = [];
    for (const fixture of fixtures) {
      const entity = hass?.states[fixture.entity_id];
      // A toggle the state has caught up with is no longer pending.
      const waiting = this.pending.get(fixture.entity_id);
      if (waiting && entity && (entity.state === "on") === waiting.on) this.settle(fixture.entity_id);
      seen.push(fixture.id, fixture.kind, entity, this.pending.get(fixture.entity_id)?.on);
    }
    if (seen.length === this.seen.length && seen.every((value, i) => value === this.seen[i])) {
      return false;
    }
    this.seen = seen;
    const visuals = new Map<string, FixtureVisual>();
    for (const fixture of fixtures) {
      let entity = hass?.states[fixture.entity_id];
      const waiting = this.pending.get(fixture.entity_id);
      if (waiting && entity) entity = { ...entity, state: waiting.on ? "on" : "off" };
      visuals.set(fixture.id, fixtureVisual(fixture.kind, entity));
    }
    this.current = visuals;
    return true;
  }

  /** Do what a tap on this fixture does. */
  tap(host: HTMLElement, hass: HomeAssistant | undefined, fixture: Fixture): void {
    const action = tapAction(fixture.kind, fixture.options);
    if (action === "more-info") moreInfo(host, fixture.entity_id);
    if (action !== "toggle" || !hass) return;
    const entity = hass.states[fixture.entity_id];
    if (!entity || entity.state === "unavailable" || entity.state === "unknown") {
      moreInfo(host, fixture.entity_id);
      return;
    }
    const { domain, service } = toggleCall(fixture.entity_id);
    this.expect(fixture.entity_id, entity.state !== "on");
    hass.callService(domain, service, {}, { entity_id: fixture.entity_id }).catch((error) => {
      console.warn(`Diorama: could not toggle ${fixture.entity_id}`, error);
      this.settle(fixture.entity_id);
      this.onChange();
    });
  }

  dispose(): void {
    for (const waiting of this.pending.values()) clearTimeout(waiting.timer);
    this.pending.clear();
  }

  private expect(entityId: string, on: boolean): void {
    this.settle(entityId);
    const timer = setTimeout(() => {
      // Home Assistant never confirmed it: show the truth again.
      this.pending.delete(entityId);
      this.onChange();
    }, OPTIMISTIC_MILLISECONDS);
    this.pending.set(entityId, { on, timer });
    this.onChange();
  }

  private settle(entityId: string): void {
    const waiting = this.pending.get(entityId);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.pending.delete(entityId);
  }
}

/** Open Home Assistant's own dialog for an entity. */
export function moreInfo(host: HTMLElement, entityId: string): void {
  host.dispatchEvent(
    new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
  );
}
