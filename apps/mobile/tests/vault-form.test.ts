// Lot 2 (Vault) : ajout d'une pièce à la main et « Modifier » le titre et la
// catégorie. Les règles du serveur (routes/vault.ts) sont vérifiées avant
// l'envoi, les erreurs suivent celles du reste de l'app.
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { ApiError } from "../src/lib/api-error";
import { sanitizeProps } from "../src/lib/analytics-events";
import { VAULT_CATEGORIES } from "../src/lib/vault-labels";
import { onVaultChanged, vaultChanged } from "../src/lib/vault-changes";
import {
  VAULT_TITLE_MAX_LENGTH,
  checkNewVaultItem,
  checkVaultEdit,
  isVaultCategory,
  vaultCategoryChoices,
  vaultFormIssueMessage,
  vaultSaveErrorMessage,
  type VaultFormIssue,
} from "../src/lib/vault-form";

afterEach(() => setActiveLocale("fr"));

const PHOTO = "file:///cache/ImageManipulator/photo.jpg";
const MAX_TITLE = "a".repeat(VAULT_TITLE_MAX_LENGTH);
const TOO_LONG_TITLE = "a".repeat(VAULT_TITLE_MAX_LENGTH + 1);

describe("ajout d'une pièce à la main : vérification avant l'envoi", () => {
  it("formulaire complet : titre sans espaces autour, photo et catégorie telles quelles", () => {
    expect(checkNewVaultItem({ imageUri: PHOTO, title: "  Veste en daim camel  ", category: "clothing" })).toEqual({
      ok: true,
      value: { imageUri: PHOTO, title: "Veste en daim camel", category: "clothing" },
    });
  });

  it("le premier problème dans l'ordre de l'écran : photo, puis titre, puis catégorie", () => {
    expect(checkNewVaultItem({ imageUri: null, title: "", category: null })).toEqual({ ok: false, issue: "photo_missing" });
    expect(checkNewVaultItem({ imageUri: "", title: "Montre", category: "watches" })).toEqual({ ok: false, issue: "photo_missing" });
    expect(checkNewVaultItem({ imageUri: PHOTO, title: "   ", category: null })).toEqual({ ok: false, issue: "title_missing" });
    expect(checkNewVaultItem({ imageUri: PHOTO, title: "Montre", category: null })).toEqual({ ok: false, issue: "category_missing" });
  });

  it("120 caractères au plus, comptés après le retrait des espaces autour (comme le serveur)", () => {
    const atMax = checkNewVaultItem({ imageUri: PHOTO, title: `  ${MAX_TITLE}  `, category: "bags" });
    expect(atMax).toEqual({ ok: true, value: { imageUri: PHOTO, title: MAX_TITLE, category: "bags" } });
    expect(checkNewVaultItem({ imageUri: PHOTO, title: TOO_LONG_TITLE, category: "bags" })).toEqual({ ok: false, issue: "title_too_long" });
  });

  it("une catégorie inconnue du serveur est refusée", () => {
    expect(isVaultCategory("jewelry")).toBe(false);
    expect(isVaultCategory(undefined)).toBe(false);
    for (const category of VAULT_CATEGORIES) expect(isVaultCategory(category)).toBe(true);
    const draft = { imageUri: PHOTO, title: "Bague", category: "jewelry" } as unknown as Parameters<typeof checkNewVaultItem>[0];
    expect(checkNewVaultItem(draft)).toEqual({ ok: false, issue: "category_missing" });
  });
});

describe("« Modifier » : seulement ce qui change", () => {
  const current = { title: "Veste en daim", category: "clothing" as const };

  it("rien de changé (espaces autour compris) : aucun envoi, le serveur refuserait une modification vide", () => {
    expect(checkVaultEdit(current, { title: "  Veste en daim ", category: "clothing" })).toEqual({ ok: true, value: null });
  });

  it("le titre seul, sans espaces autour", () => {
    expect(checkVaultEdit(current, { title: " Veste en daim camel ", category: "clothing" })).toEqual({
      ok: true,
      value: { title: "Veste en daim camel" },
    });
  });

  it("la catégorie seule", () => {
    expect(checkVaultEdit(current, { title: "Veste en daim", category: "accessories" })).toEqual({ ok: true, value: { category: "accessories" } });
  });

  it("les deux à la fois", () => {
    expect(checkVaultEdit(current, { title: "Blouson", category: "other" })).toEqual({ ok: true, value: { title: "Blouson", category: "other" } });
  });

  it("titre vidé, titre trop long ou catégorie absente : refusés avant l'envoi", () => {
    expect(checkVaultEdit(current, { title: "   ", category: "clothing" })).toEqual({ ok: false, issue: "title_missing" });
    expect(checkVaultEdit(current, { title: TOO_LONG_TITLE, category: "clothing" })).toEqual({ ok: false, issue: "title_too_long" });
    expect(checkVaultEdit(current, { title: MAX_TITLE, category: "clothing" })).toEqual({ ok: true, value: { title: MAX_TITLE } });
    expect(checkVaultEdit(current, { title: "Veste en daim", category: null })).toEqual({ ok: false, issue: "category_missing" });
  });
});

