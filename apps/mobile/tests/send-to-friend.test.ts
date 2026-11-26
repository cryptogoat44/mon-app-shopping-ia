import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Piece } from "../src/api/types";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { attachedLabels, attachmentFor, readMessagesStatus } from "../src/lib/conversations";
import { SEND_TO_FRIEND_FROM, canSendToFriend, forgetPieceToSend, pieceToSend, sendToFriend } from "../src/lib/send-to-friend";

// « Envoyer à un ami » depuis l'écran Résultat : une proposition part dans une
// conversation privée sans passer par les Envies. Pas de rendu de composants
// ici (vitest.config.ts) : la logique, puis les fichiers des écrans lus,
// comme pour le tri des résultats (result-sort-screen.test.ts).
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const screen = read("app/(app)/spot/result.tsx");
const card = read("components/proposal-card.tsx");
const list = read("components/price-sorted-list.tsx");
const complement = read("components/result-complement.tsx");
const noPrice = read("components/no-price-section.tsx");
const link = read("components/send-to-friend-link.tsx");
const conversation = read("app/(app)/conversation.tsx");
const choose = read("app/(app)/choisir-conversation.tsx");

const piece = (overrides: Partial<Piece> = {}): Piece => ({
  id: "match-1",
  name: "Veste en daim marron",
  reference: null,
  material: null,
  imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste",
  priceFrom: 189,
  currency: "EUR",
  merchantName: "Boutique",
  merchantUrl: "https://boutique.example/veste",
  affiliateUrl: "https://boutique.example/veste",
  real: true,
  ...overrides,
});

/** Le corps d'une fonction de l'écran, jusqu'à la suivante. */
function body(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  return source.slice(from, source.indexOf(end, from + start.length));
}

afterEach(() => {
  setActiveLocale("fr");
  forgetPieceToSend();
});

describe("l'action n'apparaît qu'avec la messagerie", () => {
  it("cachée quand la messagerie est indisponible (serveur sans 0032, ancien serveur), ou pour une pièce de démonstration", () => {
    for (const status of [readMessagesStatus({ enabled: false, unreadCount: 0 }), readMessagesStatus(null), readMessagesStatus({ error: "messages_unavailable" })]) {
      expect(canSendToFriend(piece(), status)).toBe(false);
    }
    expect(canSendToFriend(piece({ real: false }), { enabled: true })).toBe(false);
    expect(canSendToFriend(piece({ real: undefined }), { enabled: true })).toBe(false);
    expect(canSendToFriend(piece(), readMessagesStatus({ enabled: true, unreadCount: 0 }))).toBe(true);
  });

  it("l'écran lit la disponibilité (GET /api/messages/status) et ne montre l'action que d'après canSendToFriend", () => {
    expect(screen).toContain("const messages = useMessagesStatus();");
    expect(screen).toContain("if (!messagesStatus().enabled) fetchMessagesStatus().catch(() => {});");
    // Grande carte : le lien seulement si l'action est possible.
    expect(screen).toContain(
      "{canSendToFriend(piece, messages) ? <SendToFriendLink style={styles.sendToFriend} pieceName={piece.name} onPress={handleSendToFriend} /> : null}"
    );
    // Retours du build 2 : plus aucun lien sur les cartes ni sur les lignes (voir plus bas).
    expect(card).not.toContain("SendToFriendLink");
  });
});

