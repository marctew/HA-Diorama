import { describe, expect, it } from "vitest";
import { bestLanguage, format, splitAround } from "../src/core/localize";
import en from "../src/locales/en";
import { languageOf, localizer } from "../src/shared/localize";

describe("format", () => {
  it("fills in the words in braces", () => {
    expect(format("Open {name}?", { name: "Garage door" })).toBe("Open Garage door?");
    expect(format("{a} and {b} and {a}", { a: 1, b: "two" })).toBe("1 and two and 1");
    expect(format("Nothing to fill")).toBe("Nothing to fill");
  });

  it("leaves a placeholder it has no value for, so the mistake shows", () => {
    expect(format("Open {name}?", {})).toBe("Open {name}?");
  });

  it("does not expand what a value contains", () => {
    expect(format("Open {name}?", { name: "{name}{other}" })).toBe("Open {name}{other}?");
  });
});

describe("splitAround", () => {
  it("cuts a sentence round a placeholder", () => {
    expect(splitAround("Open {link} in the sidebar.", "link")).toEqual(["Open ", " in the sidebar."]);
    expect(splitAround("{name}?", "name")).toEqual(["", "?"]);
    expect(splitAround("Ends with {name}", "name")).toEqual(["Ends with ", ""]);
    expect(splitAround("No placeholder", "name")).toEqual(["No placeholder", ""]);
  });
});

describe("bestLanguage", () => {
  const available = ["fr", "pt-BR", "en-GB", "zh-Hans"];

  it("takes the same language, whatever the case", () => {
    expect(bestLanguage("fr", available)).toBe("fr");
    expect(bestLanguage("pt-br", available)).toBe("pt-BR");
  });

  it("falls back to the language without its region, or with another", () => {
    expect(bestLanguage("fr-CA", available)).toBe("fr");
    expect(bestLanguage("pt", available)).toBe("pt-BR");
    expect(bestLanguage("en", available)).toBe("en-GB");
  });

  it("is undefined when there is nothing suitable", () => {
    expect(bestLanguage("de", available)).toBeUndefined();
    expect(bestLanguage(undefined, available)).toBeUndefined();
    expect(bestLanguage("fr", [])).toBeUndefined();
  });
});

describe("the English words", () => {
  it("have no empty entries and balanced braces", () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe("");
      expect((text.match(/\{/g) ?? []).length, key).toBe((text.match(/\}/g) ?? []).length);
    }
  });

  it("ask the same thing the button says", () => {
    for (const verb of ["open", "close", "switch_on", "switch_off"] as const) {
      expect(en[`view.${verb}_question`]).toContain("{name}");
      expect(en[`view.${verb}_question`].startsWith(en[`view.${verb}`])).toBe(true);
    }
  });
});

describe("localizer", () => {
  it("answers in English when there is no translation for the language", () => {
    for (const language of [undefined, "en", "en-GB", "de", "tlh"]) {
      const t = localizer(undefined, language);
      expect(t("view.reset")).toBe("Reset view");
      expect(t("view.open_question", { name: "Garage door" })).toBe("Open Garage door?");
    }
  });

  it("reads the language from hass", () => {
    expect(languageOf({ locale: { language: "fr" }, language: "en" })).toBe("fr");
    expect(languageOf({ language: "nl" })).toBe("nl");
    expect(languageOf(undefined)).toBeUndefined();
  });
});
