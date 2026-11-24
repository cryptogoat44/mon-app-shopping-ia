import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import {
  currentTab,
  friendShelvesSettingShown,
  needsShelfConfirmation,
  profileTabs,
  shelfCellLabel,
  showsVault,
  showsWishes,
  vaultFormNote,
  vaultItemNote,
  wishShareHint,
} from "../src/lib/friend-shelves";
import { collectionState, visibilityState } from "../src/lib/collections";
import { moderationNoticeLines, systemNotificationLines } from "../src/lib/moderation-labels";

// Étagères des amis (lot « étagères des amis », migration 0058) : la logique
// des écrans sans rendu (réglages cachés sans le serveur, onglets seulement
// annoncés, phrases « privé » exactes dans les deux cas), les sources des
// écrans (lecture seule, aucune requête sans annonce), les textes FR / EN et
// la politique de confidentialité.

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const all = (doc: typeof privacyPolicy) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");

afterEach(() => {
  setActiveLocale("fr");
});

describe("les réglages : seulement quand le serveur les a, éteints sauf vrai oui", () => {
  it("cachés sans la migration (champs absents), montrés avec", () => {
    expect(friendShelvesSettingShown(null)).toBe(false);
    expect(friendShelvesSettingShown({})).toBe(false);
    expect(friendShelvesSettingShown({ showWishesToFriends: false })).toBe(false);
    expect(friendShelvesSettingShown({ showWishesToFriends: false, showVaultToFriends: false })).toBe(true);
  });

  it("allumé seulement sur un vrai oui", () => {
    expect(showsWishes({ showWishesToFriends: true })).toBe(true);
    expect(showsWishes({ showWishesToFriends: false })).toBe(false);
    expect(showsWishes({})).toBe(false);
    expect(showsVault({ showVaultToFriends: true })).toBe(true);
    expect(showsVault(null)).toBe(false);
  });

  it("allumer demande une confirmation ; éteindre, jamais", () => {
    expect(needsShelfConfirmation(true)).toBe(true);
    expect(needsShelfConfirmation(false)).toBe(false);
  });

  it("l'écran des réglages : interrupteurs nommés, confirmation qui dit ce que voient les amis, caché sans le serveur", () => {
    const setting = source("components/friend-shelves-setting.tsx");
    expect(setting).toContain("if (!friendShelvesSettingShown(profile)) return null;");
    expect(setting).toContain("await updateFriendShelves({ [shelf]: next });");
    expect(setting).toMatch(/if \(needsShelfConfirmation\(next\)\) \{\s*setConfirming\(shelf\);/);
    expect(setting).toContain("accessibilityLabel={title}");
    expect(setting).toContain('accessibilityRole="alert"');
    expect(setting).toMatch(/minHeight: 44/);
    // Échec : l'interrupteur revient et un message le dit.
    expect(setting).toContain("setValue(previous);");
    expect(source("app/(app)/settings.tsx")).toContain("<FriendShelvesSetting />");
  });

  it("pendant la confirmation : l'interrupteur reste éteint, VoiceOver entend la confirmation", () => {
    const setting = source("components/friend-shelves-setting.tsx");
    // Refusé : montrer « allumé » avant le oui.
    expect(setting).not.toContain("value={value[shelf] || confirming === shelf}");
    // Permis : la valeur enregistrée, et l'annonce sur iOS.
    expect(setting).toContain("value={value[shelf]}");
    expect(setting).toContain('if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(`${confirmTitle} ${confirmBody}`);');
  });

  it("éteindre pendant la confirmation : comme « Annuler », ni requête ni message « de nouveau privées »", () => {
    const setting = source("components/friend-shelves-setting.tsx");
    const toggle = setting.slice(setting.indexOf("function toggle("), setting.indexOf("if (!friendShelvesSettingShown"));
    // Refusé : rien n'était montré, donc pas de save(false).
    expect(toggle).toMatch(/if \(!next && confirming === shelf && !value\[shelf\]\) \{\s*setConfirming\(null\);\s*return;\s*\}/);
    expect(toggle.indexOf("confirming === shelf && !value[shelf]")).toBeLessThan(toggle.indexOf("void save(shelf, false)"));
    // Permis : éteindre une étagère vraiment montrée enregistre toujours.
    expect(toggle).toContain("} else void save(shelf, false);");
  });
});

describe("le profil d'un ami : des onglets seulement si le serveur les annonce", () => {
  it("aucune annonce : « Publications » seule (l'écran d'avant)", () => {
    expect(profileTabs(undefined)).toEqual(["posts"]);
    expect(profileTabs(null)).toEqual(["posts"]);
    expect(profileTabs({ wishes: false, vault: false })).toEqual(["posts"]);
  });

  it("annoncées : les onglets ouverts, dans l'ordre Publications, Envies, Vault", () => {
    expect(profileTabs({ wishes: true, vault: false })).toEqual(["posts", "wishes"]);
    expect(profileTabs({ wishes: false, vault: true })).toEqual(["posts", "vault"]);
    expect(profileTabs({ wishes: true, vault: true })).toEqual(["posts", "wishes", "vault"]);
  });

  it("une étagère refermée entre deux chargements : retour à « Publications »", () => {
    expect(currentTab("vault", { friendShelves: { wishes: true, vault: true } })).toBe("vault");
    expect(currentTab("vault", { friendShelves: { wishes: true, vault: false } })).toBe("posts");
    expect(currentTab("wishes", {})).toBe("posts");
    expect(currentTab("wishes", null)).toBe("posts");
  });

  const profile = source("app/(app)/profil.tsx");
  const grid = source("components/friend-shelf-grid.tsx");

  it("les étagères ne sont lues que pour l'onglet ouvert (donc annoncé), jamais avant", () => {
    expect(profile).toContain("const tabs = profileTabs(state === \"ready\" ? profile?.friendShelves : null);");
    expect(profile).toContain('useFriendShelf(id ?? "", "wishes", Boolean(id) && activeTab === "wishes", refreshKey)');
    expect(profile).toContain('useFriendShelf(id ?? "", "vault", Boolean(id) && activeTab === "vault", refreshKey)');
    expect(profile).not.toMatch(/fetchUserWishlist|fetchUserVault/);
    expect(grid).toMatch(/if \(!active\) \{[\s\S]*?return;\s*\}\s*reload\(\);/);
    // Sans annonce, la rangée d'onglets n'existe pas : le titre d'avant.
    expect(profile).toContain("{tabs.length > 1 ? (");
    expect(profile).toContain("<Text style={styles.sectionTitle}>{t.userProfile.posts}</Text>");
  });

  it("onglets accessibles : rôle, état choisi, 44 points, mêmes noms que sur son propre profil", () => {
    expect(profile).toContain('accessibilityRole="tablist"');
    expect(profile).toContain('accessibilityRole="tab"');
    expect(profile).toContain("accessibilityState={{ selected: activeTab === name }}");
    expect(profile).toContain("tab: { minHeight: 44");
    expect(profile).toContain('tab === "wishes" ? t.wishlist.title : tab === "vault" ? t.profile.vault : t.userProfile.posts');
  });

  it("lecture seule : ni « Garder », ni cloche, ni « Envoyer », ni « En parler » ; « Voir chez … » seulement", () => {
    for (const forbidden of ["keepSharedItem", "WishAlert", "envoyer-envie", "sendPiece", "/conversation", "t.collections.keep", "addWishlistItem", "Bell"]) {
      expect(grid, forbidden).not.toContain(forbidden);
    }
    expect(grid).toContain("<MerchantLinkButton");
    expect(grid).toContain("matchId={null}");
  });

  it("chaque état d'une étagère : chargement, erreur (hors ligne compris) avec « Réessayer », vide, suite en erreur", () => {
    expect(grid).toContain("setError(loadErrorMessage(e, t.friendShelves.loadError));");
    expect(grid).toContain("setMoreError(loadErrorMessage(e, t.friendShelves.loadMoreError));");
    expect(profile).toContain("<Pressable onPress={shelf.reload} style={styles.retry} accessibilityRole=\"button\">");
    expect(profile).toContain('activeTab === "wishes" ? t.friendShelves.emptyWishes : t.friendShelves.emptyVault');
    expect(profile).toContain("t.userProfile.noPostsNamed(profile.displayName)");
  });

  it("la suite en erreur : « Réessayer » relance ; la fin de liste seule ne relance pas", () => {
    // Permis : le bouton, 44 points, rôle bouton.
    expect(profile).toContain("<Pressable onPress={shelf.retryMore} style={styles.retry} accessibilityRole=\"button\">");
    expect(profile).toContain("retry: { marginTop: space.md, minHeight: 44");
    // Refusé : onEndReached (loadMore) ne relance pas après une erreur.
    expect(grid).toContain("if (moreError !== null && !retry) return;");
    expect(grid).toContain("const loadMore = useCallback(() => fetchMore(false), [fetchMore]);");
    expect(grid).toContain("const retryMore = useCallback(() => fetchMore(true), [fetchMore]);");
  });

  it("chaque case est nommée pour VoiceOver (nom, puis prix ou catégorie)", () => {
    expect(grid).toContain("accessibilityLabel={shelfCellLabel(entry)}");
    const wish = { id: "w", title: "Sac", imageUrl: null, imageThumbUrl: null, merchantName: null, merchantUrl: null, isAffiliate: false, priceMin: null, currency: null };
    expect(shelfCellLabel({ kind: "wishes", item: wish })).toBe("Sac");
    expect(shelfCellLabel({ kind: "wishes", item: { ...wish, priceMin: 129, currency: "EUR" } })).toMatch(/^Sac, 129/);
    expect(shelfCellLabel({ kind: "vault", item: { id: "v", title: "Veste", category: "clothing", imageUrl: null, imageHdUrl: null } })).toBe("Veste, Vêtements");
    setActiveLocale("en");
    expect(shelfCellLabel({ kind: "vault", item: { id: "v", title: "Veste", category: "clothing", imageUrl: null, imageHdUrl: null } })).toBe(`Veste, ${en.vaultLabels.categories.clothing}`);
  });
});

describe("les phrases « privé » : exactes dans les deux cas", () => {
  it("éteint (ou inconnu) : la phrase d'avant, mot pour mot", () => {
    for (const profile of [null, {}, { showWishesToFriends: false, showVaultToFriends: false }]) {
      expect(vaultItemNote(profile)).toBe(fr.vaultItem.privateNote);
      expect(vaultFormNote(profile)).toBe(fr.vaultForm.privateNote);
      expect(wishShareHint(profile)).toBe(fr.wishlistItem.shareHint);
    }
  });

  it("allumé : la phrase dit que les amis voient", () => {
    const on = { showWishesToFriends: true, showVaultToFriends: true };
    expect(vaultItemNote(on)).toBe(fr.friendShelves.vaultItemNote);
    expect(vaultFormNote(on)).toBe(fr.friendShelves.vaultFormNote);
    expect(wishShareHint(on)).toBe(fr.friendShelves.wishShareHint);
    for (const text of [vaultItemNote(on), vaultFormNote(on), wishShareHint(on)]) expect(text).toMatch(/amis/);
    setActiveLocale("en");
    expect(vaultItemNote(on)).toBe(en.friendShelves.vaultItemNote);
    expect(wishShareHint({})).toBe(en.wishlistItem.shareHint);
  });

  it("collection privée : « vous seul la voyez » seulement si les Envies ne sont pas montrées", () => {
    // Éteint : la phrase d'avant.
    expect(visibilityState("private")).toBe(fr.collections.privateState);
    expect(visibilityState("private", false)).toBe("Privée : vous seul la voyez.");
    // Allumé : refusé « vous seul » ; les amis voient ses envies, pas son nom.
    expect(visibilityState("private", true)).not.toContain("vous seul");
    expect(visibilityState("private", true)).toBe("Nom privé : vos amis voient ses envies (réglage « Montrer mes Envies à mes amis »), pas son nom.");
    expect(collectionState({ visibility: "private" }, true)).toBe(fr.collections.privateStateFriendsSeeWishes);
    expect(visibilityState("friends", true)).toBe(fr.collections.friendsState);
    setActiveLocale("en");
    expect(visibilityState("private", true)).toBe("Private name: your friends see its wishes (setting “Show my Wishlist to my friends”), not its name.");
    expect(visibilityState("private", false)).toBe(en.collections.privateState);
    expect(source("components/collection-options-sheet.tsx")).toContain("{collectionState(collection, showsWishes(profile))}");
    expect(source("components/collection-settings-sheet.tsx")).toContain("{collectionState(current, showsWishes(profile))}");
  });

  it("collection masquée par la modération : « vos amis ne la voient plus » seulement si les Envies ne sont pas montrées", () => {
    // Éteint : la phrase d'avant, privée ou « Mes amis ».
    expect(collectionState({ visibility: "private", hidden: true })).toBe(fr.collections.hiddenState);
    expect(collectionState({ visibility: "friends", hidden: true }, false)).toBe("Masquée par la modération : vos amis ne la voient plus.");
    // Allumé : refusé « ne la voient plus » ; ses envies restent visibles.
    expect(collectionState({ visibility: "private", hidden: true }, true)).not.toBe(fr.collections.hiddenState);
    expect(collectionState({ visibility: "friends", hidden: true }, true)).toBe(
      "Masquée par la modération : vos amis ne voient plus son nom ; ses envies restent visibles (réglage « Montrer mes Envies à mes amis »).",
    );
    expect(collectionState({ visibility: "private", hidden: true }, true)).toBe(fr.collections.hiddenStateFriendsSeeWishes);
    setActiveLocale("en");
    expect(collectionState({ visibility: "friends", hidden: true }, true)).toBe(
      "Hidden by moderation: your friends no longer see its name; its wishes stay visible (setting “Show my Wishlist to my friends”).",
    );
    expect(collectionState({ visibility: "friends", hidden: true }, false)).toBe(en.collections.hiddenState);
  });

  it("notification de collection masquée : « vos amis ne la voient plus » seulement si les Envies ne sont pas montrées", () => {
    const hide = { action: "hide" as const, targetType: "collection" as const, reason: null, note: null };
    const notification = { id: "n1", type: "moderation" as const, actor: null, createdAt: "2026-11-24T10:00:00.000Z", read: false, postId: null, moderation: hide, reportedType: null };
    // Éteint (ou non dit) : la phrase d'avant.
    expect(moderationNoticeLines(hide)).toEqual(["Une de vos collections a été masquée par la modération : vos amis ne la voient plus."]);
    expect(systemNotificationLines(notification, false)).toEqual([fr.notifications.moderationHiddenCollection]);
    // Allumé : refusé « ne la voient plus » ; ses envies restent visibles.
    expect(systemNotificationLines(notification, true)).not.toEqual([fr.notifications.moderationHiddenCollection]);
    expect(systemNotificationLines(notification, true)).toEqual([
      "Une de vos collections a été masquée par la modération : vos amis ne voient plus son nom ; ses envies restent visibles (réglage « Montrer mes Envies à mes amis »).",
    ]);
    // Le rétablissement ne change pas.
    expect(moderationNoticeLines({ ...hide, action: "restore" }, true)).toEqual([fr.notifications.moderationRestoredCollection]);
    setActiveLocale("en");
    expect(systemNotificationLines(notification, true)).toEqual([
      "One of your collections was hidden by moderation: your friends no longer see its name; its wishes stay visible (setting “Show my Wishlist to my friends”).",
    ]);
    expect(systemNotificationLines(notification, false)).toEqual(["One of your collections was hidden by moderation: your friends can no longer see it."]);
    // L'onglet Activité passe le réglage.
    expect(source("app/(app)/(tabs)/activite.tsx")).toContain("systemNotificationLines(notification, showsWishes(profile))");
  });

  it("chaque écran passe par ces phrases", () => {
    expect(source("app/(app)/vault-item/[id].tsx")).toContain("{vaultItemNote(profile)}");
    expect(source("app/(app)/vault-item/new.tsx")).toContain("{vaultFormNote(profile)}");
    expect(source("app/(app)/envie.tsx")).toContain("{wishShareHint(profile)}");
    expect(source("components/wishlist-panel.tsx")).toContain("showsWishes(profile) ? t.wishlist.privateNoteFriends");
  });
});

describe("textes FR / EN", () => {
  it("les deux catalogues ont les mêmes clés", () => {
    expect(Object.keys(en.friendShelves)).toEqual(Object.keys(fr.friendShelves));
    expect(Object.keys(en.userProfile)).toEqual(Object.keys(fr.userProfile));
    expect(Object.keys(en.wishlist)).toEqual(Object.keys(fr.wishlist));
  });

  it("vouvoiement, et les mots exacts des réglages", () => {
    const texts = Object.values(fr.friendShelves).map((value) => (typeof value === "function" ? (value as (...args: unknown[]) => string)("Sac", "Vêtements") : value));
    // Limites de mot qui connaissent les lettres accentuées (« êtes » n'est pas « tes »).
    for (const text of texts) expect(String(text)).not.toMatch(/(?<!\p{L})(tu|toi|ton|ta|tes|t')(?!\p{L})/iu);
    expect(fr.friendShelves.settingWishesTitle).toBe("Montrer mes Envies à mes amis");
    expect(fr.friendShelves.settingVaultTitle).toBe("Montrer mon Vault à mes amis");
    expect(en.friendShelves.settingWishesTitle).toBe("Show my Wishlist to my friends");
    expect(en.friendShelves.settingVaultTitle).toBe("Show my Vault to my friends");
    expect(fr.friendShelves.settingWishesHelp).toContain("Éteint au départ");
    expect(fr.friendShelves.settingWishesHelp).toContain("sans le nom de ces collections");
    expect(fr.friendShelves.settingVaultHelp).toContain("y compris les photos que vous avez prises vous-même");
    expect(fr.userProfile.noPostsNamed("Jade")).toBe("Jade n'a encore rien publié.");
    expect(en.userProfile.noPostsNamed("Jade")).toBe("Jade hasn't posted anything yet.");
  });

  it("jamais « authentique », « promotion » ni « prix de référence »", () => {
    for (const catalog of [fr.friendShelves, en.friendShelves]) {
      const text = JSON.stringify(catalog).toLowerCase();
      for (const word of ["authentique", "authentic", "promotion", "prix de référence", "reference price"]) expect(text).not.toContain(word);
    }
  });
});

describe("politique de confidentialité : plus de promesse absolue fausse", () => {
  it("le Vault n'est plus « visible par vous seul » sans réserve, en FR et en EN", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    expect(frText).not.toContain("Votre Vault n'est visible que par vous. ");
    expect(frText).not.toContain("Votre Vault : vous seul. ");
    expect(enText).not.toContain("Your Vault is visible to you alone. ");
    expect(enText).not.toContain("Your Vault: you alone. ");
    expect(frText).toContain("Votre Vault n'est visible que par vous, sauf si vous choisissez de le montrer à vos amis.");
    expect(enText).toContain("Your Vault is visible to you alone, unless you choose to show it to your friends.");
  });

  it("un paragraphe dit qui sont les amis, ce qu'ils voient, ce qu'ils ne voient jamais, et l'export", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    for (const words of [
      "« Montrer mes Envies à mes amis » et « Montrer mon Vault à mes amis », éteints au départ",
      "les membres que vous suivez et qui vous suivent",
      "jamais vos notes, vos alertes et leurs seuils",
      "Jamais la date d'ajout, la mention « Achat vérifié »",
      "ne garde aucune trace de qui a regardé",
      "Ces deux réglages figurent dans l'export de vos données.",
      "Vos alertes, elles, restent visibles par vous seul",
    ]) {
      expect(frText, words).toContain(words);
    }
    for (const words of [
      "“Show my Wishlist to my friends” and “Show my Vault to my friends”, off at first",
      "the members you follow who follow you back",
      "never your notes, your alerts and their thresholds",
      "keeps no record of who looked",
      "Both settings are included in your data export.",
    ]) {
      expect(enText, words).toContain(words);
    }
  });
});