describe("textes du formulaire, dans la langue active", () => {
  const ISSUES: VaultFormIssue[] = ["photo_missing", "title_missing", "title_too_long", "category_missing"];

  it("un message pour chaque problème, en français puis en anglais sans relancer l'écran", () => {
    expect(ISSUES.map(vaultFormIssueMessage)).toEqual([
      "Ajoutez une photo de la pièce.",
      "Indiquez un titre.",
      "Le titre est trop long (120 caractères maximum).",
      "Choisissez une catégorie.",
    ]);
    setActiveLocale("en");
    expect(ISSUES.map(vaultFormIssueMessage)).toEqual([
      "Add a photo of the piece.",
      "Enter a title.",
      "The title is too long (120 characters maximum).",
      "Choose a category.",
    ]);
  });

  it("les sept catégories du serveur, dans son ordre, avec leur libellé du moment", () => {
    expect(vaultCategoryChoices()).toEqual([
      { value: "clothing", label: "Vêtements" },
      { value: "watches", label: "Montres" },
      { value: "accessories", label: "Accessoires" },
      { value: "shoes", label: "Chaussures" },
      { value: "bags", label: "Sacs" },
      { value: "home", label: "Maison" },
      { value: "other", label: "Autre" },
    ]);
    setActiveLocale("en");
    expect(vaultCategoryChoices().map((choice) => choice.label)).toEqual(["Clothing", "Watches", "Accessories", "Shoes", "Bags", "Home", "Other"]);
  });
});

describe("erreur d'un envoi (ajout ou modification)", () => {
  const FALLBACK = "Texte de repli de l'écran";

  it("sans réseau : « hors ligne », sur le site (TypeError) comme sur iPhone (erreur d'expo/fetch)", () => {
    const OFFLINE = "Vous semblez hors ligne. Vérifiez votre connexion internet, puis réessayez.";
    expect(vaultSaveErrorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(OFFLINE);
    expect(vaultSaveErrorMessage(new Error("fetch failed: The Internet connection appears to be offline."), FALLBACK)).toBe(OFFLINE);
    expect(vaultSaveErrorMessage(new Error("fetch failed: The network connection was lost."), t.vaultItem.updateError)).toBe(OFFLINE);
    setActiveLocale("en");
    expect(vaultSaveErrorMessage(new Error("fetch failed: The Internet connection appears to be offline."), FALLBACK)).toBe(
      "You seem to be offline. Check your internet connection, then try again."
    );
  });

  it("refus du serveur (400) : son message, déjà dans la langue de l'app", () => {
    const tooLong = new ApiError(400, { error: "invalid_body", message: "Le titre est trop long (120 caractères maximum)." });
    expect(vaultSaveErrorMessage(tooLong, FALLBACK)).toBe("Le titre est trop long (120 caractères maximum).");
    const notAnImage = new ApiError(400, { error: "invalid_file", message: "The file must be an image." });
    expect(vaultSaveErrorMessage(notAnImage, FALLBACK)).toBe("The file must be an image.");
  });

  it("photo trop lourde (413) : un texte de l'app, même quand la réponse ne vient pas de notre serveur", () => {
    const fromServer = new ApiError(413, { error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
    const fromProxy = new ApiError(413, { error: "unknown", message: t.common.unknownServerError });
    expect(vaultSaveErrorMessage(fromServer, FALLBACK)).toBe("Cette photo est trop lourde (10 Mo maximum). Choisissez-en une autre.");
    expect(vaultSaveErrorMessage(fromProxy, FALLBACK)).toBe("Cette photo est trop lourde (10 Mo maximum). Choisissez-en une autre.");
    setActiveLocale("en");
    expect(vaultSaveErrorMessage(fromProxy, FALLBACK)).toBe("This photo is too large (10 MB maximum). Choose another one.");
  });

  it("panne, réponse illisible ou erreur inattendue : le texte de repli", () => {
    expect(vaultSaveErrorMessage(new ApiError(500, { error: "internal_error", message: "Une erreur est survenue." }), FALLBACK)).toBe(FALLBACK);
    expect(vaultSaveErrorMessage(new ApiError(502, { error: "unknown", message: t.common.unknownServerError }), FALLBACK)).toBe(FALLBACK);
    expect(vaultSaveErrorMessage(new ApiError(400, { error: "unknown", message: t.common.unknownServerError }), FALLBACK)).toBe(FALLBACK);
    expect(vaultSaveErrorMessage(new ApiError(400, { error: "invalid_body", message: "" }), FALLBACK)).toBe(FALLBACK);
    expect(vaultSaveErrorMessage(new Error("session absente"), FALLBACK)).toBe(FALLBACK);
  });
});

describe("pièce ajoutée ou modifiée : le profil est prévenu", () => {
  it("chaque écran abonné est prévenu à chaque envoi abouti, jusqu'à son désabonnement", () => {
    const calls: string[] = [];
    const stopProfile = onVaultChanged(() => calls.push("profil"));
    const stopOther = onVaultChanged(() => calls.push("autre"));
    vaultChanged();
    expect(calls).toEqual(["profil", "autre"]);
    stopProfile();
    vaultChanged();
    expect(calls).toEqual(["profil", "autre", "autre"]);
    stopOther();
    vaultChanged();
    expect(calls).toEqual(["profil", "autre", "autre"]);
  });
});

describe("statistiques : l'ajout à la main compte comme « photo », avec sa catégorie", () => {
  it("l'événement existant admet chaque catégorie, et rien d'autre (jamais le titre)", () => {
    for (const category of VAULT_CATEGORIES) {
      expect(sanitizeProps("vault_item_added", { source: "photo", category, title: "Veste en daim" })).toEqual({ source: "photo", category });
    }
  });
});
