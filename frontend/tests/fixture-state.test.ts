import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fixture } from "../src/core/scene";
import { FixtureStates } from "../src/shared/fixture-state";
import type { HomeAssistant } from "../src/types/hass";

const fixture = (change: Partial<Fixture> = {}): Fixture => ({
  id: "x1",
  entity_id: "light.kitchen",
  kind: "light",
  x: 0,
  y: 0,
  z: 0,
  room: null,
  item: null,
  model: null,
  options: {},
  ...change,
});

function fakeHass(states: Record<string, string>) {
  const callService = vi.fn().mockResolvedValue(undefined);
  const hass = {
    states: Object.fromEntries(
      Object.entries(states).map(([id, state]) => [id, { entity_id: id, state, attributes: {} }]),
    ),
    callService,
  } as unknown as HomeAssistant;
  return { hass, callService };
}

/** Stands in for the element events are fired from. */
function fakeHost() {
  const events: { type: string; detail: unknown }[] = [];
  const host = {
    dispatchEvent: (event: CustomEvent) => events.push({ type: event.type, detail: event.detail }),
  } as unknown as HTMLElement;
  return { host, events };
}

describe("FixtureStates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("works out visuals, and reports a change only when there is one", () => {
    const states = new FixtureStates(() => {});
    const { hass } = fakeHass({ "light.kitchen": "off", "switch.other": "off" });
    expect(states.update(hass, [fixture()])).toBe(true);
    expect(states.visuals.get("x1")).toMatchObject({ on: false, available: true });

    // The same hass again, and a new hass in which only another entity changed.
    expect(states.update(hass, [fixture()])).toBe(false);
    const elsewhere = { ...hass, states: { ...hass.states, "switch.other": { ...hass.states["switch.other"], state: "on" } } };
    expect(states.update(elsewhere as HomeAssistant, [fixture()])).toBe(false);

    const { hass: on } = fakeHass({ "light.kitchen": "on" });
    expect(states.update(on, [fixture()])).toBe(true);
    expect(states.visuals.get("x1")).toMatchObject({ on: true, glows: true });
  });

  it("greys out a fixture whose entity is gone", () => {
    const states = new FixtureStates(() => {});
    states.update(fakeHass({}).hass, [fixture()]);
    expect(states.visuals.get("x1")).toMatchObject({ available: false });
  });

  it("toggles on a tap and shows the new state before Home Assistant confirms", () => {
    const changed = vi.fn();
    const states = new FixtureStates(changed);
    const { hass, callService } = fakeHass({ "light.kitchen": "off" });
    const { host } = fakeHost();
    states.update(hass, [fixture()]);

    states.tap(host, hass, fixture());

    expect(callService).toHaveBeenCalledWith("light", "toggle", {}, { entity_id: "light.kitchen" });
    expect(changed).toHaveBeenCalled();
    // Home Assistant still says off, but the fixture shows on.
    expect(states.update(hass, [fixture()])).toBe(true);
    expect(states.visuals.get("x1")?.on).toBe(true);
  });

  it("goes back to the truth if Home Assistant never confirms", () => {
    const changed = vi.fn();
    const states = new FixtureStates(changed);
    const { hass } = fakeHass({ "light.kitchen": "off" });
    states.update(hass, [fixture()]);
    states.tap(fakeHost().host, hass, fixture());
    states.update(hass, [fixture()]);
    changed.mockClear();

    vi.advanceTimersByTime(3000);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(states.update(hass, [fixture()])).toBe(true);
    expect(states.visuals.get("x1")?.on).toBe(false);
  });

  it("goes back straight away if the call fails", async () => {
    const changed = vi.fn();
    const states = new FixtureStates(changed);
    const { hass, callService } = fakeHass({ "light.kitchen": "off" });
    callService.mockRejectedValue(new Error("no"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    states.update(hass, [fixture()]);
    states.tap(fakeHost().host, hass, fixture());
    states.update(hass, [fixture()]);

    await vi.advanceTimersByTimeAsync(0);

    states.update(hass, [fixture()]);
    expect(states.visuals.get("x1")?.on).toBe(false);
  });

  it("stops overriding once the state catches up, so a later change shows", () => {
    const states = new FixtureStates(() => {});
    const { hass } = fakeHass({ "light.kitchen": "off" });
    states.update(hass, [fixture()]);
    states.tap(fakeHost().host, hass, fixture());

    const { hass: confirmed } = fakeHass({ "light.kitchen": "on" });
    states.update(confirmed, [fixture()]);
    expect(states.visuals.get("x1")?.on).toBe(true);

    // Someone turns it off elsewhere: that must show, not be masked.
    const { hass: off } = fakeHass({ "light.kitchen": "off" });
    states.update(off, [fixture()]);
    expect(states.visuals.get("x1")?.on).toBe(false);
  });

  it("opens the details instead when the fixture is set to, or cannot be toggled", () => {
    const states = new FixtureStates(() => {});
    const { hass, callService } = fakeHass({ "light.kitchen": "off", "light.dead": "unavailable" });
    const { host, events } = fakeHost();

    states.tap(host, hass, fixture({ options: { tap: "more-info" } }));
    states.tap(host, hass, fixture({ entity_id: "light.dead" }));
    states.tap(host, hass, fixture({ entity_id: "light.gone" }));

    expect(callService).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "hass-more-info", detail: { entityId: "light.kitchen" } },
      { type: "hass-more-info", detail: { entityId: "light.dead" } },
      { type: "hass-more-info", detail: { entityId: "light.gone" } },
    ]);
  });

  it("does nothing when the fixture is set to do nothing", () => {
    const states = new FixtureStates(() => {});
    const { hass, callService } = fakeHass({ "light.kitchen": "off" });
    const { host, events } = fakeHost();
    states.tap(host, hass, fixture({ options: { tap: "none" } }));
    expect(callService).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("opens a blind on a tap and shows it open before Home Assistant confirms", () => {
    const states = new FixtureStates(() => {});
    const blind = fixture({ entity_id: "cover.blind", kind: "cover" });
    const { hass, callService } = fakeHass({ "cover.blind": "closed" });
    hass.states["cover.blind"].attributes = { current_position: 0, device_class: "blind" };
    states.update(hass, [blind]);
    expect(states.visuals.get("x1")).toMatchObject({ on: false, open: 0 });

    expect(states.tap(fakeHost().host, hass, blind)).toBeUndefined();

    expect(callService).toHaveBeenCalledWith("cover", "toggle", {}, { entity_id: "cover.blind" });
    states.update(hass, [blind]);
    // Not held back by the position it had when shut.
    expect(states.visuals.get("x1")).toMatchObject({ on: true, open: 1 });

    const { hass: opened } = fakeHass({ "cover.blind": "open" });
    opened.states["cover.blind"].attributes = { current_position: 60 };
    states.update(opened, [blind]);
    expect(states.visuals.get("x1")).toMatchObject({ open: 0.6 });
  });

  it("asks before moving a garage door, and moves it once told to", () => {
    const states = new FixtureStates(() => {});
    const garage = fixture({ entity_id: "cover.garage", kind: "cover" });
    const { hass, callService } = fakeHass({ "cover.garage": "closed" });
    hass.states["cover.garage"].attributes = { device_class: "garage" };
    const { host, events } = fakeHost();

    expect(states.tap(host, hass, garage)).toBe("confirm");
    expect(callService).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    states.toggle(hass, garage);
    expect(callService).toHaveBeenCalledWith("cover", "toggle", {}, { entity_id: "cover.garage" });
  });

  it("does not ask about something that is not there to move", () => {
    const states = new FixtureStates(() => {});
    const garage = fixture({ entity_id: "cover.garage", kind: "cover", options: { tap: "confirm" } });
    const { hass, callService } = fakeHass({ "cover.garage": "unavailable" });
    const { host, events } = fakeHost();
    expect(states.tap(host, hass, garage)).toBeUndefined();
    expect(callService).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "hass-more-info", detail: { entityId: "cover.garage" } }]);
  });

  it("never unlocks a door on a tap", () => {
    const states = new FixtureStates(() => {});
    const lock = fixture({ entity_id: "lock.front", kind: "lock", options: { tap: "toggle" } });
    const { hass, callService } = fakeHass({ "lock.front": "locked" });
    const { host, events } = fakeHost();
    expect(states.tap(host, hass, lock)).toBeUndefined();
    expect(callService).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "hass-more-info", detail: { entityId: "lock.front" } }]);
  });

  it("forgets pending toggles when disposed", () => {
    const changed = vi.fn();
    const states = new FixtureStates(changed);
    const { hass } = fakeHass({ "light.kitchen": "off" });
    states.tap(fakeHost().host, hass, fixture());
    changed.mockClear();
    states.dispose();
    vi.advanceTimersByTime(5000);
    expect(changed).not.toHaveBeenCalled();
  });
});
