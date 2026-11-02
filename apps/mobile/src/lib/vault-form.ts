// Lot 2 (Vault) : ajout d'une pièce à la main (photo, titre, catégorie) et
// « Modifier » le titre et la catégorie d'une pièce. Mêmes règles que le
// serveur (routes/vault.ts), vérifiées avant l'envoi : titre obligatoire,
// sans espaces autour, 120 caractères au plus ; catégorie parmi celles du
// Vault ; photo obligatoire pour un ajout. Textes lus dans la langue active
// au moment de l'appel. Imports relatifs : fichier testé par vitest.
import type { UpdateVaultItemRequest, VaultCategory } from "@monapp/shared-types";
import { t } from "../i18n";
import { ApiError } from "./api-error";
import { isNetworkError } from "./network-error";
import { VAULT_CATEGORIES } from "./vault-labels";

/** Longueur maximale d'un titre, comme le serveur (après retrait des espaces autour). */
export const VAULT_TITLE_MAX_LENGTH = 120;

/** Premier problème d'un formulaire, dans l'ordre de l'écran. */
export type VaultFormIssue = "photo_missing" | "title_missing" | "title_too_long" | "category_missing";

export type VaultFormCheck<T> = { ok: true; value: T } | { ok: false; issue: VaultFormIssue };

export interface NewVaultItemFields {
  imageUri: string;
  title: string;
  category: VaultCategory;
}

export function isVaultCategory(value: unknown): value is VaultCategory {
  return typeof value === "string" && (VAULT_CATEGORIES as readonly string[]).includes(value);
}

function checkTitle(raw: string): VaultFormCheck<string> {
  const title = raw.trim();
  if (title.length === 0) return { ok: false, issue: "title_missing" };
  if (title.length > VAULT_TITLE_MAX_LENGTH) return { ok: false, issue: "title_too_long" };
  return { ok: true, value: title };
}

/** Ajout à la main : les champs prêts pour l'envoi (titre sans espaces
 * autour), ou le premier problème. */
export function checkNewVaultItem(draft: {
  imageUri: string | null;
  title: string;
  category: VaultCategory | null;
}): VaultFormCheck<NewVaultItemFields> {
  if (!draft.imageUri) return { ok: false, issue: "photo_missing" };
  const title = checkTitle(draft.title);
  if (!title.ok) return title;
  if (!isVaultCategory(draft.category)) return { ok: false, issue: "category_missing" };
  return { ok: true, value: { imageUri: draft.imageUri, title: title.value, category: draft.category } };
}

/** « Modifier » : seulement ce qui change (PATCH /api/vault/:id). `null`
 * quand rien ne change — le serveur refuse une modification vide (400). Un
 * titre resté tel quel n'est pas revérifié. */
export function checkVaultEdit(
  current: { title: string; category: VaultCategory },
  draft: { title: string; category: VaultCategory | null }
): VaultFormCheck<UpdateVaultItemRequest | null> {
  const changes: UpdateVaultItemRequest = {};
  if (draft.title.trim() !== current.title) {
    const title = checkTitle(draft.title);
    if (!title.ok) return title;
    changes.title = title.value;
  }
  if (!isVaultCategory(draft.category)) return { ok: false, issue: "category_missing" };
  if (draft.category !== current.category) changes.category = draft.category;
  return { ok: true, value: changes.title === undefined && changes.category === undefined ? null : changes };
}

export function vaultFormIssueMessage(issue: VaultFormIssue): string {
  switch (issue) {
    case "photo_missing":
      return t.vaultForm.photoRequired;
    case "title_missing":
      return t.vaultForm.titleRequired;
    case "title_too_long":
      return t.vaultForm.titleTooLong(VAULT_TITLE_MAX_LENGTH);
    case "category_missing":
      return t.vaultForm.categoryRequired;
  }
}

/** Les catégories, dans l'ordre du serveur, avec leur libellé du moment. */
export function vaultCategoryChoices(): { value: VaultCategory; label: string }[] {
  return VAULT_CATEGORIES.map((category) => ({ value: category, label: t.vaultLabels.categories[category] }));
}

/** Erreur d'un envoi (ajout ou modification), selon les règles du reste de
 * l'app (lib/load-error.ts) : sans réseau, « hors ligne », sur le site comme
 * sur iPhone (lib/network-error.ts) ; photo trop lourde (413), un texte de
 * l'app, même quand la réponse ne vient pas de notre serveur ; refus de notre
 * serveur (400…), son message, déjà dans la langue de l'app ; panne ou
 * réponse illisible, le texte de repli de l'écran. */
export function vaultSaveErrorMessage(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return t.common.offline;
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 413) return t.vaultForm.photoTooLarge;
  if (error.status >= 500 || error.body.error === "unknown") return fallback;
  return error.message || fallback;
}
