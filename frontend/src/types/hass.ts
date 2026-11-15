// The parts of Home Assistant's `hass` object that Diorama uses. See
// https://contributors.home-assistant.io/frontend/reference/hass-object/

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HassArea {
  area_id: string;
  name: string;
  floor_id: string | null;
}

export interface HassFloor {
  floor_id: string;
  name: string;
  level: number | null;
}

export interface HassUser {
  is_admin: boolean;
}

export interface HomeAssistant {
  states: Record<string, HassEntityState>;
  areas: Record<string, HassArea>;
  floors: Record<string, HassFloor>;
  user?: HassUser;
  dockedSidebar?: "docked" | "always_hidden" | "auto";
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: { entity_id?: string | string[] },
  ): Promise<unknown>;
  callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
}

export interface PanelInfo {
  config?: { version?: string; [key: string]: unknown };
}
