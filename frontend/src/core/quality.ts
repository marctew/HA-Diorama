// How much the renderer asks of the device. Picked once from what the browser
// says about itself; a card or the panel can override it.

export type Quality = "low" | "medium" | "high";

export interface QualitySettings {
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** The most device pixels drawn for each CSS pixel. */
  maxPixelRatio: number;
}

export const QUALITY: Readonly<Record<Quality, QualitySettings>> = {
  low: { shadows: false, shadowMapSize: 0, antialias: false, maxPixelRatio: 1 },
  medium: { shadows: true, shadowMapSize: 1024, antialias: true, maxPixelRatio: 1.5 },
  high: { shadows: true, shadowMapSize: 2048, antialias: true, maxPixelRatio: 2 },
};

export interface DeviceHints {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory, in gigabytes; not every browser has it. */
  memory?: number;
  /** A phone or tablet. */
  mobile?: boolean;
  /** The user asked the system for less motion or data. */
  saveData?: boolean;
}

/** A cautious guess: wall tablets and old phones get "low", most phones and
 * modest laptops "medium", everything else "high". */
export function pickQuality(hints: DeviceHints): Quality {
  const cores = hints.cores ?? 4;
  const memory = hints.memory ?? 4;
  if (hints.saveData || cores <= 2 || memory <= 2) return "low";
  if (hints.mobile) return cores >= 8 && memory >= 6 ? "medium" : "low";
  if (cores <= 4 || memory <= 4) return "medium";
  return "high";
}

export function isQuality(value: unknown): value is Quality {
  return value === "low" || value === "medium" || value === "high";
}

/** What this browser says about its device. */
export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
    userAgentData?: { mobile?: boolean };
  };
  return {
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile|Silk/i.test(nav.userAgent),
    saveData: nav.connection?.saveData,
  };
}
