import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Texte de la fenêtre d'autorisation d'iOS (accès aux photos) : écrit à trois
// endroits — app.json (deux modules), locales/fr.json (iPhone en français),
// locales/en.json. Lot 4 ter : le texte avait été changé dans app.json mais
// pas dans locales/fr.json, et iOS montrait encore l'ancien en français.
function lire(chemin: string): unknown {
  return JSON.parse(readFileSync(new URL(chemin, import.meta.url), "utf8"));
}

function champ(objet: unknown, cle: string): unknown {
  if (typeof objet !== "object" || objet === null || !(cle in objet)) throw new Error(`« ${cle} » absent`);
  return Reflect.get(objet, cle);
}

function texte(objet: unknown, cle: string): string {
  const valeur = champ(objet, cle);
  if (typeof valeur !== "string" || valeur.trim() === "") throw new Error(`« ${cle} » vide`);
  return valeur;
}

/** Texte « photosPermission » (ou une autre clé) d'un module dans app.json. */
function textePlugin(nom: string, cle = "photosPermission"): string {
  const plugins = champ(champ(lire("../app.json"), "expo"), "plugins");
  if (!Array.isArray(plugins)) throw new Error("plugins absents");
  const entree: unknown = plugins.find((p: unknown) => Array.isArray(p) && p[0] === nom);
  if (!Array.isArray(entree)) throw new Error(`${nom} absent`);
  return texte(entree[1], cle);
}

describe("texte de l'autorisation d'accès aux photos (iOS)", () => {
  it("le même en français partout : app.json (deux modules) et locales/fr.json", () => {
    const fr = texte(lire("../locales/fr.json"), "NSPhotoLibraryUsageDescription");
    expect(textePlugin("expo-media-library")).toBe(fr);
    expect(textePlugin("expo-image-picker")).toBe(fr);
  });

  it("présent en anglais, et traduit", () => {
    const en = texte(lire("../locales/en.json"), "NSPhotoLibraryUsageDescription");
    expect(en).not.toBe(texte(lire("../locales/fr.json"), "NSPhotoLibraryUsageDescription"));
  });
});

// Lot « app iPhone prête » (point 14) : bouton « Prendre une photo » du Spotter.
describe("texte de l'autorisation d'accès à l'appareil photo (iOS)", () => {
  it("le même en français dans app.json et locales/fr.json ; présent et traduit en anglais", () => {
    const fr = texte(lire("../locales/fr.json"), "NSCameraUsageDescription");
    expect(textePlugin("expo-image-picker", "cameraPermission")).toBe(fr);
    const en = texte(lire("../locales/en.json"), "NSCameraUsageDescription");
    expect(en).not.toBe(fr);
  });

  it("le micro n'est jamais demandé", () => {
    const plugins = champ(champ(lire("../app.json"), "expo"), "plugins");
    const entree = (plugins as unknown[]).find((p: unknown) => Array.isArray(p) && p[0] === "expo-image-picker") as [string, Record<string, unknown>];
    expect(entree[1].microphonePermission).toBe(false);
  });
});
