import { describe, expect, it } from "vitest";
import { FASHION_GROUPS, isTranslationForm, translationsOf } from "../src/lib/fashionWords.js";

// Petit dictionnaire de la mode, français ↔ anglais (décision du fondateur du
// 2026-10-27) : environ 80 mots français, dans le serveur, sans appel extérieur.

describe("dictionnaire de la mode", () => {
  it("environ 80 mots français (avec leurs féminins à part) ; toutes les formes en minuscules, sans accents ni espaces", () => {
    expect(FASHION_GROUPS.length).toBeGreaterThanOrEqual(70);
    expect(FASHION_GROUPS.length).toBeLessThanOrEqual(90);
    for (const mot of FASHION_GROUPS.flatMap(([fr, en]) => [...fr, ...en])) expect(mot).toMatch(/^[a-z]+$/);
  });

  it("dans les deux sens, et les autres formes françaises d'un même mot", () => {
    expect([...translationsOf("veste")]).toEqual(expect.arrayContaining(["jacket", "blazer"]));
    expect([...translationsOf("jacket")]).toEqual(expect.arrayContaining(["veste", "blouson"]));
    expect([...translationsOf("noire")]).toEqual(expect.arrayContaining(["black", "noir"]));
    expect(translationsOf("veste").has("veste")).toBe(false);
  });

  it("un mot tapé au pluriel trouve ses traductions", () => {
    expect(translationsOf("bottes").has("boot")).toBe(true);
    expect(translationsOf("bijoux").has("jewelry")).toBe(true);
    expect(translationsOf("dresses").has("robe")).toBe(true);
    expect([...translationsOf("jeans")]).toEqual(expect.arrayContaining(["jean", "denim"]));
  });

  it("une marque, ou un mot absent, n'a aucune traduction", () => {
    expect(translationsOf("sezane").size).toBe(0);
    expect(translationsOf("zara").size).toBe(0);
  });

  it("une traduction compte telle quelle ou au pluriel, jamais au début d'un mot plus long", () => {
    expect(isTranslationForm("bag", "bag")).toBe(true);
    expect(isTranslationForm("bags", "bag")).toBe(true);
    expect(isTranslationForm("manteaux", "manteau")).toBe(true);
    expect(isTranslationForm("baggy", "bag")).toBe(false);
  });
});
