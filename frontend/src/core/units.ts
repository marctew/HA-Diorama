// Lengths are stored in metres. These show them and read them in the units
// Home Assistant is set to.

export type UnitSystem = "metric" | "imperial";

const METRES_PER_FOOT = 0.3048;
const METRES_PER_INCH = 0.0254;

/** "3.20 m", or 10′ 6″. */
export function formatLength(metres: number, system: UnitSystem): string {
  if (system === "metric") return `${metres.toFixed(2)} m`;
  const totalInches = Math.round(metres / METRES_PER_INCH);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return `${feet}′ ${inches}″`;
}

/** "12.4 m²", or 133 sq ft. */
export function formatArea(squareMetres: number, system: UnitSystem): string {
  if (system === "metric") return `${squareMetres.toFixed(1)} m²`;
  return `${Math.round(squareMetres / (METRES_PER_FOOT * METRES_PER_FOOT))} sq ft`;
}

/** Read a length someone typed, in metres. A bare number is metres or feet,
 * by unit system. Understands 3.2, 3,2, 3.2m, 320cm, 3200 mm, 10ft, 10' 6",
 * 10ft 6in, 6in. Returns undefined for anything else, and for zero or less. */
export function parseLength(text: string, system: UnitSystem): number | undefined {
  const input = text.trim().toLowerCase().replace(/,/g, ".").replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!input) return undefined;
  const number = "(\\d+(?:\\.\\d+)?|\\.\\d+)";

  const feetInches = new RegExp(
    `^(?:${number}\\s*(?:'|ft|feet|foot))?\\s*(?:${number}\\s*(?:"|in|inch|inches))?$`,
  ).exec(input);
  if (feetInches && (feetInches[1] !== undefined || feetInches[2] !== undefined)) {
    return positive(
      Number(feetInches[1] ?? 0) * METRES_PER_FOOT + Number(feetInches[2] ?? 0) * METRES_PER_INCH,
    );
  }

  const metric = new RegExp(`^${number}\\s*(mm|cm|m)?$`).exec(input);
  if (!metric) return undefined;
  const value = Number(metric[1]);
  switch (metric[2]) {
    case "mm":
      return positive(value / 1000);
    case "cm":
      return positive(value / 100);
    case "m":
      return positive(value);
    default:
      return positive(system === "metric" ? value : value * METRES_PER_FOOT);
  }
}

function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(6)) : undefined;
}

/** The length to show in a field for editing: a plain number in the system's
 * own unit, which `parseLength` reads back. */
export function lengthForInput(metres: number, system: UnitSystem): string {
  if (system === "metric") return String(Number(metres.toFixed(3)));
  return String(Number((metres / METRES_PER_FOOT).toFixed(2)));
}
