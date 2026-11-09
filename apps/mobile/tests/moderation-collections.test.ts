import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectionSummary, ModerationPreview } from "@monapp/shared-types";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import {
  canReportCollection,
  collectionChips,
  collectionState,
  collectionsStatus,
  onCollectionsStatus,
  readCollectionsStatus,
  setCollectionsStatus,
  shareBlockedByModeration,
  withoutCollection,
} from "../src/lib/collections";
import { collectionPreviewView, hideRestoreLabels, moderationNoticeLines, systemNotificationLines } from "../src/lib/moderation-labels";
import { isContentReport, reportMenuLabel, reportRequest } from "../src/lib/report-target";

// Lot modération des collections (migration 0034 ; règle 1.2 d'Apple) :
// « Signaler » la collection d'un ami (écran de la collection et section du
// profil), la collection masquée vue par son auteur, ce que lit
// l'administrateur, les notifications, et les textes FR / EN. La logique
// sans rendu, et le branchement des écrans (comme tests/collections.test.ts).

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => {
  setActiveLocale("fr");
  setCollectionsStatus({ enabled: false, reportable: false });
});

const ALICE = "alice";
const BOB = "bob";

const collectionPreview = (overrides: Partial<Extract<ModerationPreview, { kind: "collection" }>> = {}): Extract<ModerationPreview, { kind: "collection" }> => ({
  kind: "collection",
  author: { id: ALICE, username: "alice", displayName: "Alice", avatarUrl: null, suspended: false },
  name: "Cadeaux",
  visibility: "friends",
  itemCount: 9,
  items: [
    { id: "i1", title: "Sac cabas", imageUrl: "https://stockage/copie-1.jpg", imageRemoved: false, canRemoveImage: true },
    { id: "i2", title: "Foulard", imageUrl: null, imageRemoved: true, canRemoveImage: false },
    { id: "i3", title: "Montre", imageUrl: null, imageRemoved: false, canRemoveImage: false },
  ],
  createdAt: "2026-11-09T10:00:00.000000+00:00",
  hidden: false,
  ...overrides,
});

describe("« Signaler » : seulement si le serveur le permet, jamais sa propre collection", () => {
  it("lu sur le serveur : sans 0034, un ancien serveur ou une réponse illisible, pas de « Signaler »", () => {
    expect(readCollectionsStatus({ enabled: true, reportable: true })).toEqual({ enabled: true, reportable: true });
    expect(readCollectionsStatus({ enabled: true, reportable: false })).toEqual({ enabled: true, reportable: false });
    expect(readCollectionsStatus({ enabled: true })).toEqual({ enabled: true, reportable: false });
    // Sans les collections, rien à signaler.
    expect(readCollectionsStatus({ enabled: false, reportable: true })).toEqual({ enabled: false, reportable: false });
    expect(readCollectionsStatus({ enabled: true, reportable: "oui" })).toEqual({ enabled: true, reportable: false });
  });

  it("une collection d'un ami, avec le serveur qui le permet ; jamais la sienne, ni sans session", () => {
    const ready = { enabled: true, reportable: true };
    expect(canReportCollection(ready, ALICE, BOB)).toBe(true);
    expect(canReportCollection(ready, ALICE, ALICE)).toBe(false);
    expect(canReportCollection(ready, ALICE, null)).toBe(false);
    expect(canReportCollection(ready, ALICE, undefined)).toBe(false);
    expect(canReportCollection({ enabled: true, reportable: false }, ALICE, BOB)).toBe(false);
    expect(canReportCollection({ enabled: true }, ALICE, BOB)).toBe(false);
  });

  it("l'état est partagé entre les écrans : prévenus aussi quand « Signaler » apparaît", () => {
    const seen: (boolean | undefined)[] = [];
    const stop = onCollectionsStatus((status) => seen.push(status.reportable));
    setCollectionsStatus({ enabled: true, reportable: false });
    setCollectionsStatus({ enabled: true, reportable: true });
    setCollectionsStatus({ enabled: true, reportable: true });
    stop();
    expect(seen).toEqual([false, true]);
    expect(collectionsStatus()).toEqual({ enabled: true, reportable: true });
  });

  it("le menu « Signaler / Bloquer » envoie une demande « collection », avec le motif choisi", () => {
    const target = { userId: ALICE, collectionId: "c1" };
    expect(reportRequest(target, "harassment")).toEqual({ targetType: "collection", targetId: "c1", reason: "harassment" });
    expect(reportMenuLabel(target)).toBe("Signaler cette collection");
    expect(isContentReport(target)).toBe(true);
    // Les autres contenus ne changent pas.
    expect(reportRequest({ userId: ALICE, messageId: "m1" }, "spam")).toEqual({ targetType: "message", targetId: "m1", reason: "spam" });
    expect(reportRequest({ userId: ALICE, postId: "p1" }, "spam")).toEqual({ targetType: "post", targetId: "p1", reason: "spam" });
    expect(reportRequest({ userId: ALICE }, "other")).toEqual({ targetType: "user", targetId: ALICE, reason: "other" });
    expect(isContentReport({ userId: ALICE })).toBe(false);
    expect(reportMenuLabel({ userId: ALICE })).toBe("Signaler ce profil");
  });
});

