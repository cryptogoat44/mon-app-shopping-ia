import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COLLECTION_NAME_MAX_LENGTH, type CollectionSummary } from "@monapp/shared-types";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { attachmentFor } from "../src/lib/conversations";
import {
  canSaveName,
  cleanCollectionName,
  collectionChips,
  collectionNameLength,
  collectionsStatus,
  friendSectionVisible,
  needsShareConfirmation,
  onCollectionsStatus,
  readCollectionsStatus,
  selectedCollection,
  selectionChanged,
  setCollectionsStatus,
  sharedItemImage,
  sharedItemPrice,
  toggleSelection,
  visibilityOptions,
  visibilityState,
} from "../src/lib/collections";

// Lot collections : collections d'envies, privées ou montrées aux amis. La
// logique des écrans, sans rendu (tout est caché sans les collections sur le
// serveur, puces, nom, visibilité confirmée, feuille « Ajouter à une
// collection », section du profil d'un ami), et les textes FR / EN.

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => {
  setActiveLocale("fr");
  setCollectionsStatus({ enabled: false });
});

const collection = (overrides: Partial<CollectionSummary>): CollectionSummary => ({
  id: "c1",
  name: "Cadeaux",
  visibility: "private",
  itemCount: 2,
  createdAt: "2026-11-09T10:00:00.000000+00:00",
  ...overrides,
});

