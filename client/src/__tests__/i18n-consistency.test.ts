import { describe, expect, it } from "vitest";
import en from "../../public/locales/en/translation.json";
import zhCN from "../../public/locales/zh-CN/translation.json";
import zhTW from "../../public/locales/zh-TW/translation.json";
import ja from "../../public/locales/ja/translation.json";

type TranslationTree = Record<string, unknown>;

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix];
  }

  return Object.entries(value as TranslationTree).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const locales: Array<[string, TranslationTree]> = [
  ["en", en],
  ["zh-CN", zhCN],
  ["zh-TW", zhTW],
  ["ja", ja],
];

const referenceKeys = flatten(en).sort();

describe("translation files", () => {
  it.each(locales)("%s parses into a non-empty key set", (_name, tree) => {
    expect(flatten(tree).length).toBeGreaterThan(0);
  });

  it.each(locales.slice(1))("%s has exactly the same keys as en", (_name, tree) => {
    const keys = flatten(tree).sort();
    const missing = referenceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !referenceKeys.includes(key));

    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(locales)("%s contains no empty or untranslated placeholders", (_name, tree) => {
    const offenders = Object.entries(flatten(tree).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = key.split(".").reduce<unknown>((node, part) => (node as TranslationTree)?.[part], tree);
      return acc;
    }, {}))
      .filter(([, value]) => typeof value === "string" && value.trim().length === 0)
      .map(([key]) => key);

    expect(offenders).toEqual([]);
  });
});