describe("écran de la collection d'un ami et section du profil", () => {
  it("écran : « … » (seulement si on peut la signaler) ouvre le menu ; signalée ou auteur bloqué, retour en arrière", () => {
    const screen = source("app/(app)/collection-ami.tsx");
    expect(screen).toContain("canReportCollection(collections, page.collection.owner.id, session?.user.id)");
    expect(screen).toMatch(/state === "ready" && reportable \? \(\s*<Pressable onPress=\{\(\) => setMenuOpen\(true\)\}/);
    expect(screen).toContain("accessibilityLabel={t.collections.options}");
    expect(screen).toMatch(/<ReportBlockMenu[\s\S]*?userId=\{collection\.owner\.id\}[\s\S]*?collectionId=\{collection\.id\}[\s\S]*?onReported=\{goBack\}[\s\S]*?onBlocked=\{goBack\}/);
  });

  it("profil : un bouton « … » à part sur chaque collection ; signalée, elle sort aussitôt de la section", () => {
    const section = source("components/friend-collections.tsx");
    expect(section).toContain("canReportCollection(status, userId, session?.user.id)");
    expect(section).toContain("accessibilityLabel={t.collections.optionsLabel(collection.name)}");
    expect(section).toContain("collectionId={menuFor?.id}");
    expect(section).toContain("setCollections((current) => withoutCollection(current, reportedId))");
    // Le bouton « … » n'est jamais dans celui qui ouvre la collection (deux boutons voisins).
    expect(section).toMatch(/<\/Pressable>\s*\{\/\* Un bouton à part/);
    const list = [
      { id: "c1", name: "Cadeaux", itemCount: 2, coverUrl: null },
      { id: "c2", name: "Été", itemCount: 1, coverUrl: null },
    ];
    expect(withoutCollection(list, "c1")).toEqual([list[1]]);
    expect(withoutCollection(null, "c1")).toBeNull();
    expect(t.collections.optionsLabel("Cadeaux")).toBe("Options de la collection Cadeaux : la signaler, bloquer ce compte");
  });

  it("le toast dit que la collection ne sera plus montrée", () => {
    expect(source("components/report-block-menu.tsx")).toContain("showToast(content && onReported ? t.accountSafety.reportedHidden : t.moderation.reportSuccess);");
    expect(t.accountSafety.reportedHidden).toBe("Signalement envoyé. Ce contenu ne vous sera plus montré.");
  });
});

describe("collection masquée, vue par son auteur", () => {
  const own = (overrides: Partial<CollectionSummary>): CollectionSummary => ({
    id: "c1",
    name: "Cadeaux",
    visibility: "friends",
    itemCount: 2,
    createdAt: "2026-11-09T10:00:00.000000+00:00",
    hidden: false,
    ...overrides,
  });

  it("« Masquée par la modération » sous les puces et sur la puce ; jamais « Amis »", () => {
    expect(collectionState(own({ hidden: true }))).toBe("Masquée par la modération : vos amis ne la voient plus.");
    expect(collectionState(own({}))).toBe("Visible par vos amis (les membres que vous suivez et qui vous suivent).");
    // Ancien serveur : `hidden` absent.
    expect(collectionState({ visibility: "private" })).toBe("Privée : vous seul la voyez.");
    const chips = collectionChips({ enabled: true }, [own({ hidden: true })])!;
    expect(chips[1]).toMatchObject({ hidden: true, shared: false, accessibilityLabel: "Cadeaux, masquée par la modération" });
    const panel = source("components/wishlist-panel.tsx");
    expect(panel).toContain("{chip.hidden ? ` · ${t.collections.hiddenBadge}` : chip.shared ? ` · ${t.collections.sharedBadge}` : \"\"}");
    expect(panel).toContain("{collectionState(selected)}");
  });

  it("« Mes amis » refusé tant qu'elle est masquée (le serveur le refuse aussi) ; « Privée » reste possible", () => {
    expect(shareBlockedByModeration(own({ hidden: true }), "friends")).toBe(true);
    expect(shareBlockedByModeration(own({ hidden: true }), "private")).toBe(false);
    expect(shareBlockedByModeration(own({}), "friends")).toBe(false);
    const settings = source("components/collection-settings-sheet.tsx");
    expect(settings).toMatch(/if \(shareBlockedByModeration\(current, visibility\)\) \{\s*setError\(t\.collections\.hiddenCannotShare\);\s*return;/);
    expect(settings).toContain("{collectionState(current)}");
  });
});

describe("file de modération : une collection signalée", () => {
  it("son nom, qui la voit, ses dernières envies (copie, « Image retirée ») et « Retirer l'image » pour celles qui ont une copie", () => {
    const view = collectionPreviewView(collectionPreview());
    expect(view.name).toBe("Cadeaux");
    expect(view.visibility).toBe("Montrée à ses amis");
    expect(view.itemsTitle).toBe("Dernières envies ajoutées (3 sur 9)");
    expect(view.items).toEqual([
      { id: "i1", title: "Sac cabas", imageUrl: "https://stockage/copie-1.jpg", removedLabel: null, removeLabel: "Retirer l'image de Sac cabas" },
      { id: "i2", title: "Foulard", imageUrl: null, removedLabel: "Image retirée", removeLabel: null },
      { id: "i3", title: "Montre", imageUrl: null, removedLabel: null, removeLabel: null },
    ]);
    expect(collectionPreviewView(collectionPreview({ items: [], itemCount: 0, visibility: "private" }))).toMatchObject({
      itemsTitle: "Aucune envie dans cette collection.",
      visibility: "Privée : son auteur seul la voit",
    });
    expect(hideRestoreLabels("collection")).toEqual({ hide: "Masquer la collection", restore: "Rétablir la collection" });
    expect(t.moderationQueue.target.collection).toBe("Collection d'envies");
  });

  it("la carte : aperçu de la collection, « Retirer l'image » envie par envie (itemId envoyé), masquer, rétablir, suspendre", () => {
    const card = source("components/moderation-item.tsx");
    expect(card).toContain('preview.kind === "collection" ? (\n        <CollectionExtract preview={preview} busy={busy} onRemoveImage={onRemoveItemImage} />');
    expect(card).toContain("const view = collectionPreviewView(preview);");
    expect(card).toContain("removeCopiedImage({ targetType, targetId: item.targetId, itemId, ...extra })");
    expect(card).toContain("warning={t.moderationQueue.removeItemImageWarning}");
    expect(card).toContain("subject={itemToClear.title}");
    expect(card).toContain('hideRestoreLabels(content?.kind ?? "comment")');
    expect(t.moderationQueue.removeItemImageWarning).toContain("cette décision ne s'annule pas");
    expect(t.moderationQueue.removeItemImageWarning).toContain("« droits sur l'image »");
  });
});

describe("notifications", () => {
  it("l'auteur : masquée, rétablie, image retirée (motif neutre) ; celui qui a signalé : « traité », jamais la décision", () => {
    expect(moderationNoticeLines({ action: "hide", targetType: "collection", reason: "inappropriate", note: "Nom blessant" })).toEqual([
      "Une de vos collections a été masquée par la modération : vos amis ne la voient plus.",
      "Motif : Contenu inapproprié",
      "Précision : « Nom blessant »",
    ]);
    expect(moderationNoticeLines({ action: "restore", targetType: "collection", reason: null, note: null })).toEqual(["Une de vos collections n'est plus masquée par la modération."]);
    expect(moderationNoticeLines({ action: "remove_image", targetType: "collection", reason: "image_rights", note: null })).toEqual([
      "L'image d'une envie de votre collection a été retirée par la modération. Vos amis voient l'envie sans son image.",
      "Motif : Droits sur l'image",
    ]);
    expect(moderationNoticeLines({ action: "suspend", targetType: "collection", reason: "spam", note: null })[0]).toMatch(/^Votre compte a été suspendu/);
    expect(
      systemNotificationLines({ id: "n1", type: "report_handled", actor: null, createdAt: "2026-11-09T10:00:00.000Z", read: false, postId: null, moderation: null, reportedType: "collection" })
    ).toEqual(["Votre signalement d'une collection a été traité. Merci."]);
  });
});

describe("textes FR / EN", () => {
  it("mêmes clés dans les deux langues", () => {
    expect(Object.keys(en.collections)).toEqual(Object.keys(fr.collections));
    expect(Object.keys(en.moderationQueue)).toEqual(Object.keys(fr.moderationQueue));
    expect(Object.keys(en.moderationQueue.target)).toEqual(Object.keys(fr.moderationQueue.target));
    expect(Object.keys(en.notifications.reportHandledAbout)).toEqual(Object.keys(fr.notifications.reportHandledAbout));
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(reportMenuLabel({ userId: ALICE, collectionId: "c1" })).toBe("Report this collection");
    expect(collectionState({ visibility: "friends", hidden: true })).toBe("Hidden by moderation: your friends can no longer see it.");
    expect(collectionPreviewView(collectionPreview()).itemsTitle).toBe("Latest wishes added (3 of 9)");
    expect(moderationNoticeLines({ action: "hide", targetType: "collection", reason: "spam", note: null })[0]).toBe(
      "One of your collections was hidden by moderation: your friends can no longer see it."
    );
    expect(t.notifications.reportHandledAbout.collection).toBe("Your report about a collection has been reviewed. Thank you.");
    expect(t.moderationQueue.target.collection).toBe("Wish collection");
  });

  it("vouvoiement en français", () => {
    const texts = [
      fr.collections.report,
      fr.collections.options,
      fr.collections.optionsLabel("Cadeaux"),
      fr.collections.hiddenBadge,
      fr.collections.hiddenChipLabel("Cadeaux"),
      fr.collections.hiddenState,
      fr.collections.hiddenCannotShare,
      fr.notifications.reportHandledAbout.collection,
      fr.notifications.moderationHiddenCollection,
      fr.notifications.moderationRestoredCollection,
      fr.notifications.moderationImageRemovedCollection,
      fr.moderationQueue.hideCollection,
      fr.moderationQueue.restoreCollection,
      fr.moderationQueue.collectionItems(6, 9),
      fr.moderationQueue.collectionEmpty,
      fr.moderationQueue.removeItemImageLabel("Sac"),
      fr.moderationQueue.removeItemImageWarning,
      ...Object.values(fr.moderationQueue.collectionVisibility),
    ];
    for (const text of texts) expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
  });
});
