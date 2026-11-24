import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { APP_NAME_DISPLAY as BRAND } from "../src/constants/brand";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import {
  currentTab,
  friendShelvesSettingShown,
  needsShelfConfirmation,
  profileTabs,
  shelfCellImageSize,
  shelfCellLabel,
  showsVault,
  showsWishes,
  vaultFormNote,
  vaultItemNote,
  wishShareHint,
} from "../src/lib/friend-shelves";
import { collectionState, visibilityState } from "../src/lib/collections";
import { twoStepSources } from "../src/lib/piece-image";
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
    expect(visibilityState("private", true)).toBe("Nom privé : vos amis peuvent voir ses envies (réglage « Montrer mes Envies à mes amis »), pas son nom.");
    // Refusé : l'exception de la modération dans cette phrase (fausse si l'envie
    // est aussi dans une autre collection « Mes amis » : la politique la dit).
    expect(visibilityState("private", true)).not.toContain("masquée par la modération");
    expect(visibilityState("private", true)).not.toContain("sauf");
    expect(collectionState({ visibility: "private" }, true)).toBe(fr.collections.privateStateFriendsSeeWishes);
    expect(visibilityState("friends", true)).toBe(fr.collections.friendsState);
    setActiveLocale("en");
    expect(visibilityState("private", true)).toBe("Private name: your friends can see its wishes (setting “Show my Wishlist to my friends”), not its name.");
    expect(visibilityState("private", true)).not.toContain("hidden by moderation");
    expect(visibilityState("private", true)).not.toContain("except");
    expect(visibilityState("private", false)).toBe(en.collections.privateState);
    expect(source("components/collection-options-sheet.tsx")).toContain("{collectionState(collection, showsWishes(profile))}");
    expect(source("components/collection-settings-sheet.tsx")).toContain("{collectionState(current, showsWishes(profile))}");
  });

  it("collection masquée par la modération : « vos amis ne la voient plus » dans tous les cas, réglage Envies allumé compris", () => {
    // Permis : la phrase d'origine, privée ou « Mes amis », réglage éteint, inconnu ou allumé.
    for (const visibility of ["private", "friends"] as const) {
      for (const on of [undefined, false, true]) {
        expect(collectionState({ visibility, hidden: true }, on), `${visibility} ${String(on)}`).toBe("Masquée par la modération : vos amis ne la voient plus.");
      }
    }
    // Refusé : aucune phrase qui dirait que ses envies restent visibles (la variante est retirée).
    expect("hiddenStateFriendsSeeWishes" in fr.collections).toBe(false);
    expect("hiddenStateFriendsSeeWishes" in en.collections).toBe(false);
    expect(source("lib/collections.ts")).not.toContain("hiddenStateFriendsSeeWishes");
    // Une collection non masquée garde sa phrase propre au réglage.
    expect(collectionState({ visibility: "private", hidden: false }, true)).toBe(fr.collections.privateStateFriendsSeeWishes);
    setActiveLocale("en");
    expect(collectionState({ visibility: "friends", hidden: true }, true)).toBe("Hidden by moderation: your friends can no longer see it.");
    expect(collectionState({ visibility: "private", hidden: true }, false)).toBe(en.collections.hiddenState);
  });

  it("notification de collection masquée : la phrase d'origine pour tous, sans le réglage", () => {
    const hide = { action: "hide" as const, targetType: "collection" as const, reason: null, note: null };
    const notification = { id: "n1", type: "moderation" as const, actor: null, createdAt: "2026-11-24T10:00:00.000Z", read: false, postId: null, moderation: hide, reportedType: null };
    // Permis : la phrase d'origine, mot pour mot.
    expect(moderationNoticeLines(hide)).toEqual(["Une de vos collections a été masquée par la modération : vos amis ne la voient plus."]);
    expect(systemNotificationLines(notification)).toEqual([fr.notifications.moderationHiddenCollection]);
    expect(moderationNoticeLines({ ...hide, action: "restore" })).toEqual([fr.notifications.moderationRestoredCollection]);
    setActiveLocale("en");
    expect(systemNotificationLines(notification)).toEqual(["One of your collections was hidden by moderation: your friends can no longer see it."]);
    // Refusé : plus de variante ni de réglage passé par l'onglet Activité.
    expect("moderationHiddenCollectionFriendsSeeWishes" in fr.notifications).toBe(false);
    expect("moderationHiddenCollectionFriendsSeeWishes" in en.notifications).toBe(false);
    expect(source("lib/moderation-labels.ts")).not.toContain("showsWishesToFriends");
    expect(source("app/(app)/(tabs)/activite.tsx")).toContain("systemNotificationLines(notification)");
    expect(source("app/(app)/(tabs)/activite.tsx")).not.toContain("showsWishes(profile)");
  });

  it("ces phrases sont vraies parce que le serveur retire ce que la modération masque (et ce qui est « Privée ») des étagères des amis", () => {
    const users = readFileSync(join(__dirname, "../../backend/src/routes/users.ts"), "utf8");
    const collections = readFileSync(join(__dirname, "../../backend/src/lib/collections.ts"), "utf8");
    // Envies d'une collection privée ou masquée : retirées de la liste avant la page ; Vault : pièce d'une publication masquée.
    expect(users).toContain("readShelfCollections(fastify, ownerId)");
    expect(users).toContain(".filter((id) => !shelfCollections.offShelf.has(id))");
    expect(collections).toContain('const shown = collection.visibility === "friends" && collection.hidden_at === null;');
    expect(users).toContain("vaultPiecesInHiddenPosts(fastify, ownerId)");
    expect(users).toContain('vaultQuery.not("id", "in", hiddenPieces)');
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

describe("qui voit vos Envies et votre Vault : des phrases courtes qui préviennent, la politique qui dit l'exception une fois", () => {
  // Règle : une phrase de l'app qui PRÉVIENT ne sous-estime jamais qui voit et
  // ne dit ni « toutes » ni « chaque » ; elle ne liste pas les exceptions de la
  // modération (elles ne font que retirer des choses de ce que voient les amis).
  // La politique les dit une fois, exactement : le serveur (routes/users.ts)
  // retire de l'étagère une envie rangée dans une collection masquée
  // (wishesInHiddenCollections) et une pièce dont la publication « achat »
  // (posts.vault_item_id) est masquée (vaultPiecesInHiddenPosts).
  const inApp = () => [
    fr.friendShelves.settingWishesHelp,
    fr.friendShelves.settingVaultHelp,
    fr.friendShelves.confirmWishesBody,
    fr.friendShelves.confirmVaultBody,
    fr.wishlist.privateNoteFriends,
    fr.collections.privateStateFriendsSeeWishes,
  ];
  const inAppEn = () => [
    en.friendShelves.settingWishesHelp,
    en.friendShelves.settingVaultHelp,
    en.friendShelves.confirmWishesBody,
    en.friendShelves.confirmVaultBody,
    en.wishlist.privateNoteFriends,
    en.collections.privateStateFriendsSeeWishes,
  ];

  it("permis : les phrases de l'app, mot pour mot, avec leurs avertissements gardés", () => {
    expect(fr.friendShelves.settingWishesHelp).toBe(
      `Éteint au départ. Allumé, vos amis (les membres que vous suivez et qui vous suivent) voient vos Envies, y compris celles rangées dans vos collections privées, sans le nom de ces collections : titre, image (une copie faite par ${BRAND}), prix et lien vers la boutique. Jamais vos notes, vos alertes, les pièces reçues ni vos publications enregistrées.`
    );
    expect(fr.friendShelves.settingVaultHelp).toBe(
      "Éteint au départ. Allumé, vos amis voient les pièces de votre Vault : nom, catégorie et photo, y compris les photos que vous avez prises vous-même. Jamais la date d'ajout ni la mention « Achat vérifié »."
    );
    expect(fr.friendShelves.confirmWishesBody).toBe("Vos amis verront vos Envies, même celles de vos collections privées. Personne d'autre. Vous pourrez éteindre ce réglage à tout moment.");
    expect(fr.friendShelves.confirmVaultBody).toBe(
      "Vos amis verront les pièces de votre Vault, avec leurs photos, y compris celles que vous avez prises vous-même : vérifiez ce qu'elles montrent. Personne d'autre. Vous pourrez le rendre privé à tout moment."
    );
    expect(fr.wishlist.privateNoteFriends).toBe("Vos amis voient vos Envies (réglage « Montrer mes Envies à mes amis »). Vous pouvez l'éteindre dans Réglages.");
    expect(en.friendShelves.settingWishesHelp).toBe(
      `Off at first. When on, your friends (members you follow who follow you back) see your wishes, including those in your private collections, without the names of those collections: title, image (a copy made by ${BRAND}), price and the link to the shop. Never your notes, your alerts, the pieces you received or your saved posts.`
    );
    expect(en.friendShelves.settingVaultHelp).toBe(
      "Off at first. When on, your friends see the pieces in your Vault: name, category and photo, including photos you took yourself. Never the date you added them or the “Verified purchase” mark."
    );
    expect(en.friendShelves.confirmWishesBody).toBe("Your friends will see your wishes, even those in your private collections. No one else will. You can turn this setting off at any time.");
    expect(en.friendShelves.confirmVaultBody).toBe(
      "Your friends will see the pieces in your Vault, with their photos, including photos you took yourself: check what they show. No one else will. You can make it private again at any time."
    );
    expect(en.wishlist.privateNoteFriends).toBe("Your friends can see your wishes (setting “Show my Wishlist to my friends”). You can turn it off in Settings.");
  });

  it("refusé : ni « toutes » / « chaque », ni exception de la modération dans les phrases de l'app", () => {
    for (const text of inApp()) {
      expect(text).not.toMatch(/(?<!\p{L})(toutes|tous|chaque|toujours)(?!\p{L})/iu);
      expect(text).not.toContain("modération");
      expect(text).not.toContain("sauf");
    }
    for (const text of inAppEn()) {
      expect(text).not.toMatch(/\b(all|every|each|always)\b/i);
      expect(text).not.toContain("moderation");
      expect(text).not.toContain("except");
    }
  });

  it("refusé : « rendre privées » vos Envies dans Réglages (le réglage éteint, une Envie d'une collection « Mes amis » reste visible)", () => {
    expect(fr.wishlist.privateNoteFriends).not.toContain("rendre privées");
    expect(fr.friendShelves.confirmWishesBody).not.toContain("rendre privées");
    expect(en.wishlist.privateNoteFriends).not.toContain("make them private");
    expect(en.friendShelves.confirmWishesBody).not.toContain("make them private");
  });

  it("permis : la politique décrit les deux étagères sans « toutes » / « chaque » et dit l'exception une fois, sur ce que font les réglages", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    expect(frText).toContain("Réglage des Envies allumé : vos amis voient vos Envies, y compris celles de vos collections privées, sans le nom de ces collections");
    expect(frText).toContain("Réglage du Vault allumé : vos amis voient les pièces de votre Vault, leur nom, leur catégorie et leur photo telle qu'elle est enregistrée");
    const frException =
      "Par exception, ces réglages ne montrent pas une Envie rangée dans une collection masquée par la modération, ni une pièce du Vault dont la publication d'achat est masquée par la modération.";
    expect(frText.split(frException)).toHaveLength(2);
    expect(enText).toContain("With the Wishlist setting on, your friends see your wishes, including those in your private collections, without the names of those collections");
    expect(enText).toContain("With the Vault setting on, your friends see the pieces in your Vault, their name, their category and their photo as stored");
    const enException =
      "As an exception, these settings do not show a wish that is in a collection hidden by moderation, nor a Vault piece whose purchase post is hidden by moderation.";
    expect(enText.split(enException)).toHaveLength(2);
    // L'effacement de la copie suit la règle du code : une collection « Mes amis » (masquée ou non) la garde.
    expect(frText).toContain("La copie d'une image est effacée quand vous éteignez le réglage (sauf si l'Envie est rangée dans une collection « Mes amis »)");
    expect(enText).toContain("The copy of an image is deleted when you turn the setting off (unless the wish is in a “My friends” collection)");
  });

  it("refusé : plus de « toutes » / « chaque », ni d'exception entre parenthèses, ni « une publication » quelconque, dans la politique", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    for (const old of ["vos amis voient toutes vos Envies", "vos amis voient chaque pièce de votre Vault", "(sauf celles d'une collection masquée par la modération)", "(sauf une pièce dont", "dont une publication est masquée"]) {
      expect(frText).not.toContain(old);
    }
    for (const old of ["your friends see all your wishes", "your friends see each piece in your Vault", "(except those in a collection hidden by moderation)", "(except a piece whose", "piece whose post is hidden"]) {
      expect(enText).not.toContain(old);
    }
    // Une collection masquée « Mes amis » garde la copie : « montrée à vos amis » était inexact.
    expect(frText).not.toContain("(sauf si l'Envie est rangée dans une collection montrée à vos amis)");
    expect(enText).not.toContain("(unless the wish is in a collection shown to your friends)");
  });
});

