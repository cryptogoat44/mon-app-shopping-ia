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
  friendShelfDetails,
  friendShelvesNoticeLines,
  friendShelvesSettingShown,
  needsFriendShelvesNotice,
  noticeAnnouncement,
  noticeAnswer,
  noticeAnswerProfilePatch,
  profileTabs,
  shelfToast,
  shelfCellImageSize,
  shelfCellLabel,
  showsVault,
  showsWishes,
  vaultFormNote,
  vaultItemNote,
  vaultShownNow,
  wishShareHint,
  wishesShownNow,
  wishlistPrivacyNote,
} from "../src/lib/friend-shelves";
import { collectionState, visibilityState } from "../src/lib/collections";
import { twoStepSources } from "../src/lib/piece-image";
import { moderationNoticeLines, systemNotificationLines } from "../src/lib/moderation-labels";

// Étagères des amis (lot « étagères des amis », migration 0058, refondu selon
// le fondateur : réglages allumés par défaut, information vue avant d'être vu,
// un ami voit tout en lecture seule, « Privée » reste privée) : la logique des
// écrans sans rendu (réglages cachés sans le serveur, information, onglets
// seulement annoncés, phrases « privé » exactes dans chaque état), les sources
// des écrans (lecture seule, aucune requête sans annonce), les textes FR / EN
// et la politique de confidentialité.

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const all = (doc: typeof privacyPolicy) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");

afterEach(() => {
  setActiveLocale("fr");
});

describe("les réglages : seulement quand le serveur les a, allumés sur un vrai oui, sans confirmation", () => {
  it("cachés sans la migration (champs absents), montrés avec", () => {
    expect(friendShelvesSettingShown(null)).toBe(false);
    expect(friendShelvesSettingShown({})).toBe(false);
    expect(friendShelvesSettingShown({ showWishesToFriends: false })).toBe(false);
    expect(friendShelvesSettingShown({ showWishesToFriends: false, showVaultToFriends: false })).toBe(true);
  });

  it("allumé seulement sur un vrai oui ; montré MAINTENANT seulement avec l'information vue", () => {
    expect(showsWishes({ showWishesToFriends: true })).toBe(true);
    expect(showsWishes({ showWishesToFriends: false })).toBe(false);
    expect(showsWishes({})).toBe(false);
    expect(showsVault({ showVaultToFriends: true })).toBe(true);
    expect(showsVault(null)).toBe(false);
    // Refusé : allumé mais information pas vue (ou serveur qui ne le dit pas).
    expect(wishesShownNow({ showWishesToFriends: true, friendShelvesInformed: false })).toBe(false);
    expect(wishesShownNow({ showWishesToFriends: true })).toBe(false);
    expect(vaultShownNow({ showVaultToFriends: true, friendShelvesInformed: false })).toBe(false);
    // Permis : allumé et information vue.
    expect(wishesShownNow({ showWishesToFriends: true, friendShelvesInformed: true })).toBe(true);
    expect(vaultShownNow({ showVaultToFriends: true, friendShelvesInformed: true })).toBe(true);
    expect(vaultShownNow({ showVaultToFriends: false, friendShelvesInformed: true })).toBe(false);
  });

  it("l'écran des réglages : interrupteurs nommés, un geste pour éteindre ou rallumer, aucune confirmation, caché sans le serveur", () => {
    const setting = source("components/friend-shelves-setting.tsx");
    expect(setting).toContain("if (!friendShelvesSettingShown(profile)) return null;");
    expect(setting).toContain("await updateFriendShelves({ [shelf]: next });");
    expect(setting).toContain("onValueChange={(next) => void save(shelf, next)}");
    // Refusé : la confirmation de la première version (et ses textes).
    for (const gone of ["needsShelfConfirmation", "setConfirming", "confirmWishesBody", "confirmVaultBody", "confirmCta", "friendShelves.cancel"]) expect(setting, gone).not.toContain(gone);
    for (const key of ["confirmWishesTitle", "confirmWishesBody", "confirmVaultTitle", "confirmVaultBody", "confirmCta", "cancel"]) {
      expect(key in fr.friendShelves, key).toBe(false);
      expect(key in en.friendShelves, key).toBe(false);
    }
    expect(setting).toContain("accessibilityLabel={title}");
    expect(setting).toContain("value={value[shelf]}");
    // Raccord avec la nouvelle interface : chaque ligne prend la ligne commune de Réglages, de 44 points.
    expect(setting).toContain("row: g.row");
    expect(source("components/settings-group.tsx")).toContain("row: { minHeight: 44");
    // Échec : l'interrupteur revient et un message le dit.
    expect(setting).toContain("setValue(previous);");
    // L'information est aussi montrée dans Réglages, au-dessus des interrupteurs.
    expect(setting.indexOf("<FriendShelvesNotice")).toBeGreaterThan(-1);
    expect(setting.indexOf("<FriendShelvesNotice")).toBeLessThan(setting.indexOf('row("wishes"'));
    expect(source("app/(app)/settings.tsx")).toContain("<FriendShelvesSetting />");
  });

  it("le message court dit vrai : « voient maintenant » seulement avec l'information vue", () => {
    expect(shelfToast("wishes", true, true, true)).toBe(fr.friendShelves.wishesShown);
    expect(shelfToast("vault", true, true, true)).toBe(fr.friendShelves.vaultShown);
    // Refusé : « voient maintenant » avant l'information.
    expect(shelfToast("wishes", true, false, true)).toBe("C'est allumé. Vos amis verront vos Envies quand vous aurez lu « Ce que vos amis peuvent voir ».");
    expect(shelfToast("vault", true, false, true)).toBe("C'est allumé. Vos amis verront votre Vault quand vous aurez lu « Ce que vos amis peuvent voir ».");
    // Éteint : avec les collections, celles « Mes amis » restent visibles.
    expect(shelfToast("wishes", false, true, true)).toBe(fr.friendShelves.wishesPrivateAgainCollections);
    expect(shelfToast("wishes", false, true, false)).toBe(fr.friendShelves.wishesPrivateAgain);
    expect(shelfToast("vault", false, false, true)).toBe(fr.friendShelves.vaultPrivateAgain);
    setActiveLocale("en");
    expect(shelfToast("wishes", true, false, true)).toBe("It's on. Your friends will see your wishes once you have read “What your friends can see”.");
  });
});

