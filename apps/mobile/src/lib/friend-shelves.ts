import type { FriendShelvesOpen, FriendVaultPiece, FriendWish, Profile, UserProfile } from "@monapp/shared-types";
import { getActiveLocale, t } from "../i18n";
import { sharedItemPrice } from "./collections";
import { formatLongDate, formatPrice } from "./format";
import type { PieceImageSize } from "./piece-image";
import type { Locale } from "./preferences";

// Étagères des amis (lot « étagères des amis », migration 0058) : la logique
// pure, sans écran (testée par tests/etageres-amis.test.ts).
// - Les deux réglages ne s'affichent que si le serveur en parle (sinon : rien).
// - Les onglets du profil d'un ami n'apparaissent que si le serveur annonce
//   au moins une étagère ouverte à ce visiteur ; sinon, l'écran reste celui
//   d'avant (« Publications » seules).
// - Refonte (décisions du fondateur) : les deux réglages sont allumés par
//   défaut, mais rien n'est montré aux amis avant que le membre ait vu
//   l'information « Ce que vos amis peuvent voir » (`friendShelvesInformed`).
// - Les phrases « privé » de l'app disent « vos amis voient » seulement quand
//   c'est vrai maintenant (réglage allumé ET information vue) ; sinon, la
//   phrase d'avant, mot pour mot (ou, réglage éteint, la phrase qui le dit).

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

type ShelvesProfile = Pick<Profile, "showWishesToFriends" | "showVaultToFriends" | "friendShelvesInformed">;

/** Le membre a-t-il vu l'information ? Seulement un vrai oui du serveur. */
export function friendShelvesInformed(profile: Pick<Profile, "friendShelvesInformed"> | null | undefined): boolean {
  return profile?.friendShelvesInformed === true;
}

/** Mes Envies sont-elles montrées à mes amis MAINTENANT (réglage allumé et information vue) ? */
export function wishesShownNow(profile: Pick<Profile, "showWishesToFriends" | "friendShelvesInformed"> | null | undefined): boolean {
  return showsWishes(profile) && friendShelvesInformed(profile);
}

/** Mon Vault est-il montré à mes amis MAINTENANT (réglage allumé et information vue) ? */
export function vaultShownNow(profile: Pick<Profile, "showVaultToFriends" | "friendShelvesInformed"> | null | undefined): boolean {
  return showsVault(profile) && friendShelvesInformed(profile);
}

/** L'information « Ce que vos amis peuvent voir » : seulement si le serveur
 * connaît la fonction (réglages et `friendShelvesInformed` renvoyés), que le
 * membre ne l'a pas encore vue (un vrai « non »), et qu'au moins un réglage
 * est allumé (sinon, rien ne serait montré : rien à annoncer). */
export function needsFriendShelvesNotice(profile: ShelvesProfile | null | undefined): boolean {
  return friendShelvesSettingShown(profile) && profile?.friendShelvesInformed === false && (showsWishes(profile) || showsVault(profile));
}

/** L'annonce VoiceOver de l'information : une fois par apparition et par
 * membre, et non à chaque montage de la carte (le profil la remonte à chaque
 * onglet et à la fin du chargement ; Réglages en monte une deuxième
 * par-dessus). `announcedFor` : l'id du membre à qui elle a déjà été lue.
 * Cachée, elle pourra être annoncée de nouveau quand elle réapparaît ; un
 * autre membre connecté ensuite sur le même téléphone l'entend aussi (à la
 * déconnexion, les cartes disparaissent sans passer par « cachée »). */
export function noticeAnnouncement(announcedFor: string | null, shown: boolean, memberId: string | null): { announce: boolean; announcedFor: string | null } {
  if (!shown || memberId === null) return { announce: false, announcedFor: null };
  return { announce: announcedFor !== memberId, announcedFor: memberId };
}

/** Ce que la réponse change aussitôt dans le profil affiché, comme sur le
 * serveur : l'information est vue ; « Éteindre » éteint aussi les deux
 * réglages. Appliqué dès que le serveur l'a acceptée, pour que la carte se
 * cache et que les phrases « privé » restent vraies même si le rechargement
 * du profil qui suit échoue. */
export function noticeAnswerProfilePatch(choice: "ok" | "off"): Pick<Profile, "friendShelvesInformed"> & Partial<Pick<Profile, "showWishesToFriends" | "showVaultToFriends">> {
  return choice === "ok" ? { friendShelvesInformed: true } : { friendShelvesInformed: true, showWishesToFriends: false, showVaultToFriends: false };
}

