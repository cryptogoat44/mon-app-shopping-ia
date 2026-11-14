import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import marque from "@monapp/shared-types/marque.json";
import { APP_NAME_DISPLAY } from "../src/constants/brand";
import { setActiveLocale } from "../src/i18n";
import { tryonText } from "../src/i18n/tryon.web";
import { TRYON_CONSENT_TEXT_VERSION, tryonFr } from "../src/i18n/tryon-fr.web";
import { tryonEn } from "../src/i18n/tryon-en.web";

// Essayage virtuel photo : le catalogue de textes réservé au site
// (src/i18n/tryon-*.web.ts). Hors de fr.ts et en.ts, qui partent aussi dans
// l'app iPhone ; tests/i18n.test.ts ne le couvre donc pas : mêmes contrôles
// ici (mêmes clés dans les deux langues, aucun français dans l'anglais,
// vouvoiement, nom du produit tiré de BRAND, textes lus à l'affichage).

/** Tous les textes d'un catalogue, fonctions appelées avec des valeurs d'exemple. */
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") return texts(node(2, 3));
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") return Object.values(node).flatMap(texts);
  return [];
}

function keys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

const FRENCH_MARKS = /[àâçéèêëîïôûùœ«»]|\b(vous|votre|le|la|les|des|une|pour|avec)\b/i;
// Bornes de mots qui connaissent les lettres accentuées : avec \b, « complète »
// finirait par un « te » isolé.
const TUTOIEMENT = /(?<!\p{L})(tu|te|toi|ton|ta|tes)(?!\p{L})|(?<!\p{L})t'/iu;
const NOM = new RegExp(marque.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

afterEach(() => {
  setActiveLocale("fr");
  vi.doUnmock("@monapp/shared-types/marque.json");
  vi.resetModules();
});

describe("catalogue de l'essayage (site seulement)", () => {
  it("les deux langues ont exactement les mêmes clés, dans le même ordre", () => {
    expect(keys(tryonEn)).toEqual(keys(tryonFr));
    expect(texts(tryonEn)).toHaveLength(texts(tryonFr).length);
  });

  it("aucun texte vide ; aucun français dans l'anglais", () => {
    for (const text of [...texts(tryonFr), ...texts(tryonEn)]) expect(text.trim().length, text).toBeGreaterThan(0);
    expect(texts(tryonEn).filter((text) => FRENCH_MARKS.test(text))).toEqual([]);
  });

  it("aucun texte français laissé identique à l'anglais", () => {
    const english = texts(tryonEn);
    expect(texts(tryonFr).filter((text, index) => text === english[index])).toEqual([]);
  });

  it("français : vouvoiement, jamais de tutoiement", () => {
    // Le détecteur voit le tutoiement, pas les mots qui finissent en « te ».
    for (const sample of ["Tu peux essayer.", "Choisis ta photo.", "Retire ton accord.", "Si t'es seul·e"]) expect(sample).toMatch(TUTOIEMENT);
    for (const sample of ["Indiquez une date complète.", "Cette photo est la mienne.", "Votre statut"]) expect(sample).not.toMatch(TUTOIEMENT);
    const all = texts(tryonFr).join("\n");
    expect(all).not.toMatch(TUTOIEMENT);
    expect(all).toMatch(/\bvous\b/);
  });

  it("la langue suit celle de l'app, lue à chaque affichage", () => {
    expect(tryonText.entry.button).toBe("Essayer");
    setActiveLocale("en");
    expect(tryonText.entry.button).toBe("Try on");
    expect(tryonText.consent.accept).toBe("I agree");
    expect(tryonText.photo.attest).toBe("This photo is of me");
  });
});

describe("textes demandés par le lot", () => {
  it("consentement : le texte français à l'identique, le nom du produit tiré de BRAND", () => {
    expect(tryonFr.consent.body).toBe(
      `Pour créer votre essayage, votre photo est envoyée à FASHN (Royaume-Uni) et à ses prestataires, dont certains aux États-Unis et en Asie. Elle n'est ni conservée par ${APP_NAME_DISPLAY} ni utilisée pour entraîner une IA. Utilisez uniquement une photo de vous. L'image produite est générée par IA. Vous pouvez retirer votre consentement à tout moment dans Réglages.`
    );
    expect(tryonEn.consent.body).toBe(
      `To create your try-on, your photo is sent to FASHN (United Kingdom) and its service providers, some of them in the United States and Asia. It is neither kept by ${APP_NAME_DISPLAY} nor used to train an AI. Only use a photo of yourself. The image produced is AI-generated. You can withdraw your consent at any time in Settings.`
    );
    expect([tryonFr.consent.accept, tryonFr.consent.cancel, tryonFr.consent.learnMore]).toEqual(["J'accepte", "Annuler", "En savoir plus"]);
    expect([tryonEn.consent.accept, tryonEn.consent.cancel]).toEqual(["I agree", "Cancel"]);
  });

  it("« En savoir plus » : ce qui part, combien de temps, pas d'entraînement, 12 mois d'usage, retrait ; règles d'usage", () => {
    expect(tryonFr.consent.kept).toContain("au plus tard sous un jour");
    expect(tryonFr.consent.kept).toContain("60 minutes au plus");
    expect(tryonFr.consent.training).toContain("entraîner une IA");
    expect(tryonFr.consent.usage).toContain("12 mois");
    expect(tryonFr.consent.withdraw).toContain("Réglages");
    expect(tryonFr.consent.rules.join(" ")).toMatch(/photo de vous.*autre personne.*mineur/);
    expect(tryonFr.consent.rules.join(" ")).toContain("comme une vraie photo");
    expect(tryonEn.consent.kept).toContain("60 minutes at most");
  });

  it("photo : conseils, case « Cette photo est la mienne », « Lancer l'essai », durée annoncée", () => {
    expect(tryonFr.photo.tips).toEqual(["Seul·e sur la photo", "En pied ou à mi-corps", "Une bonne lumière", "Des vêtements ajustés"]);
    expect(tryonFr.photo.attest).toBe("Cette photo est la mienne");
    expect(tryonFr.photo.launch).toBe("Lancer l'essai");
    expect(tryonFr.running.duration).toBe("Environ 10 secondes.");
    expect([tryonFr.result.save, tryonFr.result.report]).toEqual(["Enregistrer l'image", "Signaler"]);
  });

  it("texte mis à jour depuis l'ouverture de la page : « rechargez la page », en français et en anglais", () => {
    expect(tryonFr.consent.reloadTitle).toBe("Le texte a été mis à jour");
    expect(tryonFr.consent.reloadBody).toContain("Rechargez la page");
    expect(tryonEn.consent.reloadTitle).toBe("The text has been updated");
    expect(tryonEn.consent.reloadBody).toContain("Reload the page");
  });

  it("version des textes de consentement du site : à côté des textes (jamais dans le contrat partagé), celle que le serveur attend", () => {
    expect(TRYON_CONSENT_TEXT_VERSION).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
    const server = readFileSync(join(__dirname, "../../backend/src/lib/tryon/config.ts"), "utf8");
    expect(server).toContain(`export const TRYON_CONSENT_VERSION = "${TRYON_CONSENT_TEXT_VERSION}";`);
    const contract = readFileSync(join(__dirname, "../../../packages/shared-types/src/index.ts"), "utf8");
    expect(contract).not.toContain(TRYON_CONSENT_TEXT_VERSION);
  });

  it("Réglages : « Essayage virtuel : retirer mon consentement »", () => {
    expect(tryonFr.settings.withdrawLabel).toBe("Essayage virtuel : retirer mon consentement");
    expect(tryonEn.settings.withdrawLabel).toBe("Virtual try-on: withdraw my consent");
  });
});

describe("nom du produit : jamais écrit en dur dans le catalogue", () => {
  it("avec un autre nom dans marque.json, le nouveau nom arrive dans les textes, l'ancien nulle part", async () => {
    vi.resetModules();
    vi.doMock("@monapp/shared-types/marque.json", () => ({ default: { ...marque, nom: "Zorglub" } }));
    const [{ tryonFr: fr }, { tryonEn: en }] = await Promise.all([import("../src/i18n/tryon-fr.web"), import("../src/i18n/tryon-en.web")]);
    for (const catalog of [fr, en]) {
      const all = texts(catalog);
      expect(all.filter((text) => NOM.test(text))).toEqual([]);
      expect(all.some((text) => text.includes("Zorglub"))).toBe(true);
    }
    expect(fr.result.fileBase).toBe("zorglub-essayage");
    expect(en.result.fileBase).toBe("zorglub-try-on");
  });
});

describe("textes de l'essayage lus à l'affichage, jamais au chargement d'un module", () => {
  const ROOT = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  /** Lignes qui lisent `tryonText.` dans un objet ou un tableau déclaré au premier niveau (même règle que tests/i18n-at-render.test.ts). */
  function readAtLoad(source: string): number[] {
    const found: number[] = [];
    let inside = false;
    const reads = (line: string) => /(?<![\w.])tryonText\.[a-zA-Z]/.test(line) && !line.includes("=>") && !line.includes("function");
    source.split("\n").forEach((line, index) => {
      const opens = /^(export )?const \w+[^=]*= *[{[]\s*$/.test(line);
      const oneLine = /^(export )?const \w+[^=]*= *[{[].*[}\]];?\s*$/.test(line);
      if (opens || oneLine) {
        inside = opens;
        if (oneLine && reads(line)) found.push(index + 1);
        return;
      }
      if (!inside) return;
      if (/^[}\]]/.test(line)) {
        inside = false;
        return;
      }
      if (reads(line)) found.push(index + 1);
    });
    return found;
  }

  it("le détecteur voit une lecture figée", () => {
    expect(readAtLoad("const LABELS = {\n  a: tryonText.photo.title,\n};\nconst later = () => tryonText.photo.title;")).toEqual([2]);
  });

  it("aucun fichier ne fige un texte de l'essayage", () => {
    const found = files(ROOT)
      .filter((file) => !relative(ROOT, file).startsWith("i18n/"))
      .flatMap((file) => readAtLoad(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`));
    expect(found).toEqual([]);
  });
});