describe("l'action envoie la bonne pièce", () => {
  it("l'écran du choix s'ouvre avec la proposition (son identifiant seulement) ; titre, vignette et origine restent en mémoire", () => {
    const route = sendToFriend(piece({ id: "match-42" }), "price_list");
    expect(route).toEqual({ pathname: "/choisir-conversation", params: { matchId: "match-42" } });
    expect(JSON.stringify(route)).not.toContain("Veste");
    expect(pieceToSend("match-42")).toEqual({
      matchId: "match-42",
      title: "Veste en daim marron",
      imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste",
      from: "price_list",
    });
    expect(pieceToSend("match-1")).toBeNull();
    // Une autre carte touchée ensuite : c'est elle qui part.
    sendToFriend(piece({ id: "match-7", name: "Sac" }), "section");
    expect(pieceToSend("match-42")).toBeNull();
    expect(pieceToSend("match-7")).toMatchObject({ title: "Sac", from: "section" });
    forgetPieceToSend();
    expect(pieceToSend("match-7")).toBeNull();
  });

  it("titre trop long : coupé comme pour « Garder » (120 caractères)", () => {
    sendToFriend(piece({ name: "a".repeat(200) }), "big_card");
    expect(pieceToSend("match-1")?.title).toHaveLength(120);
  });

  it("le message part avec `matchId` (une seule carte à la fois)", () => {
    expect(attachmentFor({ id: "match-1", kind: "match" })).toEqual({ matchId: "match-1" });
    expect(attachmentFor({ id: "w-1" })).toEqual({ wishId: "w-1" });
    expect(attachmentFor({ id: "w-1", kind: "wish" })).toEqual({ wishId: "w-1" });
    expect(attachmentFor({ id: "ci-1", kind: "collectionItem" })).toEqual({ collectionItemId: "ci-1" });
    expect(attachmentFor(null)).toEqual({});
  });

  it("retours du build 2 : « Envoyer à un ami » n'est plus sur les cartes des grilles ni sur les lignes de la liste triée", () => {
    // Refusé : plus aucune action d'envoi passée aux listes, ni affichée par la carte.
    expect(card).not.toContain("onSend");
    expect(card).not.toContain("SendToFriendLink");
    expect(screen).not.toContain("sendFrom(");
    expect(screen).not.toContain("sendAction=");
    expect(screen).not.toContain("onSend=");
    for (const [name, source] of [
      ["liste triée", list],
      ["complément", complement],
      ["sans prix", noPrice],
    ] as const) {
      expect(source, name).not.toContain("sendAction");
      const cards = source.split("\n").filter((line) => line.includes("<ProposalCard"));
      expect(cards.length, name).toBe(1);
      expect(cards[0], name).toContain("piece={piece}");
      expect(cards[0], name).not.toContain("onSend");
    }
    // Permis : la grande carte garde son lien, un seul dans l'écran.
    expect(screen.match(/<SendToFriendLink/g)?.length).toBe(1);
    expect(screen).toContain("onPress={handleSendToFriend}");
  });

  it("le lien de la grande carte garde sa zone tactile et son libellé avec le nom de la pièce", () => {
    expect(link).toContain("accessibilityLabel={t.messages.sendToFriendLabel(pieceName)}");
    expect(link).toContain("minHeight: size.touchTarget");
  });

  it("la conversation joint la proposition et l'envoie, puis revient au résultat avec une courte confirmation", () => {
    expect(conversation).toContain('setWish({ id: matchId, title: piece?.title ?? t.messages.attachedPieceFallback, imageUrl: piece?.imageUrl ?? null, kind: "match" });');
    expect(conversation).toContain("...attachmentFor(wish) });");
    const success = body(conversation, 'if (wish?.kind === "match") {', "stickToEnd.current = true;");
    expect(success).toContain('track("piece_sent_to_friend", { from: pieceToSend(wish.id)?.from });');
    expect(success).toContain("showToast(");
    expect(success).toContain("router.back();");
    // Une erreur garde le message existant du serveur (rien de nouveau à inventer).
    expect(conversation).toContain("setSendError(e instanceof ApiError ? e.message : loadErrorMessage(e, t.messages.sendError));");
  });

  it("le choix d'une conversation (ou d'une autre personne) garde la proposition jusqu'à la conversation", () => {
    // (Lot « messages, plus de confort » : une publication du fil suit le même chemin.)
    expect(choose).toContain("const attached = wishId ? { wishId } : matchId ? { matchId } : postId ? { postId } : {};");
    expect(choose).toContain('router.replace({ pathname: "/conversation", params: { id: summary.id, ...attached } })');
    expect(choose).toContain('router.replace({ pathname: "/conversation", params: { userId: person.id, ...attached } })');
    expect(choose).toContain("{postId ? t.messageActions.chooseHintPost : matchId ? t.messages.chooseHintPiece : t.messages.chooseHint}");
  });
});

