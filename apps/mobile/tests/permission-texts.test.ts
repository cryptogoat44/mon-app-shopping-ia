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

/** Texte « photosPermission » d'un module dans app.json. */
function textePlugin(nom: string): string {
  const plugins = champ(champ(lire("../app.json"), "expo"), "plugins");
  if (!Array.isArray(plugins)) throw new Error("plugins absents");
  const entree: unknown = plugins.find((p: unknown) => Array.isArray(p) && p[0] === nom);
  if (!Array.isArray(entree)) throw new Error(`${nom} absent`);
  return texte(entree[1], "photosPermission");
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
