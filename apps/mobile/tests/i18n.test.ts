import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { PUBLISHER_EN, readPublisher } from "../src/legal/publisher";
import { splitPlaceholders } from "../src/lib/legal";
import { sanitizeProps } from "../src/lib/analytics-events";

// Tous les textes d'un catalogue, fonctions appelées avec des valeurs d'exemple.
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") return texts(node("TikTok", "Example", 2));
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") return Object.values(node).flatMap(texts);
  return [];
}

function keys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

const FRENCH_MARKS = /[àâçéèêëîïôûùœ«»]|\b(vous|votre|le|la|les|des|une|pour|avec)\b/i;
const documentText = (doc: typeof termsOfUse) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]);

describe("langues de l'interface (lot 3)", () => {
  it("les deux catalogues ont exactement les mêmes clés", () => {
    expect(keys(en)).toEqual(keys(fr));
  });

  it("aucun texte français dans le catalogue anglais", () => {
    const leaks = texts(en).filter((text) => text !== "Français" && FRENCH_MARKS.test(text));
    expect(leaks).toEqual([]);
  });

  it("aucun texte laissé identique à l'anglais dans le catalogue français, sauf noms propres", () => {
    const allowed = new Set(["Spotter", "TikTok", "Instagram", "Pinterest", "Vault", "Lifestyle", "Bio", "Spam", "OK", "Public", "English", "Français", "Documents", "Email"]);
    const enTexts = texts(en);
    const same = texts(fr).filter((text, index) => text === enTexts[index] && !allowed.has(text) && !/^[\d\s·(),.]+$/.test(text));
    expect(same).toEqual([]);
  });

  it("les nombres s'accordent en anglais", () => {
    expect(en.result.count(1, null)).toBe("1 suggestion");
    expect(en.result.count(3, "veste")).toBe("3 suggestions for “veste”");
    expect(en.comments.countLabel(0)).toBe("Comment");
    expect(en.userProfile.followers(1)).toBe("1 follower");
  });

  it("les événements de préférence n'acceptent que leurs valeurs", () => {
    expect(sanitizeProps("language_changed", { locale: "en", context: "welcome" })).toEqual({ locale: "en", context: "welcome" });
    expect(sanitizeProps("language_changed", { locale: "de", context: "ailleurs" })).toEqual({});
    expect(sanitizeProps("theme_changed", { theme: "dark", extra: "x" })).toEqual({ theme: "dark" });
    expect(sanitizeProps("theme_changed", { theme: "noir" })).toEqual({});
  });
});

describe("documents juridiques en anglais (lot 3)", () => {
  it("même plan que la version française", () => {
    for (const [french, english] of [[termsOfUse, termsOfUseEn], [privacyPolicy, privacyPolicyEn]] as const) {
      expect(english.type).toBe(french.type);
      expect(english.sections.length).toBe(french.sections.length);
      english.sections.forEach((section, index) => {
        expect(section.blocks.length, section.title).toBe(french.sections[index]!.blocks.length);
      });
    }
  });

  it("aucun mot français, mêmes variables d'éditeur, champs à compléter en anglais", () => {
    for (const doc of [termsOfUseEn, privacyPolicyEn]) {
      const text = documentText(doc);
      expect(text.filter((line) => FRENCH_MARKS.test(line.replace(/\[To be[^\]]*\]/g, "")))).toEqual([]);
      const joined = text.join("\n");
      expect(joined).toContain(PUBLISHER_EN.name);
      expect(joined).toContain(PUBLISHER_EN.email);
      expect(joined).not.toContain("[À ");
    }
    expect(readPublisher({ status: "Personne physique non immatriculée" }, "en").status).toBe("individual, not registered");
    expect(readPublisher({ status: "personne physique non immatriculée" }, "fr").status).toBe("personne physique non immatriculée");
    expect(readPublisher({ status: "SAS au capital de 1 000 €" }, "en").status).toBe("SAS au capital de 1 000 €");
    const placeholders = readPublisher({}, "en");
    expect(placeholders.address).toBe("[To be completed: postal address]");
    expect(splitPlaceholders(`Address: ${placeholders.address}.`)[1]).toEqual({ text: "[To be completed: postal address]", placeholder: true });
  });
});
