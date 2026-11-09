import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGE_MAX_LENGTH, type ChatMessage, type ConversationSendMode, type ConversationSummary, type ModerationNotice } from "@monapp/shared-types";
import { setActiveLocale, t } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import {
  INITIAL_POLL,
  POLL_BASE_MS,
  POLL_ERROR_MAX_MS,
  POLL_IDLE_MAX_MS,
  activityUnread,
  canSend,
  canWrite,
  composerNotice,
  conversationPreview,
  hasNewFromOther,
  mergeMessages,
  messagesEntry,
  messagesStatus,
  newestCreatedAt,
  nextPoll,
  onMessagesStatus,
  readMessagesStatus,
  setMessagesStatus,
  unreadBadge,
  wishCardPrice,
} from "../src/lib/conversations";
import { moderationNoticeLines, systemNotificationLines } from "../src/lib/moderation-labels";

// Lot messages : messages privés entre membres. La logique des écrans, sans
// rendu (entrée « Messages » cachée sans la messagerie, liste et non-lus,
// invitations, envie jointe, relecture), et les textes FR / EN.

afterEach(() => {
  setActiveLocale("fr");
  setMessagesStatus({ enabled: false, unreadCount: 0 });
});

const summary = (overrides: Partial<ConversationSummary>): ConversationSummary => ({
  id: "c1",
  other: { id: "u2", username: "alexis", displayName: "Alexis", avatarUrl: null },
  state: "open",
  lastMessage: { text: "Bonjour", hasWish: false, mine: false, hidden: false, createdAt: "2026-11-08T10:00:00.000000+00:00" },
  lastMessageAt: "2026-11-08T10:00:00.000000+00:00",
  unread: false,
  ...overrides,
});

const message = (id: string, createdAt: string, mine = false): ChatMessage => ({ id, mine, text: id, wish: null, createdAt });

