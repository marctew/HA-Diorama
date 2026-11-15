// The parts of translation that need no browser: filling in a sentence and
// choosing a language. The words themselves are in src/locales.

/** Put values into a sentence: "Open {name}?" with { name: "Garage" }. A
 * placeholder with no value is left as it is, so that a mistake shows. */
export function format(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/** A sentence cut in two round a placeholder, for when what goes there is
 * not text (a link, a name in bold). The second part is empty if the
 * placeholder comes last, and the whole sentence is first if it is absent. */
export function splitAround(template: string, placeholder: string): [string, string] {
  const marker = `{${placeholder}}`;
  const at = template.indexOf(marker);
  if (at < 0) return [template, ""];
  return [template.slice(0, at), template.slice(at + marker.length)];
}

/** The language to use of those there are, for the one Home Assistant is
 * set to: the same one, else the same language of another region ("pt" for
 * "pt-BR", "en-GB" for "en"), else undefined. */
export function bestLanguage(wanted: string | undefined, available: readonly string[]): string | undefined {
  if (!wanted) return undefined;
  const lower = wanted.toLowerCase();
  const exact = available.find((language) => language.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split("-")[0];
  return (
    available.find((language) => language.toLowerCase() === base) ??
    available.find((language) => language.toLowerCase().split("-")[0] === base)
  );
}
