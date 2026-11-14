import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tryonFr } from "../src/i18n/tryon-fr.web";
import { tryonEn } from "../src/i18n/tryon-en.web";

// Texte de la fenêtre d'autorisation d'iOS (accès aux photos) : écrit à trois
// endroits — app.json (deux modules), locales/fr.json (iPhone en français),
// locales/en.json. Lot 4 ter : le texte avait été changé dans app.json mais
// pas dans locales/fr.json, et iOS montrait encore l'ancien en français.
// Branche de l'app iPhone avec l'essayage virtuel (feature/essayage-virtuel-mobile) :
// chaque texte dit à la fois les usages d'avant et l'essayage, en français et
// en anglais ; l'ajout d'une image à la photothèque (« Enregistrer l'image »)
// a son propre texte, celui de l'accès « ajout seulement » d'iOS.
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

const fr = (cle: string) => texte(lire("../locales/fr.json"), cle);
const en = (cle: string) => texte(lire("../locales/en.json"), cle);
const TUTOIEMENT = /(?<!\p{L})(tu|te|toi|ton|ta|tes)(?!\p{L})|(?<!\p{L})t'/iu;

describe("texte de l'autorisation d'accès aux photos (iOS)", () => {
  it("le même en français partout : app.json (deux modules) et locales/fr.json", () => {
    expect(textePlugin("expo-media-library")).toBe(fr("NSPhotoLibraryUsageDescription"));
    expect(textePlugin("expo-image-picker")).toBe(fr("NSPhotoLibraryUsageDescription"));
  });

  it("présent en anglais, et traduit", () => {
    expect(en("NSPhotoLibraryUsageDescription")).not.toBe(fr("NSPhotoLibraryUsageDescription"));
  });

  it("dit l'usage d'avant (la dernière vidéo) et l'essayage virtuel, dans les deux langues", () => {
    expect(fr("NSPhotoLibraryUsageDescription")).toContain("votre dernière vidéo");
    expect(fr("NSPhotoLibraryUsageDescription")).toContain("une photo de vous pour l'essayage virtuel");
    expect(en("NSPhotoLibraryUsageDescription")).toContain("your latest video");
    expect(en("NSPhotoLibraryUsageDescription")).toContain("a photo of yourself for the virtual try-on");
  });
});

// Lot « app iPhone prête » (point 14) : bouton « Prendre une photo » du Spotter.
describe("texte de l'autorisation d'accès à l'appareil photo (iOS)", () => {
  it("le même en français dans app.json et locales/fr.json ; présent et traduit en anglais", () => {
    expect(textePlugin("expo-image-picker", "cameraPermission")).toBe(fr("NSCameraUsageDescription"));
    expect(en("NSCameraUsageDescription")).not.toBe(fr("NSCameraUsageDescription"));
  });

  it("dit les usages d'avant (pièce du Spotter, photo de profil) et l'essayage virtuel, dans les deux langues", () => {
    for (const morceau of ["retrouver dans Spotter", "votre photo de profil", "ou une photo de vous pour l'essayage virtuel"]) expect(fr("NSCameraUsageDescription")).toContain(morceau);
    for (const morceau of ["find in Spotter", "your profile photo", "or a photo of yourself for the virtual try-on"]) expect(en("NSCameraUsageDescription")).toContain(morceau);
  });

  it("le micro n'est jamais demandé", () => {
    const plugins = champ(champ(lire("../app.json"), "expo"), "plugins");
    const entree = (plugins as unknown[]).find((p: unknown) => Array.isArray(p) && p[0] === "expo-image-picker") as [string, Record<string, unknown>];
    expect(entree[1].microphonePermission).toBe(false);
  });
});

describe("texte de l'autorisation d'ajout aux photos (iOS, « Enregistrer l'image » de l'essayage)", () => {
  it("le même en français dans app.json (expo-media-library) et locales/fr.json ; présent et traduit en anglais", () => {
    expect(textePlugin("expo-media-library", "savePhotosPermission")).toBe(fr("NSPhotoLibraryAddUsageDescription"));
    expect(en("NSPhotoLibraryAddUsageDescription")).not.toBe(fr("NSPhotoLibraryAddUsageDescription"));
  });

  it("dit à quoi il sert : enregistrer l'image de l'essayage virtuel, rien d'autre", () => {
    expect(fr("NSPhotoLibraryAddUsageDescription").startsWith("Pour enregistrer dans vos photos l'image de votre essayage virtuel")).toBe(true);
    expect(en("NSPhotoLibraryAddUsageDescription").startsWith("To save the image of your virtual try-on to your photos")).toBe(true);
  });
});

describe("textes d'autorisation : forme commune", () => {
  const CLES = ["NSPhotoLibraryUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryAddUsageDescription"];

  it("les boutons cités sont ceux de l'essayage, en français et en anglais", () => {
    expect(fr("NSCameraUsageDescription")).toContain(`« ${tryonFr.photo.launch} »`);
    expect(fr("NSPhotoLibraryUsageDescription")).toContain(`« ${tryonFr.photo.launch} »`);
    expect(fr("NSPhotoLibraryAddUsageDescription")).toContain(`« ${tryonFr.result.save} »`);
    expect(en("NSCameraUsageDescription")).toContain(`“${tryonEn.photo.launch}”`);
    expect(en("NSPhotoLibraryUsageDescription")).toContain(`“${tryonEn.photo.launch}”`);
    expect(en("NSPhotoLibraryAddUsageDescription")).toContain(`“${tryonEn.result.save}”`);
  });

  it("français : vouvoiement ; le nom du produit par son repère {nom} là où il est cité ; aucun fournisseur nommé", () => {
    for (const cle of CLES) {
      expect(fr(cle), cle).not.toMatch(TUTOIEMENT);
      expect(fr(cle), cle).toMatch(/\bvous\b|\bvotre\b|\bvos\b/);
      expect(`${fr(cle)} ${en(cle)}`, cle).not.toMatch(/fashn/i);
    }
    for (const cle of ["NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
      expect(fr(cle), cle).toContain("{nom}");
      expect(en(cle), cle).toContain("{nom}");
    }
  });
});