describe("cachées quand les collections ne sont pas disponibles", () => {
  it("serveur sans 0033, ancien serveur, réponse illisible : rien n'est affiché", () => {
    for (const body of [{ enabled: false }, null, "Not Found", { error: "collections_unavailable" }, { enabled: "oui" }]) {
      const status = readCollectionsStatus(body);
      expect(status).toEqual({ enabled: false });
      expect(collectionChips(status, [collection({})])).toBeNull();
      expect(friendSectionVisible(status, [{ id: "c1", name: "Cadeaux", itemCount: 1, coverUrl: null }])).toBe(false);
    }
    expect(readCollectionsStatus({ enabled: true })).toEqual({ enabled: true });
  });

  it("chaque écran ne montre les collections que si elles sont disponibles", () => {
    const panel = source("components/wishlist-panel.tsx");
    expect(panel).toContain("collectionChips(collectionsAvailable, collections)");
    expect(panel).toMatch(/\{chips \? \(/);
    expect(panel).toContain("collectionsAvailable.enabled ? t.wishlist.privateNoteCollections : t.wishlist.privateNote");
    const wish = source("app/(app)/envie.tsx");
    expect(wish).toMatch(/\{collections\.enabled \? \(\s*<Pressable[\s\S]*?t\.collections\.addToCollection/);
    expect(wish).toContain("{collections.enabled ? <AddToCollectionSheet");
    const friend = source("components/friend-collections.tsx");
    expect(friend).toContain("if (!friendSectionVisible(status, collections) || !collections) return null;");
    // La disponibilité est lue par la barre d'onglets, jusqu'à ce qu'elles soient là.
    expect(source("app/(app)/(tabs)/_layout.tsx")).toContain("if (!collectionsStatus().enabled) fetchCollectionsStatus()");
  });

  it("l'état est partagé entre les écrans : prévenus seulement s'il change", () => {
    const seen: boolean[] = [];
    const stop = onCollectionsStatus((status) => seen.push(status.enabled));
    setCollectionsStatus({ enabled: true });
    setCollectionsStatus({ enabled: true });
    setCollectionsStatus({ enabled: false });
    stop();
    setCollectionsStatus({ enabled: true });
    expect(seen).toEqual([true, false]);
    expect(collectionsStatus()).toEqual({ enabled: true });
  });
});

describe("écran Envies : « Toutes » puis une puce par collection", () => {
  it("les puces, dans l'ordre ; une collection montrée aux amis le dit (VoiceOver compris)", () => {
    const chips = collectionChips({ enabled: true }, [collection({}), collection({ id: "c2", name: "Été", visibility: "friends" })])!;
    expect(chips.map((chip) => [chip.label, chip.collectionId, chip.shared])).toEqual([
      ["Toutes", null, false],
      ["Cadeaux", "c1", false],
      ["Été", "c2", true],
    ]);
    expect(chips[2]!.accessibilityLabel).toBe("Été, visible par vos amis");
    // Liste pas encore lue : pas de puces.
    expect(collectionChips({ enabled: true }, null)).toBeNull();
  });

  it("la collection choisie, supprimée entre-temps : retour à « Toutes »", () => {
    const list = [collection({})];
    expect(selectedCollection(list, "c1")?.name).toBe("Cadeaux");
    expect(selectedCollection(list, "disparue")).toBeNull();
    expect(selectedCollection(null, "c1")).toBeNull();
  });

  it("sous les puces : qui voit la collection choisie, et « Gérer »", () => {
    expect(visibilityState("private")).toBe("Privée : vous seul la voyez.");
    expect(visibilityState("friends")).toBe("Visible par vos amis (les membres que vous suivez et qui vous suivent).");
    const panel = source("components/wishlist-panel.tsx");
    expect(panel).toContain("getCollectionWishlist(selectedKey, cursor)");
    expect(panel).toContain("t.collections.manageLabel(selected.name)");
    expect(panel).toContain("<CollectionSettingsSheet");
  });
});

describe("créer, renommer, supprimer", () => {
  it("un nom de 1 à 40 caractères, espaces en trop retirés (un emoji compte pour un)", () => {
    expect(cleanCollectionName("  Été \n 2027 ")).toBe("Été 2027");
    expect(canSaveName("   ")).toBe(false);
    expect(canSaveName("a".repeat(COLLECTION_NAME_MAX_LENGTH))).toBe(true);
    expect(canSaveName(` ${"a".repeat(COLLECTION_NAME_MAX_LENGTH)}  `)).toBe(true);
    expect(canSaveName("a".repeat(COLLECTION_NAME_MAX_LENGTH + 1))).toBe(false);
    expect(collectionNameLength("👜".repeat(COLLECTION_NAME_MAX_LENGTH))).toBe(COLLECTION_NAME_MAX_LENGTH);
    expect(t.collections.nameCounter(12, 40)).toBe("12 / 40 caractères");
  });

  it("créer : nom nettoyé envoyé au serveur ; son refus (mot interdit, limite) est affiché tel quel", () => {
    const sheet = source("components/collection-name-sheet.tsx");
    expect(sheet).toContain("createCollection(cleanCollectionName(name))");
    expect(sheet).toContain("e instanceof ApiError ? e.message : t.collections.saveError");
  });

  it("renommer et supprimer depuis « Gérer » ; supprimer se confirme et garde les envies", () => {
    const settings = source("components/collection-settings-sheet.tsx");
    expect(settings).toContain("updateCollection(current.id, { name: cleanCollectionName(name) })");
    expect(settings).toContain("deleteCollection(current.id)");
    expect(settings).toContain("t.collections.deleteConfirm");
    expect(t.collections.deleteConfirm).toBe("Supprimer cette collection ? Vos envies restent dans vos Envies.");
  });
});

describe("« Ajouter à une collection », depuis une envie", () => {
  it("cases à cocher : plusieurs collections ; rien n'est envoyé sans changement", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(selectionChanged(["a", "b"], ["b", "a"])).toBe(false);
    expect(selectionChanged(["a"], ["a", "b"])).toBe(true);
    expect(selectionChanged(["a", "b"], ["a"])).toBe(true);
  });

  it("la feuille enregistre la sélection en une fois, signale les collections « Amis », et crée une collection cochée d'office", () => {
    const sheet = source("components/add-to-collection-sheet.tsx");
    expect(sheet).toContain("setWishCollections(wishId, selected)");
    expect(sheet).toContain("if (!selectionChanged(initial, selected))");
    expect(sheet).toContain("t.collections.sharedBadge");
    expect(sheet).toContain("setSelected((current) => [...current, collection.id])");
    expect(t.collections.sheetHint).toContain("Celles marquées « Amis » sont visibles par vos amis.");
  });
});

describe("visibilité : « Privée » par défaut, « Mes amis » après confirmation", () => {
  it("passer à « Mes amis » se confirme ; revenir à « Privée », non", () => {
    expect(visibilityOptions().map((option) => option.label)).toEqual(["Privée", "Mes amis"]);
    expect(needsShareConfirmation("private", "friends")).toBe(true);
    expect(needsShareConfirmation("friends", "private")).toBe(false);
    expect(needsShareConfirmation("friends", "friends")).toBe(false);
  });

  it("la confirmation dit ce que les amis verront, jamais les notes ; « Mes amis » n'est envoyé que depuis elle", () => {
    expect(t.collections.shareConfirm).toContain("son titre, son image, son prix et le lien vers la boutique");
    expect(t.collections.shareConfirm).toContain("Jamais vos notes.");
    expect(t.collections.shareConfirm).toContain("les membres que vous suivez et qui vous suivent");
    const settings = source("components/collection-settings-sheet.tsx");
    expect(settings).toContain("if (needsShareConfirmation(current.visibility, visibility)) setConfirmShare(true);");
    expect(settings.match(/applyVisibility\("friends"\)/g)).toHaveLength(1);
    expect(settings).toMatch(/confirmShare \? \(\s*<View style=\{styles\.confirm\} testID="confirmer-amis">/);
  });
});

describe("profil d'un ami : section « Collections »", () => {
  it("visible seulement avec au moins une collection montrée", () => {
    expect(friendSectionVisible({ enabled: true }, [])).toBe(false);
    expect(friendSectionVisible({ enabled: true }, null)).toBe(false);
    expect(friendSectionVisible({ enabled: true }, [{ id: "c1", name: "Cadeaux", itemCount: 3, coverUrl: null }])).toBe(true);
    expect(t.collections.openCollection("Cadeaux", 3)).toBe("Cadeaux, 3 envies");
    expect(t.collections.itemCount(1)).toBe("1 envie");
    const profile = source("app/(app)/profil.tsx");
    expect(profile).toContain("<FriendCollections userId={profile.id} displayName={profile.displayName} refreshKey={String(profile.isFollowing)} />");
    const friend = source("components/friend-collections.tsx");
    expect(friend).toContain('router.push({ pathname: "/collection-ami", params: { id: collection.id } })');
    expect(friend).toContain("hdUri={null} fallbackUri={collection.coverUrl}");
  });

  it("une envie d'un ami : toujours la copie de Spotto, sinon « Image indisponible » ; prix dans la langue de l'app", () => {
    expect(sharedItemImage({ imageUrl: "https://stockage/copie.jpg", imageThumbUrl: "https://stockage/copie-mini.jpg" })).toBe("https://stockage/copie-mini.jpg");
    expect(sharedItemImage({ imageUrl: null, imageThumbUrl: null })).toBeNull();
    // Espaces insécables d'Intl ramenées à des espaces simples.
    const price = (value: string | null) => value?.replace(/[\u00a0\u202f]/g, " ") ?? null;
    expect(price(sharedItemPrice({ priceMin: 129, currency: "EUR" }, "fr"))).toBe("129 €");
    expect(price(sharedItemPrice({ priceMin: 129.5, currency: "EUR" }, "en"))).toBe("€129.50");
    expect(sharedItemPrice({ priceMin: null, currency: "EUR" }, "fr")).toBeNull();
    const screen = source("app/(app)/collection-ami.tsx");
    expect(screen).toContain("image === null ? <ImageUnavailable");
    expect(screen).toContain("hdUri={null} fallbackUri={image}");
    expect(screen).toContain("isAffiliate={item.isAffiliate}");
    expect(screen).toContain("t.result.affiliateDisclosure");
  });

  it("« Garder » et « En parler » (la conversation avec l'ami, l'envie jointe d'avance ; seulement avec la messagerie)", () => {
    const screen = source("app/(app)/collection-ami.tsx");
    expect(screen).toContain("keepSharedItem(item.id)");
    expect(screen).toContain("result.alreadyKept ? t.collections.alreadyKept : t.collections.kept");
    expect(screen).toContain('params: { userId: owner.id, collectionItemId: item.id }');
    expect(screen).toContain("canTalk={messages.enabled}");
    const conversation = source("app/(app)/conversation.tsx");
    expect(conversation).toContain("fetchCollectionItem(collectionItemId)");
    // L'envie de l'ami part comme `collectionItemId` (lib/conversations.ts, attachmentFor).
    expect(conversation).toContain("...attachmentFor(wish)");
    expect(attachmentFor({ id: "ci-1", kind: "collectionItem" })).toEqual({ collectionItemId: "ci-1" });
  });
});

describe("textes FR / EN", () => {
  it("les deux catalogues ont les mêmes clés pour les collections", () => {
    expect(Object.keys(en.collections)).toEqual(Object.keys(fr.collections));
    expect(Object.keys(en.wishlist)).toEqual(Object.keys(fr.wishlist));
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(collectionChips({ enabled: true }, [collection({ visibility: "friends" })])!.map((chip) => chip.label)).toEqual(["All", "Cadeaux"]);
    expect(t.collections.addToCollection).toBe("Add to a collection");
    expect(visibilityOptions().map((option) => option.label)).toEqual(["Private", "My friends"]);
    expect(t.collections.shareConfirm).toContain("Never your notes.");
    expect(t.collections.itemCount(1)).toBe("1 wish");
    expect(t.collections.itemCount(3)).toBe("3 wishes");
    expect(t.collections.talk).toBe("Talk about it");
    expect(t.wishlist.privateNoteCollections).toBe("Your Wishlist is private, except the wishes you put in a collection shown to your friends.");
  });

  it("vouvoiement en français", () => {
    const texts = Object.values(fr.collections).map((value) => (typeof value === "function" ? (value as (...args: unknown[]) => string)("Alexis", "Cadeaux", 2) : value));
    for (const text of texts) expect(String(text)).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
    expect(fr.collections.keep).toBe("Garder");
    expect(fr.collections.talk).toBe("En parler");
    expect(fr.collections.all).toBe("Toutes");
  });
});