describe("la grande carte et la liste ne changent pas", () => {
  it("depuis la grande carte : la même pièce, retenue comme pour ses autres boutons (jamais une autre)", () => {
    const send = body(screen, "function handleSendToFriend(", "async function handleShare");
    expect(send).toContain('router.push(sendToFriend(piece, "big_card"));');
    expect(send).toContain("holdPiece();");
    for (const forbidden of ["updateChoice", "chooseCard", "selectPiece", "setPickedInPriceList", "scrollTo", "reveal"]) {
      expect(send, forbidden).not.toContain(forbidden);
    }
    // holdPiece garde la grande carte de ce moment (lib/price-first.ts, holdCard).
    expect(body(screen, "function holdPiece()", "async function handleOpenMerchant")).toContain("updateChoice((current) => holdCard(current, startIndex));");
  });

  it("les boutons de la grande carte restent liés à sa pièce", () => {
    expect(screen).toContain("const piece = result ? (allPieces(result)[selectedIndex] ?? null) : null;");
    for (const button of [
      "onPress={handleKeep} disabled={kept.has(piece.id)}",
      "onPress={openCategory} disabled={bought.has(piece.id)}",
      "onPress={handleShare}",
      // Lot « fidélité aux maquettes » : la case « Plus » de la rangée soudée.
      "{piece.real ? <ResultFeedbackButton onPress={openReport} style={actionCell(3)} /> : null}",
    ]) {
      expect(screen).toContain(button);
    }
    // Le lien « Envoyer à un ami » est sous les boutons de la grande carte, dans son bloc.
    const bigCard = body(screen, "{showBigCard ? (", "{!showBigCard && sheetActions.length > 0");
    expect(bigCard.indexOf("<SendToFriendLink")).toBeGreaterThan(bigCard.indexOf("<ResultFeedbackButton"));
  });
});

describe("statistiques : valeurs fermées seulement", () => {
  it("d'où la pièce part, jamais la pièce, le texte ni la personne", () => {
    expect(sanitizeProps("piece_sent_to_friend", { from: "section", title: "Veste", recipientId: "u-2", text: "Regarde" })).toEqual({ from: "section" });
    expect(sanitizeProps("piece_sent_to_friend", { from: "Veste en daim" })).toEqual({});
    expect(ANALYTICS_EVENTS.piece_sent_to_friend.from).toEqual({ kind: "enum", values: [...SEND_TO_FRIEND_FROM] });
  });
});

describe("textes FR / EN", () => {
  it("en français (vouvoiement) et en anglais", () => {
    expect(fr.messages.sendToFriend).toBe("Envoyer à un ami");
    expect(en.messages.sendToFriend).toBe("Send to a friend");
    expect(fr.messages.sendToFriendLabel("Veste")).toBe("Envoyer Veste à un ami");
    expect(en.messages.sendToFriendLabel("Jacket")).toBe("Send Jacket to a friend");
    expect(fr.messages.pieceSent("Alexis")).toBe("Pièce envoyée à Alexis");
    expect(en.messages.pieceSent("Alexis")).toBe("Piece sent to Alexis");
    expect(fr.messages.chooseHintPiece).toBe("Choisissez une conversation : la pièce y sera jointe, et vous pourrez ajouter un mot avant d'envoyer.");
    expect(attachedLabels({ title: "Veste", kind: "match" })).toEqual({ title: "Pièce jointe : Veste", remove: "Retirer la pièce jointe" });
    expect(attachedLabels({ title: "Sac" })).toEqual({ title: "Envie jointe : Sac", remove: "Retirer l'envie jointe" });
    setActiveLocale("en");
    expect(t.messages.sendToFriend).toBe("Send to a friend");
    expect(attachedLabels({ title: "Jacket", kind: "match" })).toEqual({ title: "Attached piece: Jacket", remove: "Remove the attached piece" });
  });
});