describe("entrée « Messages » de l'Activité", () => {
  it("cachée quand la messagerie n'est pas disponible (serveur sans 0032, ancien serveur, réponse illisible)", () => {
    for (const body of [{ enabled: false, unreadCount: 3 }, null, "Not Found", { error: "messages_unavailable" }, { enabled: "oui", unreadCount: 2 }]) {
      const status = readMessagesStatus(body);
      expect(status).toEqual({ enabled: false, unreadCount: 0 });
      expect(messagesEntry(status)).toBeNull();
    }
  });

  it("visible avec le nombre de conversations non lues", () => {
    expect(messagesEntry(readMessagesStatus({ enabled: true, unreadCount: 0 }))).toEqual({ label: "Messages", badge: null });
    expect(messagesEntry(readMessagesStatus({ enabled: true, unreadCount: 3 }))).toEqual({ label: "Messages, 3 conversations non lues", badge: "3" });
    expect(messagesEntry(readMessagesStatus({ enabled: true, unreadCount: 1 }))?.label).toBe("Messages, 1 conversation non lue");
    expect(unreadBadge(120)).toBe("99+");
    expect(readMessagesStatus({ enabled: true, unreadCount: -2 })).toEqual({ enabled: true, unreadCount: 0 });
  });

  it("la pastille de l'onglet Activité compte aussi les messages non lus, seulement quand la messagerie est là", () => {
    expect(activityUnread(2, { enabled: true, unreadCount: 3 })).toBe(5);
    expect(activityUnread(2, { enabled: false, unreadCount: 3 })).toBe(2);
  });

  it("l'état est partagé entre les écrans : prévenus seulement s'il change", () => {
    const seen: number[] = [];
    const stop = onMessagesStatus((status) => seen.push(status.unreadCount));
    setMessagesStatus({ enabled: true, unreadCount: 2 });
    setMessagesStatus({ enabled: true, unreadCount: 2 });
    setMessagesStatus({ enabled: true, unreadCount: 0 });
    stop();
    setMessagesStatus({ enabled: true, unreadCount: 9 });
    expect(seen).toEqual([2, 0]);
    expect(messagesStatus()).toEqual({ enabled: true, unreadCount: 9 });
  });

  it("l'écran Activité n'affiche l'entrée que d'après messagesEntry (jamais sans la messagerie)", () => {
    const source = readFileSync(join(__dirname, "../src/app/(app)/(tabs)/activite.tsx"), "utf8");
    expect(source).toContain("messagesEntry(useMessagesStatus())");
    expect(source).toMatch(/\{entry \? \(\s*<View style=\{styles\.entryWrap\}>\s*<MessagesEntry/);
  });
});

describe("liste des conversations", () => {
  it("aperçu : le texte, « Vous : » pour son propre message, une envie seule, un message indisponible", () => {
    expect(conversationPreview(summary({}))).toBe("Bonjour");
    expect(conversationPreview(summary({ lastMessage: { text: "Regarde", hasWish: true, mine: true, hidden: false, createdAt: "x" } }))).toBe("Vous : Regarde");
    expect(conversationPreview(summary({ lastMessage: { text: null, hasWish: true, mine: false, hidden: false, createdAt: "x" } }))).toBe("Envie partagée");
    expect(conversationPreview(summary({ lastMessage: { text: null, hasWish: false, mine: false, hidden: true, createdAt: "x" } }))).toBe("Message indisponible");
  });

  it("invitation envoyée : « en attente de réponse », jamais si elle a été refusée (rien ne le dit)", () => {
    const sent = summary({ state: "invitation_sent", lastMessage: { text: "Bonjour", hasWish: false, mine: true, hidden: false, createdAt: "x" } });
    expect(conversationPreview(sent)).toBe("Invitation envoyée, en attente de réponse");
  });

  it("libellé lu par VoiceOver : le nom, « non lu », l'aperçu", () => {
    expect(t.messages.rowLabel("Alexis", "Bonjour", true)).toBe("Alexis, non lu. Bonjour");
    expect(t.messages.rowLabel("Alexis", "Bonjour", false)).toBe("Alexis. Bonjour");
  });
});

describe("invitations : accepter, refuser, bloquer", () => {
  const modes: ConversationSendMode[] = ["direct", "invitation", "waiting", "answer", "not_allowed"];

  it("on n'écrit que dans une conversation ouverte, ou pour envoyer l'invitation", () => {
    expect(modes.filter(canWrite)).toEqual(["direct", "invitation"]);
  });

  it("chaque situation est expliquée sous la conversation", () => {
    expect(composerNotice("direct", "Alexis")).toBeNull();
    expect(composerNotice("invitation", "Alexis")).toBe(
      "Ce premier message est une invitation : Alexis pourra l'accepter ou la refuser. Vous ne pourrez plus écrire avant sa réponse."
    );
    expect(composerNotice("waiting", "Alexis")).toBe("Invitation envoyée. Vous pourrez écrire de nouveau quand Alexis l'aura acceptée.");
    expect(composerNotice("answer", "Alexis")).toBe("Alexis vous invite à discuter. Acceptez pour lui répondre.");
    expect(composerNotice("not_allowed", "Alexis")).toBe("Alexis ne reçoit pas de messages de votre part pour le moment.");
  });

  it("l'écran d'une invitation reçue propose Accepter, Refuser (confirmé) et Bloquer", () => {
    const source = readFileSync(join(__dirname, "../src/app/(app)/conversation.tsx"), "utf8");
    for (const text of ["t.messages.accept", "t.messages.decline", "t.messages.block", "t.messages.declineConfirm", "acceptInvitation(", "declineInvitation("]) {
      expect(source).toContain(text);
    }
    expect(t.messages.declineConfirm).toContain("sans que cette personne en soit prévenue");
  });

  it("signaler un message reçu passe par le menu « Signaler / Bloquer » existant", () => {
    const menu = readFileSync(join(__dirname, "../src/components/report-block-menu.tsx"), "utf8");
    expect(menu).toContain("await reportContent(reportRequest(target, reason));");
    // La demande elle-même : lib/report-target.ts (lot modération des collections).
    const target = readFileSync(join(__dirname, "../src/lib/report-target.ts"), "utf8");
    expect(target).toContain('{ targetType: "message", targetId: messageId, reason }');
    expect(t.messages.reportMessage).toBe("Signaler ce message");
  });
});

describe("envoi et envie jointe", () => {
  it("un texte non vide, ou une envie seule ; jamais au-delà de 1 000 caractères", () => {
    expect(canSend("   ", null, MESSAGE_MAX_LENGTH)).toBe(false);
    expect(canSend("   ", "envie-1", MESSAGE_MAX_LENGTH)).toBe(true);
    expect(canSend(" Bonjour ", null, MESSAGE_MAX_LENGTH)).toBe(true);
    expect(canSend("a".repeat(MESSAGE_MAX_LENGTH + 1), null, MESSAGE_MAX_LENGTH)).toBe(false);
    expect(canSend(` ${"a".repeat(MESSAGE_MAX_LENGTH)} `, null, MESSAGE_MAX_LENGTH)).toBe(true);
  });

  it("prix de la carte de l'envie, dans la langue de l'app", () => {
    expect(wishCardPrice({ priceMin: 129, currency: "EUR" }, "fr")).toBe("129 €");
    expect(wishCardPrice({ priceMin: 129.5, currency: "EUR" }, "en")).toBe("€129.50");
    expect(wishCardPrice({ priceMin: null, currency: "EUR" }, "fr")).toBeNull();
  });

  it("la carte montre la copie de Spotto (jamais l'image du marchand) et le lien de la boutique, mention affiliée comprise", () => {
    const card = readFileSync(join(__dirname, "../src/components/message-wish-card.tsx"), "utf8");
    expect(card).toContain("fallbackUri={card.imageThumbUrl}");
    expect(card).toContain("hdUri={null}");
    expect(card).toContain("t.result.affiliateDisclosure");
  });
});

describe("relecture (pas de temps réel)", () => {
  it("toutes les 5 s, puis plus lentement quand rien ne bouge (30 s au plus), et en cas d'échec (60 s au plus)", () => {
    expect(INITIAL_POLL.delay).toBe(POLL_BASE_MS);
    let state = INITIAL_POLL;
    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      state = nextPoll(state, "same");
      delays.push(state.delay);
    }
    expect(delays.slice(0, 2)).toEqual([5_000, 5_000]);
    expect(delays[2]).toBe(7_500);
    expect(Math.max(...delays)).toBe(POLL_IDLE_MAX_MS);
    expect(nextPoll(state, "new")).toEqual(INITIAL_POLL);
    let failing = INITIAL_POLL;
    for (let i = 0; i < 8; i += 1) failing = nextPoll(failing, "error");
    expect(failing.delay).toBe(POLL_ERROR_MAX_MS);
  });

  it("messages réunis sans doublon, dans l'ordre ; curseur de relecture ; nouveau message de l'autre", () => {
    const a = message("a", "2026-11-08T10:00:00.100000+00:00", true);
    const b = message("b", "2026-11-08T10:00:01.000000+00:00");
    const c = message("c", "2026-11-08T10:00:02.000000+00:00");
    const merged = mergeMessages([a, b], [b, c]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mergeMessages([c], [a]).map((m) => m.id)).toEqual(["a", "c"]);
    expect(newestCreatedAt(merged)).toBe(c.createdAt);
    expect(newestCreatedAt([])).toBeNull();
    expect(hasNewFromOther([a, b], merged)).toBe(true);
    expect(hasNewFromOther([a, b], [a, b, message("d", "2026-11-08T10:00:03Z", true)])).toBe(false);
  });
});

describe("textes FR / EN", () => {
  it("les deux catalogues ont les mêmes clés pour les messages", () => {
    expect(Object.keys(en.messages)).toEqual(Object.keys(fr.messages));
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(t.messages.title).toBe("Messages");
    expect(messagesEntry({ enabled: true, unreadCount: 2 })?.label).toBe("Messages, 2 unread conversations");
    expect(composerNotice("waiting", "Alexis")).toBe("Invitation sent. You'll be able to write again once Alexis accepts it.");
    expect(conversationPreview(summary({ lastMessage: { text: "Hi", hasWish: false, mine: true, hidden: false, createdAt: "x" } }))).toBe("You: Hi");
    expect(t.settings.messagesFromTitle).toBe("Who can write to me");
  });

  it("vouvoiement en français", () => {
    const texts = Object.values(fr.messages).map((value) => (typeof value === "function" ? (value as (...args: unknown[]) => string)("Alexis", "Bonjour", 2) : value));
    for (const text of texts) expect(String(text)).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
  });

  it("modération : message masqué ou rétabli, signalement d'un message traité", () => {
    const notice = (action: ModerationNotice["action"]): ModerationNotice => ({ action, targetType: "message", reason: "harassment", note: null });
    expect(moderationNoticeLines(notice("hide"))[0]).toBe("Un message que vous avez envoyé a été masqué par la modération.");
    expect(moderationNoticeLines(notice("restore"))[0]).toBe("Un message que vous avez envoyé a été rétabli.");
    expect(
      systemNotificationLines({ id: "n", type: "report_handled", actor: null, createdAt: "x", read: false, postId: null, moderation: null, reportedType: "message" })
    ).toEqual(["Votre signalement d'un message a été traité. Merci."]);
    setActiveLocale("en");
    expect(moderationNoticeLines(notice("hide"))[0]).toBe("A message you sent was hidden by moderation.");
  });
});
