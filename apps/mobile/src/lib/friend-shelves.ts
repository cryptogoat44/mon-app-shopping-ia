import type { FriendShelvesOpen, FriendVaultPiece, FriendWish, Profile, UserProfile } from "@monapp/shared-types";
import { getActiveLocale, t } from "../i18n";
import { sharedItemPrice } from "./collections";
import type { PieceImageSize } from "./piece-image";

// Étagères des amis (lot « étagères des amis », migration 0058) : la logique
// pure, sans écran (testée par tests/etageres-amis.test.ts).
// - Les deux réglages ne s'affichent que si le serveur en parle (sinon : rien).
// - Les onglets du profil d'un ami n'apparaissent que si le serveur annonce
//   au moins une étagère ouverte à ce visiteur ; sinon, l'écran reste celui
//   d'avant (« Publications » seules).
// - Les phrases « privé » de l'app changent seulement quand le réglage est
//   allumé ; éteint ou inconnu : la phrase d'avant, mot pour mot.

export type ProfileTab = "posts" | "wishes" | "vault";
export type ShelfKind = "wishes" | "vault";
export type ShelfItem = { kind: "wishes"; item: FriendWish } | { kind: "vault"; item: FriendVaultPiece };

/** Les réglages : seulement quand le serveur les renvoie (migration 0058). */
export function friendShelvesSettingShown(profile: Pick<Profile, "showWishesToFriends" | "showVaultToFriends"> | null | undefined): boolean {
  return typeof profile?.showWishesToFriends === "boolean" && typeof profile?.showVaultToFriends === "boolean";
}

/** Les onglets du profil d'un ami : « Publications », puis chaque étagère
 * ouverte (exactement `true`). Aucune étagère : un seul onglet, et l'écran
 * n'affiche pas de rangée d'onglets. */
export function profileTabs(shelves: FriendShelvesOpen | null | undefined): ProfileTab[] {
  const tabs: ProfileTab[] = ["posts"];
  if (shelves?.wishes === true) tabs.push("wishes");
  if (shelves?.vault === true) tabs.push("vault");
  return tabs;
}

/** L'onglet à montrer : celui choisi s'il est encore ouvert, sinon « Publications »
 * (une étagère refermée entre deux chargements disparaît aussitôt). */
export function currentTab(selected: ProfileTab, profile: Pick<UserProfile, "friendShelves"> | null | undefined): ProfileTab {
  return profileTabs(profile?.friendShelves).includes(selected) ? selected : "posts";
}

/** Mes Envies sont-elles montrées à mes amis ? Seulement un vrai oui. */
export function showsWishes(profile: Pick<Profile, "showWishesToFriends"> | null | undefined): boolean {
  return profile?.showWishesToFriends === true;
}

/** Mon Vault est-il montré à mes amis ? Seulement un vrai oui. */
export function showsVault(profile: Pick<Profile, "showVaultToFriends"> | null | undefined): boolean {
  return profile?.showVaultToFriends === true;
}

/** Allumer demande une confirmation ; éteindre, jamais. */
export function needsShelfConfirmation(next: boolean): boolean {
  return next;
}

// ---- Les phrases « privé », exactes dans les deux cas (langue active à l'appel) ----

/** Fiche d'une pièce du Vault. */
export function vaultItemNote(profile: Pick<Profile, "showVaultToFriends"> | null | undefined): string {
  return showsVault(profile) ? t.friendShelves.vaultItemNote : t.vaultItem.privateNote;
}

/** Ajout d'une pièce au Vault. */
export function vaultFormNote(profile: Pick<Profile, "showVaultToFriends"> | null | undefined): string {
  return showsVault(profile) ? t.friendShelves.vaultFormNote : t.vaultForm.privateNote;
}

/** Fiche d'une envie, sous « Partager ». */
export function wishShareHint(profile: Pick<Profile, "showWishesToFriends"> | null | undefined): string {
  return showsWishes(profile) ? t.friendShelves.wishShareHint : t.wishlistItem.shareHint;
}

/** Le libellé VoiceOver d'une case : nom, puis prix (envie) ou catégorie (pièce du Vault). */
export function shelfCellLabel(entry: ShelfItem): string {
  const detail =
    entry.kind === "wishes" ? sharedItemPrice(entry.item, getActiveLocale()) : (t.vaultLabels.categories[entry.item.category] ?? t.vaultLabels.categories.other);
  return detail ? `${entry.item.title}, ${detail}` : entry.item.title;
}

/** La taille d'image d'une case de la grille. Une pièce du Vault : « card »,
 * comme la grille du Vault de son propriétaire (lot Envies et images) — la
 * vignette de Google d'abord, puis l'image nette par-dessus quand le serveur
 * en donne une autre. Une envie : « small » — sa vignette est déjà la copie de
 * 480 px faite par Spotto, assez nette pour la case, sans télécharger en plus
 * la grande copie sur la 4G. */
export function shelfCellImageSize(kind: ShelfKind): PieceImageSize {
  return kind === "vault" ? "card" : "small";
}