describe("l'information « Ce que vos amis peuvent voir » : prévenu avant d'être vu", () => {
  const base = { showWishesToFriends: true, showVaultToFriends: true, friendShelvesInformed: false };

  it("montrée seulement si le serveur connaît la fonction, que le membre ne l'a pas vue, et qu'un réglage est allumé", () => {
    expect(needsFriendShelvesNotice(base)).toBe(true);
    expect(needsFriendShelvesNotice({ ...base, showVaultToFriends: false })).toBe(true);
    // Refusé : déjà vue, migration absente, vieux serveur sans le champ, rien d'allumé.
    expect(needsFriendShelvesNotice({ ...base, friendShelvesInformed: true })).toBe(false);
    expect(needsFriendShelvesNotice({})).toBe(false);
    expect(needsFriendShelvesNotice(null)).toBe(false);
    expect(needsFriendShelvesNotice({ showWishesToFriends: true, showVaultToFriends: true })).toBe(false);
    expect(needsFriendShelvesNotice({ ...base, showWishesToFriends: false, showVaultToFriends: false })).toBe(false);
  });

  it("ses lignes disent exactement ce qui sera vu, selon les réglages allumés", () => {
    expect(friendShelvesNoticeLines(base)).toEqual([fr.friendShelves.noticeIntro, fr.friendShelves.noticeWishes, fr.friendShelves.noticeVault, fr.friendShelves.noticeOutro]);
    expect(friendShelvesNoticeLines({ ...base, showVaultToFriends: false })).toEqual([fr.friendShelves.noticeIntro, fr.friendShelves.noticeWishes, fr.friendShelves.noticeOutro]);
    expect(friendShelvesNoticeLines({ ...base, showWishesToFriends: false })).toEqual([fr.friendShelves.noticeIntro, fr.friendShelves.noticeVault, fr.friendShelves.noticeOutro]);
  });

  it("réponse enregistrée : appliquée aussitôt au profil affiché (carte cachée, phrases « privé » vraies), même si le rechargement échoue ; jamais à un autre membre", () => {
    const me = { ...base, id: "u1" };
    // Permis : pas encore répondu, la carte est là et les phrases disent « privé » (rien n'est montré).
    expect(needsFriendShelvesNotice(me)).toBe(true);
    expect(vaultItemNote(me)).toBe(fr.vaultItem.privateNote);
    // « Compris » appliqué : la carte se cache et plus aucune phrase ne promet « personne d'autre que vous ».
    const ok = { ...me, ...noticeAnswerProfilePatch("ok") };
    expect(needsFriendShelvesNotice(ok)).toBe(false);
    expect(vaultShownNow(ok)).toBe(true);
    expect(wishesShownNow(ok)).toBe(true);
    expect(vaultItemNote(ok)).toBe(fr.friendShelves.vaultItemNote);
    expect(vaultFormNote(ok)).toBe(fr.friendShelves.vaultFormNote);
    expect(wishShareHint(ok)).toBe(fr.friendShelves.wishShareHint);
    expect(wishlistPrivacyNote(ok, true)).toBe(fr.wishlist.privateNoteFriends);
    expect(shelfToast("vault", true, ok.friendShelvesInformed, true)).toBe(fr.friendShelves.vaultShown);
    // « Éteindre » appliqué : la carte se cache, les deux réglages sont éteints, rien n'est montré.
    const off = { ...me, ...noticeAnswerProfilePatch("off") };
    expect(noticeAnswerProfilePatch("off")).toEqual({ friendShelvesInformed: true, showWishesToFriends: false, showVaultToFriends: false });
    expect(needsFriendShelvesNotice(off)).toBe(false);
    expect(vaultShownNow(off)).toBe(false);
    expect(wishesShownNow(off)).toBe(false);
    const notice = source("components/friend-shelves-notice.tsx");
    expect(notice).toContain("const shown = needsFriendShelvesNotice(profile);");
    const patch = "if (memberId) patchProfile(memberId, noticeAnswerProfilePatch(choice));";
    expect(notice.indexOf(patch)).toBeGreaterThan(notice.indexOf("await updateFriendShelves(noticeAnswer(choice));"));
    expect(notice.indexOf(patch)).toBeLessThan(notice.indexOf("await refreshProfile();"));
    // Refusé : le changement n'est jamais appliqué au profil d'un autre membre (connecté entre-temps).
    const auth = source("lib/auth-context.tsx");
    expect(auth).toContain("setProfile((current) => (current && current.id === memberId ? { ...current, ...patch } : current));");
  });

  it("VoiceOver : une seule annonce par apparition et par membre, pas à chaque montage (onglets du profil, fin du chargement, Réglages par-dessus)", () => {
    // Permis : première apparition annoncée.
    expect(noticeAnnouncement(null, true, "u1")).toEqual({ announce: true, announcedFor: "u1" });
    // Refusé : remontée (autre onglet, autre carte montée) déjà annoncée à ce membre.
    expect(noticeAnnouncement("u1", true, "u1")).toEqual({ announce: false, announcedFor: "u1" });
    // Permis : un autre membre connecté ensuite sur le même téléphone (sans passer par « cachée ») l'entend.
    expect(noticeAnnouncement("u1", true, "u2")).toEqual({ announce: true, announcedFor: "u2" });
    // Cachée : rien, et elle pourra être annoncée si elle réapparaît.
    expect(noticeAnnouncement("u1", false, "u1")).toEqual({ announce: false, announcedFor: null });
    expect(noticeAnnouncement("u1", true, null)).toEqual({ announce: false, announcedFor: null });
    const notice = source("components/friend-shelves-notice.tsx");
    // Le drapeau est au niveau du module (partagé par toutes les cartes), pas dans l'état de la carte.
    expect(notice).toMatch(/^let announcedFor: string \| null = null;$/m);
    expect(notice).toContain("const next = noticeAnnouncement(announcedFor, shown, memberId);");
    expect(notice).toContain("}, [shown, memberId]);");
  });

  it("« Compris » note seulement la date ; « Éteindre » éteint les deux réglages et note la date", () => {
    expect(noticeAnswer("ok")).toEqual({ informed: true });
    expect(noticeAnswer("off")).toEqual({ wishes: false, vault: false, informed: true });
  });

  it("l'écran : sur son propre profil (tous les onglets) et dans Réglages ; deux boutons de 44 points ; VoiceOver l'entend ; rien ne bloque", () => {
    const notice = source("components/friend-shelves-notice.tsx");
    expect(notice).toContain("if (!shown) return null;");
    expect(notice).toContain("await updateFriendShelves(noticeAnswer(choice));");
    expect(notice).toContain('accessibilityRole="alert"');
    expect(notice).toContain('if (next.announce && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(');
    expect(notice).toContain("button: { minHeight: 44, minWidth: 44");
    expect(notice).toContain("{t.friendShelves.noticeOk}");
    expect(notice).toContain("{t.friendShelves.noticeOff}");
    // Aucune case à cocher : une information, pas un consentement ; pas de fenêtre qui bloque l'app.
    expect(notice).not.toMatch(/Checkbox|<Switch|<Modal/);
    // Échec : un message, et la carte reste.
    expect(notice).toContain("setError(true);");
    const own = source("app/(app)/(tabs)/profile/index.tsx");
    const tag = "<FriendShelvesNotice style={styles.noticeWrap} />";
    expect(own).toContain(tag);
    expect(own.indexOf(tag)).toBeGreaterThan(own.indexOf("const profileHeader = (inset: boolean) => ("));
    expect(own.indexOf(tag)).toBeLessThan(own.indexOf("<View style={styles.seg}>"));
    // Refusé : une marge toujours là autour de la carte (16 points de plus dans l'en-tête, même sans carte).
    expect(own).not.toContain("<View style={styles.noticeWrap}>");
    // Permis : la marge n'est posée que si la carte est montrée.
    expect(notice.indexOf("if (!shown) return null;")).toBeLessThan(notice.indexOf("<View style={style}>"));
    // Jamais écrite par l'app sans ce geste : seule l'information envoie « informed ».
    expect(source("components/friend-shelves-setting.tsx")).not.toContain("informed");
  });

  it("textes de l'information, mot pour mot, FR et EN", () => {
    expect(fr.friendShelves.noticeTitle).toBe("Ce que vos amis peuvent voir");
    expect(fr.friendShelves.noticeIntro).toBe("Vos amis (les membres que vous suivez et qui vous suivent) pourront voir sur votre profil, sans rien pouvoir modifier :");
    expect(fr.friendShelves.noticeWishes).toBe(
      "Vos Envies, avec leur prix, votre alerte de prix et le nom de vos collections « Mes amis ». Une Envie rangée dans une collection « Privée » n'y apparaît pas, sauf si elle est aussi dans une collection « Mes amis »."
    );
    expect(en.friendShelves.noticeWishes).toBe(
      "Your wishes, with their price, your price alert and the names of your “My friends” collections. A wish in a “Private” collection does not appear there, unless it is also in a “My friends” collection."
    );
    expect(fr.friendShelves.noticeVault).toBe(
      "Les pièces de votre Vault, avec leur photo (y compris celles que vous avez prises vous-même), leur date d'ajout et la mention « Achat vérifié »."
    );
    expect(fr.friendShelves.noticeOutro).toBe(
      "Vos Envies et votre Vault ne s'ouvrent à vos amis qu'après votre réponse (vos collections « Mes amis » restent montrées comme avant). Personne n'est prévenu quand vos amis regardent. Vous pourrez changer d'avis à tout moment dans Réglages."
    );
    expect([fr.friendShelves.noticeOk, fr.friendShelves.noticeOff]).toEqual(["Compris", "Éteindre"]);
    expect(en.friendShelves.noticeTitle).toBe("What your friends can see");
    expect([en.friendShelves.noticeOk, en.friendShelves.noticeOff]).toEqual(["Got it", "Turn off"]);
    expect(en.friendShelves.noticeOutro).toBe(
      "Your wishes and your Vault only open to your friends after you answer (your “My friends” collections stay shown as before). No one is told when your friends look. You can change your mind at any time in Settings."
    );
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

describe("les phrases « privé » : exactes dans chaque état", () => {
  it("éteint, inconnu, ou allumé sans l'information vue : la phrase d'avant, mot pour mot", () => {
    for (const profile of [
      null,
      {},
      { showWishesToFriends: false, showVaultToFriends: false },
      { showWishesToFriends: true, showVaultToFriends: true, friendShelvesInformed: false },
      { showWishesToFriends: true, showVaultToFriends: true },
    ]) {
      expect(vaultItemNote(profile)).toBe(fr.vaultItem.privateNote);
      expect(vaultFormNote(profile)).toBe(fr.vaultForm.privateNote);
      expect(wishShareHint(profile)).toBe(fr.wishlistItem.shareHint);
    }
  });

  it("allumé et information vue : la phrase dit que les amis voient", () => {
    const on = { showWishesToFriends: true, showVaultToFriends: true, friendShelvesInformed: true };
    expect(vaultItemNote(on)).toBe(fr.friendShelves.vaultItemNote);
    expect(vaultFormNote(on)).toBe(fr.friendShelves.vaultFormNote);
    expect(wishShareHint(on)).toBe(fr.friendShelves.wishShareHint);
    for (const text of [vaultItemNote(on), vaultFormNote(on), wishShareHint(on)]) expect(text).toMatch(/amis/);
    setActiveLocale("en");
    expect(vaultItemNote(on)).toBe(en.friendShelves.vaultItemNote);
    expect(wishShareHint({})).toBe(en.wishlistItem.shareHint);
  });

  it("la feuille « Qui voit vos Envies », trois états : montrées à vos amis ; éteint ; fonction absente (ou information pas vue)", () => {
    const shown = { showWishesToFriends: true, showVaultToFriends: false, friendShelvesInformed: true };
    expect(wishlistPrivacyNote(shown, true)).toBe("Vos amis voient vos Envies, sauf celles rangées seulement dans des collections « Privée ». Vous pouvez l'éteindre dans Réglages.");
    expect(wishlistPrivacyNote({ ...shown, showWishesToFriends: false }, true)).toBe(
      "Vous avez éteint « Montrer mes Envies à mes amis » : vos Envies sont privées, sauf celles que vous rangez dans une collection « Mes amis »."
    );
    // Fonction absente, ou pas encore informé : la phrase d'avant (vraie : rien n'est montré par l'étagère).
    for (const profile of [null, {}, { ...shown, friendShelvesInformed: false }]) {
      expect(wishlistPrivacyNote(profile, true)).toBe(fr.wishlist.privateNoteCollections);
      expect(wishlistPrivacyNote(profile, false)).toBe(fr.wishlist.privateNote);
    }
    setActiveLocale("en");
    expect(wishlistPrivacyNote(shown, true)).toBe("Your friends see your wishes, except those only in “Private” collections. You can turn it off in Settings.");
    expect(wishlistPrivacyNote({ ...shown, showWishesToFriends: false }, false)).toBe(en.wishlist.privateNoteOff);
  });

  it("« Privée » reste privée : « Privée : vous seul la voyez » dans tous les cas, la variante de la première version est retirée", () => {
    expect(visibilityState("private")).toBe("Privée : vous seul la voyez.");
    expect(collectionState({ visibility: "private" })).toBe(fr.collections.privateState);
    expect(visibilityState("friends")).toBe(fr.collections.friendsState);
    // Refusé : la variante « Nom privé : vos amis peuvent voir ses envies », et tout ce qui la portait.
    expect("privateStateFriendsSeeWishes" in fr.collections).toBe(false);
    expect("privateStateFriendsSeeWishes" in en.collections).toBe(false);
    expect(source("lib/collections.ts")).not.toContain("showsWishesToFriends");
    expect(source("components/collection-options-sheet.tsx")).toContain("{collectionState(collection)}");
    expect(source("components/collection-settings-sheet.tsx")).toContain("{collectionState(current)}");
    for (const file of ["components/collection-options-sheet.tsx", "components/collection-settings-sheet.tsx"]) expect(source(file), file).not.toContain("showsWishes");
    setActiveLocale("en");
    expect(visibilityState("private")).toBe(en.collections.privateState);
  });

  it("là où l'on range une envie : une phrase courte dit qu'une collection « Privée » la garde hors des Envies que voient vos amis", () => {
    expect(fr.collections.privateNotOnShelf).toBe(
      "Une Envie rangée dans une collection « Privée » n'apparaît pas dans les Envies que voient vos amis, sauf si elle est aussi dans une collection « Mes amis »."
    );
    expect(en.collections.privateNotOnShelf).toBe("A wish in a “Private” collection does not appear in the wishes your friends see, unless it is also in a “My friends” collection.");
    const sheet = source("components/add-to-collection-sheet.tsx");
    // Seulement réglage allumé (éteint, la phrase serait sans objet).
    expect(sheet).toMatch(/\{showsWishes\(profile\) \? \(\s*<Text style=\{styles\.hint\} testID="collection-privee-hors-etagere">\s*\{t\.collections\.privateNotOnShelf\}/);
  });

  it("collection masquée par la modération : « vos amis ne la voient plus », privée ou « Mes amis »", () => {
    for (const visibility of ["private", "friends"] as const) {
      expect(collectionState({ visibility, hidden: true }), visibility).toBe("Masquée par la modération : vos amis ne la voient plus.");
    }
    expect("hiddenStateFriendsSeeWishes" in fr.collections).toBe(false);
    expect("hiddenStateFriendsSeeWishes" in en.collections).toBe(false);
    setActiveLocale("en");
    expect(collectionState({ visibility: "friends", hidden: true })).toBe("Hidden by moderation: your friends can no longer see it.");
  });

  it("notification de collection masquée : la phrase d'origine pour tous, sans le réglage", () => {
    const hide = { action: "hide" as const, targetType: "collection" as const, reason: null, note: null };
    const notification = { id: "n1", type: "moderation" as const, actor: null, createdAt: "2026-11-24T10:00:00.000Z", read: false, postId: null, moderation: hide, reportedType: null };
    expect(moderationNoticeLines(hide)).toEqual(["Une de vos collections a été masquée par la modération : vos amis ne la voient plus."]);
    expect(systemNotificationLines(notification)).toEqual([fr.notifications.moderationHiddenCollection]);
    expect(moderationNoticeLines({ ...hide, action: "restore" })).toEqual([fr.notifications.moderationRestoredCollection]);
    setActiveLocale("en");
    expect(systemNotificationLines(notification)).toEqual(["One of your collections was hidden by moderation: your friends can no longer see it."]);
    expect("moderationHiddenCollectionFriendsSeeWishes" in fr.notifications).toBe(false);
    expect(source("lib/moderation-labels.ts")).not.toContain("showsWishesToFriends");
    expect(source("app/(app)/(tabs)/activite.tsx")).toContain("systemNotificationLines(notification)");
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
    expect(source("components/wishlist-panel.tsx")).toContain("{wishlistPrivacyNote(profile, collectionsAvailable.enabled)}");
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
    // Refusé : « Éteint au départ » (les réglages sont allumés par défaut).
    expect(fr.friendShelves.settingWishesHelp).not.toContain("Éteint au départ");
    expect(fr.friendShelves.settingVaultHelp).not.toContain("Éteint au départ");
    expect(en.friendShelves.settingWishesHelp).not.toContain("Off at first");
    expect(fr.friendShelves.settingWishesHelp).toContain("sauf celles rangées seulement dans des collections « Privée »");
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

describe("une Envie « Privée » aussi rangée dans une collection « Mes amis » : les phrases de l'app disent l'exception", () => {
  const sentences = () => [
    fr.collections.privateNotOnShelf,
    fr.friendShelves.noticeWishes,
    fr.friendShelves.noticeOutro,
    fr.friendShelves.wishShareHint,
    fr.wishlist.privateNoteFriends,
    fr.friendShelves.settingWishesHelp,
    en.collections.privateNotOnShelf,
    en.friendShelves.noticeWishes,
    en.friendShelves.noticeOutro,
    en.friendShelves.wishShareHint,
    en.wishlist.privateNoteFriends,
    en.friendShelves.settingWishesHelp,
  ];

  it("permis : l'exception « Mes amis » est dite (FR et EN)", () => {
    expect(fr.collections.privateNotOnShelf).toContain("sauf si elle est aussi dans une collection « Mes amis »");
    expect(fr.friendShelves.noticeWishes).toContain("sauf si elle est aussi dans une collection « Mes amis »");
    expect(en.collections.privateNotOnShelf).toContain("unless it is also in a “My friends” collection");
    expect(en.friendShelves.noticeWishes).toContain("unless it is also in a “My friends” collection");
    for (const text of [fr.friendShelves.wishShareHint, fr.wishlist.privateNoteFriends, fr.friendShelves.settingWishesHelp]) {
      expect(text).toContain("sauf celles rangées seulement dans des collections « Privée »");
    }
    for (const text of [en.friendShelves.wishShareHint, en.wishlist.privateNoteFriends, en.friendShelves.settingWishesHelp]) {
      expect(text).toContain("except those only in “Private” collections");
    }
    expect(fr.friendShelves.noticeOutro).toContain("vos collections « Mes amis » restent montrées comme avant");
    expect(en.friendShelves.noticeOutro).toContain("your “My friends” collections stay shown as before");
  });

  it("refusé : les anciennes promesses sans exception (« n'apparaît pas. », « Rien n'est montré avant votre réponse »)", () => {
    for (const text of sentences()) {
      expect(text).not.toMatch(/« Privée » n'(apparaît pas dans les Envies que voient vos amis|y apparaît pas)\./);
      expect(text).not.toContain("sauf celles rangées dans une collection « Privée »");
      expect(text).not.toContain("Rien n'est montré avant votre réponse");
      expect(text).not.toMatch(/“Private” collection does not appear (in the wishes your friends see|there)\./);
      expect(text).not.toContain("except those in a “Private” collection");
      expect(text).not.toContain("Nothing is shown before you answer");
    }
  });
});

describe("qui voit vos Envies et votre Vault : des phrases courtes qui préviennent, la politique qui dit l'exception une fois", () => {
  // Règle : une phrase de l'app qui PRÉVIENT ne sous-estime jamais qui voit et
  // ne dit ni « toutes » ni « chaque » ; elle ne liste pas les exceptions de la
  // modération (elles ne font que retirer des choses de ce que voient les amis).
  // La politique les dit une fois, exactement.
  const inApp = () => [
    fr.friendShelves.settingWishesHelp,
    fr.friendShelves.settingVaultHelp,
    fr.friendShelves.noticeIntro,
    fr.friendShelves.noticeWishes,
    fr.friendShelves.noticeVault,
    fr.friendShelves.vaultItemNote,
    fr.friendShelves.vaultFormNote,
    fr.friendShelves.wishShareHint,
    fr.wishlist.privateNoteFriends,
    fr.collections.privateNotOnShelf,
  ];
  const inAppEn = () => [
    en.friendShelves.settingWishesHelp,
    en.friendShelves.settingVaultHelp,
    en.friendShelves.noticeIntro,
    en.friendShelves.noticeWishes,
    en.friendShelves.noticeVault,
    en.friendShelves.vaultItemNote,
    en.friendShelves.vaultFormNote,
    en.friendShelves.wishShareHint,
    en.wishlist.privateNoteFriends,
    en.collections.privateNotOnShelf,
  ];

  it("permis : les phrases de l'app, mot pour mot, avec leurs avertissements gardés", () => {
    expect(fr.friendShelves.settingWishesHelp).toBe(
      `Allumé, vos amis (les membres que vous suivez et qui vous suivent) voient vos Envies, sauf celles rangées seulement dans des collections « Privée » : titre, image (une copie faite par ${BRAND}), prix, lien vers la boutique, votre alerte de prix et le nom de vos collections « Mes amis ». Ils ne peuvent rien modifier. Jamais les pièces reçues ni vos publications enregistrées.`
    );
    expect(fr.friendShelves.settingVaultHelp).toBe(
      "Allumé, vos amis voient les pièces de votre Vault : nom, catégorie, photo (y compris les photos que vous avez prises vous-même), date d'ajout et mention « Achat vérifié ». Ils ne peuvent rien modifier."
    );
    expect(fr.friendShelves.vaultItemNote).toBe(
      "Vos amis voient votre Vault, avec la date d'ajout et la mention « Achat vérifié » (Réglages) ; personne d'autre ne le voit. Pour montrer cette pièce à d'autres, partagez-la dans votre fil."
    );
    expect(fr.friendShelves.vaultFormNote).toBe("Vos amis verront cette pièce dans votre Vault (Réglages, « Montrer mon Vault à mes amis »).");
    expect(fr.friendShelves.wishShareHint).toBe("Vos amis voient vos Envies, sauf celles rangées seulement dans des collections « Privée ». Vous pouvez l'éteindre dans Réglages.");
    expect(fr.wishlist.privateNoteFriends).toBe("Vos amis voient vos Envies, sauf celles rangées seulement dans des collections « Privée ». Vous pouvez l'éteindre dans Réglages.");
    expect(en.friendShelves.settingWishesHelp).toBe(
      `When on, your friends (members you follow who follow you back) see your wishes, except those only in “Private” collections: title, image (a copy made by ${BRAND}), price, link to the shop, your price alert and the names of your “My friends” collections. They cannot change anything. Never the pieces you received or your saved posts.`
    );
    expect(en.friendShelves.settingVaultHelp).toBe(
      "When on, your friends see the pieces in your Vault: name, category, photo (including photos you took yourself), date added and the “Verified purchase” mark. They cannot change anything."
    );
    expect(en.friendShelves.wishShareHint).toBe("Your friends see your wishes, except those only in “Private” collections. You can turn it off in Settings.");
    expect(en.wishlist.privateNoteFriends).toBe("Your friends see your wishes, except those only in “Private” collections. You can turn it off in Settings.");
  });

  it("refusé : ni « toutes » / « chaque », ni exception de la modération dans les phrases de l'app", () => {
    for (const text of inApp()) {
      expect(text).not.toMatch(/(?<!\p{L})(toutes|tous|chaque|toujours)(?!\p{L})/iu);
      expect(text).not.toContain("modération");
    }
    for (const text of inAppEn()) {
      expect(text).not.toMatch(/\b(all|every|each|always)\b/i);
      expect(text).not.toContain("moderation");
    }
  });

  it("refusé : les anciennes promesses de la première version (« Jamais la date d'ajout », « jamais vos alertes », « Rien d'autre n'est partagé sans votre accord »)", () => {
    const frTexts = JSON.stringify([fr.friendShelves, fr.wishlist, fr.collections]);
    const enTexts = JSON.stringify([en.friendShelves, en.wishlist, en.collections]);
    for (const old of ["Jamais la date d'ajout", "Jamais vos notes, vos alertes", "y compris celles rangées dans vos collections privées", "Rien d'autre n'est partagé sans votre accord", "Nom privé"]) expect(frTexts, old).not.toContain(old);
    for (const old of ["Never the date you added them", "Never your notes, your alerts", "including those in your private collections", "Nothing else is shared without your consent", "Private name"]) expect(enTexts, old).not.toContain(old);
  });

  it("permis : la politique décrit les deux étagères allumées par défaut, l'information d'abord, « Privée » reste privée, et dit l'exception une fois", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    expect(frText).toContain("« Montrer mes Envies à mes amis » et « Montrer mon Vault à mes amis », allumés au départ et enregistrés avec votre profil ; vous pouvez les éteindre à tout moment dans Réglages.");
    expect(frText).toContain("Rien n'est montré avant que vous en ayez été informé dans l'app");
    expect(frText).toContain("Réglage des Envies allumé : vos amis voient vos Envies, sauf celles rangées dans une collection « Privée »");
    expect(frText).toContain("votre alerte de prix (allumée ou non, et son seuil) et le nom de vos collections « Mes amis » où l'Envie est rangée ; jamais le nom d'une collection privée");
    expect(frText).toContain("leur date d'ajout et la mention « Achat vérifié »");
    const frException =
      "Par exception, ces réglages ne montrent pas une Envie rangée dans une collection masquée par la modération, ni une pièce du Vault dont la publication d'achat est masquée par la modération.";
    expect(frText.split(frException)).toHaveLength(2);
    expect(enText).toContain("“Show my Wishlist to my friends” and “Show my Vault to my friends”, on at first and stored with your profile; you can turn them off at any time in Settings.");
    expect(enText).toContain("Nothing is shown before you have been informed in the app");
    expect(enText).toContain("With the Wishlist setting on, your friends see your wishes, except those in a “Private” collection");
    const enException =
      "As an exception, these settings do not show a wish that is in a collection hidden by moderation, nor a Vault piece whose purchase post is hidden by moderation.";
    expect(enText.split(enException)).toHaveLength(2);
    expect(frText).toContain("La copie d'une image est effacée quand vous éteignez le réglage ou rangez l'Envie dans une collection « Privée » (sauf si l'Envie est aussi rangée dans une collection « Mes amis »)");
    expect(enText).toContain("The copy of an image is deleted when you turn the setting off or put the wish in a “Private” collection (unless the wish is also in a “My friends” collection)");
    // Le repère « [À vérifier : …] » est gardé, et dit que le réglage est allumé par défaut.
    expect(frText).toContain("[À vérifier : base légale retenue (exécution du contrat), réglages allumés par défaut");
    expect(enText).toContain("[To be verified: legal basis retained (performance of the contract), settings on by default");
  });

  it("refusé : la règle de la première version (éteints au départ, collections privées montrées, ni date ni « Achat vérifié ») dans la politique", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    for (const old of [
      "« Montrer mon Vault à mes amis », éteints au départ",
      "y compris celles de vos collections privées, sans le nom de ces collections",
      "Jamais la date d'ajout, la mention « Achat vérifié »",
      "jamais vos notes, vos alertes et leurs seuils",
      "vos amis voient toutes vos Envies",
      "(sauf celles d'une collection masquée par la modération)",
    ]) {
      expect(frText, old).not.toContain(old);
    }
    for (const old of ["“Show my Vault to my friends”, off at first", "including those in your private collections, without the names of those collections", "Never the date you added them, the “Verified purchase” mark", "never your notes, your alerts and their thresholds", "your friends see all your wishes"]) {
      expect(enText, old).not.toContain(old);
    }
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

describe("politique de confidentialité : « vos amis les voient, sauf si vous l'éteignez dans Réglages, et seulement après que vous en avez été informé dans l'app »", () => {
  it("permis : la nouvelle règle dans « En bref », « Qui peut voir quoi » et les alertes, FR et EN", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    expect(frText).toContain(
      "Vos amis (les membres que vous suivez et qui vous suivent) voient votre Vault et vos Envies, sauf si vous l'éteignez dans Réglages, et seulement après que vous en avez été informé dans l'app. Une Envie rangée dans une collection « Privée » n'apparaît pas dans les Envies que voient vos amis, sauf si elle est aussi dans une collection « Mes amis »."
    );
    expect(frText).toContain("Votre Vault : vos amis, sauf si vous éteignez « Montrer mon Vault à mes amis » dans Réglages, et seulement après que vous en avez été informé dans l'app ; sinon, vous seul.");
    expect(frText).toContain("Si vos amis voient vos Envies, ils voient aussi, pour chacune, si votre alerte de prix est allumée, et son seuil ; jamais les autres sortes d'alerte, vos nouveautés ni vos notifications.");
    expect(enText).toContain(
      "Your friends (members you follow who follow you back) see your Vault and your Wishlist, unless you turn this off in Settings, and only after you have been informed in the app. A wish in a “Private” collection does not appear in the wishes your friends see, unless it is also in a “My friends” collection."
    );
    expect(enText).toContain("Your Vault: your friends, unless you turn off “Show my Vault to my friends” in Settings, and only after you have been informed in the app; otherwise, you alone.");
    expect(enText).toContain("If your friends see your Wishlist, they also see, for each wish, whether your price alert is on, and its threshold; never the other kinds of alert, your news or your notifications.");
  });

  it("refusé : les anciennes promesses (« votre Vault n'est visible que par vous », « vos Envies aussi », « Vos alertes, elles, restent visibles par vous seul »)", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    for (const old of [
      "Votre Vault n'est visible que par vous",
      "Votre Vault : vous seul, ou vos amis si vous l'avez choisi",
      "Votre Vault reste visible par vous seul",
      "Vos alertes, elles, restent visibles par vous seul",
      "Ce que voient les autres membres : rien qui vous concerne.",
      "sauf si vous choisissez de les montrer à vos amis",
    ]) {
      expect(frText, old).not.toContain(old);
    }
    for (const old of ["Your Vault is visible to you alone", "Your Vault: you alone, or your friends if you chose so", "Your Vault remains visible to you alone", "Your alerts remain visible to you alone", "What other members see: nothing about you."]) {
      expect(enText, old).not.toContain(old);
    }
  });

  it("un paragraphe dit qui sont les amis, ce qu'ils voient, ce qu'ils ne voient jamais, et l'export", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    for (const words of [
      "les membres que vous suivez et qui vous suivent",
      "l'information « Ce que vos amis peuvent voir » s'affiche sur votre profil et dans Réglages jusqu'à ce que vous touchiez « Compris » ou « Éteindre »",
      "jamais le nom d'une collection privée, les pièces reçues, vos publications enregistrées, la recherche d'origine, vos nouveautés d'alerte ni vos notifications",
      "Vos amis ne peuvent rien modifier.",
      "ne garde aucune trace de qui a regardé",
      "Ces deux réglages et la date de l'information figurent dans l'export de vos données.",
    ]) {
      expect(frText, words).toContain(words);
    }
    for (const words of [
      "the members you follow who follow you back",
      "the notice “What your friends can see” appears on your profile and in Settings until you tap “Got it” or “Turn off”",
      "Your friends cannot change anything.",
      "keeps no record of who looked",
      "Both settings and the date of the notice are included in your data export.",
    ]) {
      expect(enText, words).toContain(words);
    }
  });
});

describe("profil d'un ami : ce qu'il voit en plus, en lecture seule", () => {
  const wish = { id: "w", title: "Sac", imageUrl: null, imageThumbUrl: null, merchantName: null, merchantUrl: null, isAffiliate: false, priceMin: null, currency: null };
  const piece = { id: "v", title: "Veste", category: "clothing" as const, imageUrl: null, imageHdUrl: null };

  it("permis : alerte de prix (avec ou sans seuil), collections « Mes amis », date d'ajout, « Achat vérifié »", () => {
    expect(friendShelfDetails({ kind: "wishes", item: { ...wish, priceAlert: { targetPrice: 99, targetCurrency: "EUR" }, collections: ["Hiver", "Mariage"] } }, "fr")).toEqual([
      expect.stringMatching(/^Alerte de prix : sous 99/),
      "Dans ses collections : Hiver, Mariage",
    ]);
    expect(friendShelfDetails({ kind: "wishes", item: { ...wish, priceAlert: { targetPrice: null, targetCurrency: null } } }, "fr")).toEqual(["Alerte de prix allumée"]);
    expect(friendShelfDetails({ kind: "vault", item: { ...piece, createdAt: "2026-11-03T10:00:00+00:00", verified: true } }, "fr")).toEqual(["Ajoutée au Vault le 3 novembre 2026", "Achat vérifié"]);
    setActiveLocale("en");
    expect(friendShelfDetails({ kind: "vault", item: { ...piece, createdAt: "2026-11-03T10:00:00+00:00", verified: true } }, "en")).toEqual(["Added to the Vault on November 3, 2026", en.profile.verified]);
  });

  it("refusé : rien d'inventé quand le serveur ne l'envoie pas (serveur plus ancien, alerte éteinte, pas vérifié, aucune collection)", () => {
    expect(friendShelfDetails({ kind: "wishes", item: wish }, "fr")).toEqual([]);
    expect(friendShelfDetails({ kind: "wishes", item: { ...wish, collections: [] } }, "fr")).toEqual([]);
    expect(friendShelfDetails({ kind: "vault", item: piece }, "fr")).toEqual([]);
    expect(friendShelfDetails({ kind: "vault", item: { ...piece, verified: false } }, "fr")).toEqual([]);
  });

  it("la petite feuille les affiche, toujours sans rien à modifier", () => {
    const grid = source("components/friend-shelf-grid.tsx");
    expect(grid).toContain("const details = friendShelfDetails(entry, getActiveLocale());");
    expect(grid).toContain("{details.map((line) => (");
    for (const forbidden of ["WishAlert", "updateWishAlert", "setWishCollections", "keepSharedItem", "addWishlistItem"]) expect(grid, forbidden).not.toContain(forbidden);
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