/** Les lignes de l'information, selon les réglages allumés (langue active à l'appel). */
export function friendShelvesNoticeLines(profile: ShelvesProfile | null | undefined): string[] {
  return [
    t.friendShelves.noticeIntro,
    ...(showsWishes(profile) ? [t.friendShelves.noticeWishes] : []),
    ...(showsVault(profile) ? [t.friendShelves.noticeVault] : []),
    t.friendShelves.noticeOutro,
  ];
}

/** Ce que la réponse à l'information envoie au serveur : « Compris » note
 * seulement la date ; « Éteindre » éteint les deux réglages et note la date. */
export function noticeAnswer(choice: "ok" | "off"): { informed: true; wishes?: false; vault?: false } {
  return choice === "ok" ? { informed: true } : { wishes: false, vault: false, informed: true };
}

/** Le message court après un réglage changé dans Réglages (langue active à l'appel). */
export function shelfToast(shelf: ShelfKind, next: boolean, informed: boolean, collectionsEnabled: boolean): string {
  if (shelf === "wishes") {
    if (next) return informed ? t.friendShelves.wishesShown : t.friendShelves.wishesOnPending;
    return collectionsEnabled ? t.friendShelves.wishesPrivateAgainCollections : t.friendShelves.wishesPrivateAgain;
  }
  if (next) return informed ? t.friendShelves.vaultShown : t.friendShelves.vaultOnPending;
  return t.friendShelves.vaultPrivateAgain;
}

// ---- Les phrases « privé », exactes dans chaque état (langue active à l'appel) ----

/** Fiche d'une pièce du Vault. */
export function vaultItemNote(profile: Pick<Profile, "showVaultToFriends" | "friendShelvesInformed"> | null | undefined): string {
  return vaultShownNow(profile) ? t.friendShelves.vaultItemNote : t.vaultItem.privateNote;
}

/** Ajout d'une pièce au Vault. */
export function vaultFormNote(profile: Pick<Profile, "showVaultToFriends" | "friendShelvesInformed"> | null | undefined): string {
  return vaultShownNow(profile) ? t.friendShelves.vaultFormNote : t.vaultForm.privateNote;
}

/** Fiche d'une envie, sous « Partager ». */
export function wishShareHint(profile: Pick<Profile, "showWishesToFriends" | "friendShelvesInformed"> | null | undefined): string {
  return wishesShownNow(profile) ? t.friendShelves.wishShareHint : t.wishlistItem.shareHint;
}

/** La feuille « Qui voit vos Envies », trois états : montrées à vos amis
 * (réglage allumé et information vue) ; réglage éteint ; fonction absente (ou
 * information pas encore vue : rien n'est montré, la phrase d'avant est vraie). */
export function wishlistPrivacyNote(profile: ShelvesProfile | null | undefined, collectionsEnabled: boolean): string {
  if (wishesShownNow(profile)) return t.wishlist.privateNoteFriends;
  if (friendShelvesSettingShown(profile) && !showsWishes(profile)) return t.wishlist.privateNoteOff;
  return collectionsEnabled ? t.wishlist.privateNoteCollections : t.wishlist.privateNote;
}

/** Ce qu'un ami voit en plus sur la petite feuille d'une pièce, en lecture
 * seule : l'alerte de prix et les collections « Mes amis » d'une envie ; la
 * date d'ajout et « Achat vérifié » d'une pièce du Vault. Rien si le serveur
 * (plus ancien) ne l'envoie pas. */
export function friendShelfDetails(entry: ShelfItem, locale: Locale): string[] {
  const lines: string[] = [];
  if (entry.kind === "wishes") {
    const alert = entry.item.priceAlert;
    if (alert) {
      lines.push(
        alert.targetPrice !== null && alert.targetCurrency !== null
          ? t.friendShelves.priceAlertBelow(formatPrice(alert.targetPrice, alert.targetCurrency, locale))
          : t.friendShelves.priceAlertOn
      );
    }
    const names = (entry.item.collections ?? []).filter((name) => name.trim().length > 0);
    if (names.length > 0) lines.push(t.friendShelves.inCollections(names.join(", ")));
  } else {
    if (entry.item.createdAt) lines.push(t.friendShelves.addedOn(formatLongDate(entry.item.createdAt, locale)));
    if (entry.item.verified === true) lines.push(t.profile.verified);
  }
  return lines;
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