describe("politique : la copie d'image d'une Envie dans une collection masquée par la modération", () => {
  // La modération masque une collection sans remettre les copies en ordre, et
  // friendVisibleWishes compte une collection « Mes amis » masquée : une copie
  // peut y être gardée, ou faite (envie rangée dans cette collection).
  const frException =
    "La copie de l'image est effacée dès que l'Envie n'est plus montrée à vos amis, et tout part avec la suppression de votre compte. Exception : si la modération masque une collection, les copies des images de ses Envies peuvent être faites ou gardées tant qu'elle reste masquée, même quand ces Envies ne sont plus montrées à vos amis, et au plus tard jusqu'à la suppression de votre compte.";
  const enException =
    "The copy of the image is deleted as soon as the wish is no longer shown to your friends, and everything goes when you delete your account. Exception: if moderation hides a collection, the image copies of its wishes may be made or kept while it stays hidden, even when those wishes are no longer shown to your friends, and at the latest until you delete your account.";

  it("permis : la phrase « effacée dès que » est suivie de l'exception, en FR et en EN", () => {
    expect(all(privacyPolicy)).toContain(frException);
    expect(all(privacyPolicyEn)).toContain(enException);
  });

  it("refusé : plus de « effacée dès que » sans l'exception juste après", () => {
    expect(all(privacyPolicy)).not.toContain("et tout part avec la suppression de votre compte. Un ami peut signaler une collection");
    expect(all(privacyPolicyEn)).not.toContain("and everything goes when you delete your account. A friend can report a collection");
  });

  it("refusé : l'exception ne parle plus seulement des copies gardées (le serveur en fait aussi)", () => {
    expect(all(privacyPolicy)).not.toContain("peuvent être gardées tant qu'elle reste masquée");
    expect(all(privacyPolicyEn)).not.toContain("may be kept while it stays hidden");
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

describe("la grille d'un ami : les pièces du Vault aussi nettes que dans la grille de leur propriétaire", () => {
  const thumb = "https://encrypted-tbn0.gstatic.com/images?q=vignette";
  const hd = "https://boutique.example/piece-1600.jpg";

  it("permis : une pièce du Vault avec une image nette différente se charge en deux temps", () => {
    expect(shelfCellImageSize("vault")).toBe("card");
    expect(twoStepSources(shelfCellImageSize("vault"), hd, thumb)).toEqual({ thumb, hd });
  });

  it("refusé : sans image nette (repli sur la vignette), une seule image ; une envie reste en petite case", () => {
    // La case passe `imageHdUrl ?? imageUrl` : sans image nette, les deux adresses sont la même.
    expect(twoStepSources(shelfCellImageSize("vault"), thumb, thumb)).toBeNull();
    expect(shelfCellImageSize("wishes")).toBe("small");
    expect(twoStepSources(shelfCellImageSize("wishes"), hd, thumb)).toBeNull();
  });

  it("la case utilise ce choix (et non une taille fixe)", () => {
    const grid = source("components/friend-shelf-grid.tsx");
    expect(grid).toContain("size={shelfCellImageSize(entry.kind)}");
    expect(grid).not.toContain('<SpotImage size="small"');
  });
});
