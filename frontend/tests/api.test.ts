import { describe, expect, it, vi } from "vitest";
import {
  describeFloors,
  DioramaApi,
  errorCode,
  errorMessage,
  isConflict,
  type Transport,
} from "../src/core/api";
import type { Floor, House } from "../src/core/scene";

const house: House = {
  schema_version: 1,
  revision: 4,
  settings: { name: "Home" },
  floors: [{ id: "f1", name: "Ground", elevation: 0, ha_floor_id: null }],
};

const floor: Floor = {
  schema_version: 1,
  revision: 7,
  id: "f1",
  wall_height: 2.4,
  vertices: [],
  walls: [],
  openings: [],
  rooms: [],
  items: [],
  fixtures: [],
  trace: null,
};

function fakeTransport(result: unknown) {
  const callWS = vi.fn().mockResolvedValue(result);
  const unsubscribe = vi.fn();
  const subscribeMessage = vi.fn().mockResolvedValue(unsubscribe);
  const transport = { callWS, connection: { subscribeMessage } } as unknown as Transport;
  return { api: new DioramaApi(transport), callWS, subscribeMessage, unsubscribe };
}

describe("DioramaApi", () => {
  it("gets the house", async () => {
    const { api, callWS } = fakeTransport({ house });
    expect(await api.getHouse()).toBe(house);
    expect(callWS).toHaveBeenCalledWith({ type: "diorama/house/get" });
  });

  it("saves the house against the revision it was given", async () => {
    const { api, callWS } = fakeTransport({ house });
    const input = { floors: [{ id: "f1", name: "Ground" }] };
    await api.saveHouse(input, 3);
    expect(callWS).toHaveBeenCalledWith({ type: "diorama/house/save", revision: 3, house: input });
  });

  it("gets a floor by id", async () => {
    const { api, callWS } = fakeTransport({ floor });
    expect(await api.getFloor("f1")).toBe(floor);
    expect(callWS).toHaveBeenCalledWith({ type: "diorama/floor/get", floor_id: "f1" });
  });

  it("saves a floor against its own id and revision", async () => {
    const saved = { ...floor, revision: 8 };
    const { api, callWS } = fakeTransport({ floor: saved });
    expect(await api.saveFloor(floor)).toBe(saved);
    expect(callWS).toHaveBeenCalledWith({
      type: "diorama/floor/save",
      floor_id: "f1",
      revision: 7,
      floor,
    });
  });

  it("deletes a floor and returns the house", async () => {
    const { api, callWS } = fakeTransport({ house });
    expect(await api.deleteFloor("f1")).toBe(house);
    expect(callWS).toHaveBeenCalledWith({ type: "diorama/floor/delete", floor_id: "f1" });
  });

  it("exports and imports", async () => {
    const exported = { diorama_export: 1, house, floors: { f1: floor } };
    const exporting = fakeTransport({ export: exported });
    expect(await exporting.api.exportHouse()).toBe(exported);

    const importing = fakeTransport({ house });
    await importing.api.importHouse(exported);
    expect(importing.callWS).toHaveBeenCalledWith({ type: "diorama/import", data: exported });
  });

  it("subscribes and hands back the unsubscribe function", async () => {
    const { api, subscribeMessage, unsubscribe } = fakeTransport(undefined);
    const listener = vi.fn();
    expect(await api.subscribe(listener)).toBe(unsubscribe);
    expect(subscribeMessage).toHaveBeenCalledWith(listener, { type: "diorama/subscribe" });
  });

  it("lets a rejected command through", async () => {
    const { api, callWS } = fakeTransport(undefined);
    const failure = { code: "conflict", message: "The floor has changed" };
    callWS.mockRejectedValue(failure);
    await expect(api.saveFloor(floor)).rejects.toBe(failure);
  });
});

describe("errors", () => {
  it("reads the code and message Home Assistant sends", () => {
    const failure = { code: "conflict", message: "The floor has changed" };
    expect(errorCode(failure)).toBe("conflict");
    expect(isConflict(failure)).toBe(true);
    expect(errorMessage(failure)).toBe("The floor has changed");
  });

  it("copes with anything else", () => {
    for (const failure of [undefined, null, "boom", new Error(""), { code: 5 }]) {
      expect(errorCode(failure)).toBeUndefined();
      expect(isConflict(failure)).toBe(false);
      expect(errorMessage(failure)).toMatch(/went wrong/);
    }
    expect(errorMessage(new Error("offline"))).toBe("offline");
  });
});

describe("describeFloors", () => {
  it.each([
    [0, "No floors yet"],
    [1, "1 floor"],
    [3, "3 floors"],
  ])("%i floors", (count, expected) => {
    const floors = Array.from({ length: count }, (_, n) => ({ ...house.floors[0], id: `f${n}` }));
    expect(describeFloors({ ...house, floors })).toBe(expected);
  });
});
