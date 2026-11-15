// Words for the user, in their language where there is a translation and in
// English where there is not. English is always there; another language is
// fetched the first time it is wanted.

import { bestLanguage, format } from "../core/localize";
import en from "../locales/en";

export type TranslationKey = keyof typeof en;
export type Translation = Partial<Record<TranslationKey, string>>;
export type Localize = (
  key: TranslationKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

/** One line per language other than English, by Home Assistant's code for it:
 *   fr: () => import("../locales/fr"),
 * The file's default export is a `Translation`. */
const LOADERS: Readonly<Record<string, () => Promise<{ default: Translation }>>> = {};

const loaded = new Map<string, Translation>();
const loading = new Map<string, Promise<void>>();

const english: Localize = (key, values) => format(en[key], values);

/** The translation function for a language. Give it the element asking, and
 * that is redrawn when a language that had to be fetched has arrived. */
export function localizer(
  host: { requestUpdate(): void } | undefined,
  language: string | undefined,
): Localize {
  const chosen = bestLanguage(language, Object.keys(LOADERS));
  if (!chosen) return english;
  const words = loaded.get(chosen);
  if (words) return (key, values) => format(words[key] ?? en[key], values);
  let pending = loading.get(chosen);
  if (!pending) {
    pending = LOADERS[chosen]().then(
      (module) => void loaded.set(chosen, module.default),
      (error) => {
        console.warn(`Diorama: the ${chosen} translation did not load`, error);
        loaded.set(chosen, {});
      },
    );
    loading.set(chosen, pending);
  }
  if (host) void pending.then(() => host.requestUpdate());
  return english;
}

/** The language Home Assistant is set to for this user. */
export function languageOf(
  hass: { locale?: { language?: string }; language?: string } | undefined,
): string | undefined {
  return hass?.locale?.language ?? hass?.language;
}
