import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage, ConversationReadReceipts, ConversationThread, SendMessageResponse } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { mergeMessages } from "../src/lib/conversations";
import { lastOwnMessage, readReadReceipts, receiptMention, receiptStatus, sameReceipts, threadAfterPoll, threadAfterSend, withReadReceipts } from "../src/lib/read-receipts";

// Lot « messages vus » : « Vu » ou « Envoyé » sous son dernier message. La
// logique de l'écran, sans rendu (lib/read-receipts.ts) : quelle mention, sous
// quel message, tenue à jour à chaque relecture et après un envoi ; puis
// l'écran lu comme du texte, et les textes FR / EN.

afterEach(() => {
  setActiveLocale("fr");
});

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

const message = (id: string, createdAt: string, mine: boolean): ChatMessage => ({ id, mine, text: id, wish: null, createdAt });
// Dates telles que la base les écrit (microsecondes, « +00:00 »).
const MINE_1 = message("m1", "2026-11-17T10:00:00.120000+00:00", true);
const THEIRS = message("t1", "2026-11-17T10:05:00.000000+00:00", false);
const MINE_2 = message("m2", "2026-11-17T10:10:00.123456+00:00", true);
const seen = (seenAt: string | null): ConversationReadReceipts => ({ seenAt });

const thread = (overrides: Partial<ConversationThread> = {}): ConversationThread => ({
  id: "c1",
  other: { id: "u2", username: "alexis", displayName: "Alexis", avatarUrl: null },
  state: "open",
  sendMode: "direct",
  messages: [MINE_1],
  hasOlder: true,
  readReceipts: seen(null),
  ...overrides,
});

describe("« Vu » ou « Envoyé » : la règle", () => {
  it("« Vu » quand l'autre membre a ouvert la conversation au moment du message ou après, « Envoyé » sinon", () => {
    const sentAt = MINE_2.createdAt;
    expect(receiptStatus(seen(null), sentAt)).toBe("sent");
    expect(receiptStatus(seen("2026-11-17T10:09:59.999Z"), sentAt)).toBe("sent");
    expect(receiptStatus(seen("2026-11-17T10:10:00.122Z"), sentAt)).toBe("sent");
    // Le même instant (le serveur écrit des millisecondes, la base des microsecondes).
    expect(receiptStatus(seen("2026-11-17T10:10:00.123Z"), sentAt)).toBe("seen");
    expect(receiptStatus(seen(sentAt), sentAt)).toBe("seen");
    expect(receiptStatus(seen("2026-11-17T10:10:00.124Z"), sentAt)).toBe("seen");
    expect(receiptStatus(seen("2026-11-18T08:00:00+00:00"), sentAt)).toBe("seen");
  });

  it("compare des instants, jamais des textes (fuseau, nombre de chiffres après la seconde)", () => {
    // 12 h à Paris l'hiver = 11 h en temps universel : avant un message de 11 h 30.
    expect(receiptStatus(seen("2026-11-17T12:00:00+01:00"), "2026-11-17T11:30:00+00:00")).toBe("sent");
    expect(receiptStatus(seen("2026-11-17T12:31:00+01:00"), "2026-11-17T11:30:00+00:00")).toBe("seen");
    // « .9 » (900 ms) est après « .85 » (850 ms), et « .5 » égale « .500000 ».
    expect(receiptStatus(seen("2026-11-17T10:00:00.85Z"), "2026-11-17T10:00:00.9+00:00")).toBe("sent");
    expect(receiptStatus(seen("2026-11-17T10:00:00.5Z"), "2026-11-17T10:00:00.500000+00:00")).toBe("seen");
    expect(receiptStatus(seen("2026-11-17T10:00:00Z"), "2026-11-17T10:00:00.000001+00:00")).toBe("seen");
  });

  it("rien à afficher sans confirmations (null, absent), ni avec une date illisible", () => {
    expect(receiptStatus(null, MINE_2.createdAt)).toBeNull();
    expect(receiptStatus(undefined, MINE_2.createdAt)).toBeNull();
    expect(receiptStatus(seen("hier"), MINE_2.createdAt)).toBeNull();
    expect(receiptStatus(seen("2026-11-17T10:10:00Z"), "illisible")).toBeNull();
  });
});

describe("sous quel message", () => {
  it("votre dernier message, même si l'autre membre a écrit ensuite ; aucun message de vous : rien", () => {
    expect(lastOwnMessage([MINE_1, THEIRS, MINE_2])?.id).toBe("m2");
    expect(lastOwnMessage([MINE_1, THEIRS])?.id).toBe("m1");
    expect(lastOwnMessage([THEIRS])).toBeNull();
    expect(lastOwnMessage([])).toBeNull();
  });

  it("une seule mention : « Envoyé » puis « Vu », avec ce que lit VoiceOver", () => {
    const messages = [MINE_1, THEIRS, MINE_2];
    expect(receiptMention(messages, seen(null), "Alexis")).toEqual({ messageId: "m2", status: "sent", text: "Envoyé", label: "Votre dernier message est envoyé" });
    // Alexis a lu le premier message, pas encore le dernier.
    expect(receiptMention(messages, seen("2026-11-17T10:04:00Z"), "Alexis")).toMatchObject({ messageId: "m2", text: "Envoyé" });
    expect(receiptMention(messages, seen("2026-11-17T10:12:00Z"), "Alexis")).toEqual({ messageId: "m2", status: "seen", text: "Vu", label: "Votre dernier message a été vu par Alexis" });
    // Votre dernier message est suivi d'une réponse : la mention reste sous le vôtre.
    expect(receiptMention([MINE_1, THEIRS], seen("2026-11-17T10:04:00Z"), "Alexis")).toMatchObject({ messageId: "m1", text: "Vu" });
  });

  it("le serveur renvoie la date du dernier de VOS messages qui a été vu (jamais l'heure de la lecture) : « Vu » sous ce message, « Envoyé » sous un message d'après", () => {
    // Votre dernier message a été vu : sa propre date, telle que la base l'écrit.
    expect(receiptMention([MINE_1, THEIRS, MINE_2], seen(MINE_2.createdAt), "Alexis")).toMatchObject({ messageId: "m2", status: "seen", text: "Vu" });
    expect(receiptMention([MINE_1], seen(MINE_1.createdAt), "Alexis")).toMatchObject({ messageId: "m1", status: "seen" });
    // Seul le précédent a été vu (réponse arrivée juste avant votre nouvel envoi) : « Envoyé ».
    expect(receiptMention([MINE_1, THEIRS, MINE_2], seen(MINE_1.createdAt), "Alexis")).toMatchObject({ messageId: "m2", status: "sent", text: "Envoyé" });
  });

  it("rien quand le serveur ne renvoie pas de confirmations (invitation, réglage éteint, ancien serveur), ni sans message de vous", () => {
    const messages = [MINE_1, THEIRS, MINE_2];
    expect(receiptMention(messages, null, "Alexis")).toBeNull();
    expect(receiptMention(messages, undefined, "Alexis")).toBeNull();
    expect(receiptMention([THEIRS], seen("2026-11-17T10:12:00Z"), "Alexis")).toBeNull();
    expect(receiptMention([], seen(null), "Alexis")).toBeNull();
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(receiptMention([MINE_1], seen(null), "Alexis")).toMatchObject({ text: "Sent", label: "Your last message has been sent" });
    expect(receiptMention([MINE_1], seen("2026-11-17T10:04:00Z"), "Alexis")).toMatchObject({ text: "Seen", label: "Alexis has seen your last message" });
  });
});

describe("réponse du serveur, relue sans lui faire confiance", () => {
  it("absente (serveur plus ancien), null ou illisible : rien à afficher, jamais « Envoyé » par défaut", () => {
    for (const value of [undefined, null, "oui", 3, [], {}, { seenAt: 5 }, { seenAt: "hier" }, { seenAt: undefined }, { seen: true }]) {
      expect(readReadReceipts(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("pas encore lue, ou lue à telle date : gardée telle quelle, sans champ en trop", () => {
    expect(readReadReceipts({ seenAt: null })).toEqual({ seenAt: null });
    expect(readReadReceipts({ seenAt: "2026-11-17T10:12:00.123456+00:00", autre: "x" })).toEqual({ seenAt: "2026-11-17T10:12:00.123456+00:00" });
    expect(withReadReceipts(thread({ readReceipts: undefined })).readReceipts).toBeNull();
    expect(withReadReceipts(thread({ readReceipts: seen(null) })).readReceipts).toEqual({ seenAt: null });
  });

  it("deux réponses disent la même chose, ou non", () => {
    expect(sameReceipts(null, null)).toBe(true);
    expect(sameReceipts(undefined, null)).toBe(true);
    expect(sameReceipts(seen(null), seen(null))).toBe(true);
    expect(sameReceipts(seen("a"), seen("a"))).toBe(true);
    expect(sameReceipts(null, seen(null))).toBe(false);
    expect(sameReceipts(seen(null), null)).toBe(false);
    expect(sameReceipts(seen(null), seen("a"))).toBe(false);
    expect(sameReceipts(seen("a"), seen("b"))).toBe(false);
  });
});

describe("tenu à jour à chaque relecture, et après un envoi", () => {
  const mention = (current: ConversationThread, messages: ChatMessage[]) => receiptMention(messages, current.readReceipts, current.other.displayName)?.text ?? null;

  it("une relecture suit le serveur pour l'autre membre, l'état, ce qu'on peut écrire et les confirmations ; le reste ne bouge pas", () => {
    const current = thread();
    const polled = thread({
      id: "c1",
      other: { id: "u2", username: "alexis", displayName: "Alexis M.", avatarUrl: "https://exemple.test/a.jpg" },
      messages: [],
      hasOlder: false,
      readReceipts: seen("2026-11-17T10:01:00Z"),
    });
    const next = threadAfterPoll(current, polled);
    expect(next).toEqual({ ...current, other: polled.other, readReceipts: { seenAt: "2026-11-17T10:01:00Z" } });
    // Les messages affichés et « messages précédents » viennent de l'écran, pas de la relecture.
    expect(next.messages).toBe(current.messages);
    expect(next.hasOlder).toBe(true);
    // Première relecture sans conversation à l'écran : celle du serveur, confirmations relues.
    expect(threadAfterPoll(null, { ...polled, readReceipts: undefined })).toEqual({ ...polled, readReceipts: null });
  });

  it("« Envoyé » devient « Vu » à la relecture qui suit la lecture ; rien dès que le serveur ne renvoie plus de confirmations", () => {
    let current = withReadReceipts(thread());
    const messages = [MINE_1];
    expect(mention(current, messages)).toBe("Envoyé");
    // Relecture sans nouveauté : toujours « Envoyé ».
    current = threadAfterPoll(current, thread({ messages: [], readReceipts: seen(null) }));
    expect(mention(current, messages)).toBe("Envoyé");
    // Alexis ouvre la conversation.
    current = threadAfterPoll(current, thread({ messages: [], readReceipts: seen("2026-11-17T10:02:00.000Z") }));
    expect(mention(current, messages)).toBe("Vu");
    // L'un des deux éteint « Confirmations de lecture » : plus rien.
    current = threadAfterPoll(current, thread({ messages: [], readReceipts: null }));
    expect(mention(current, messages)).toBeNull();
    // Un serveur plus ancien (champ absent) : rien non plus.
    const { readReceipts: _absent, ...old } = thread({ messages: [] });
    current = threadAfterPoll(current, old);
    expect(current.readReceipts).toBeNull();
    expect(mention(current, messages)).toBeNull();
    // Rallumé : la mention revient.
    current = threadAfterPoll(current, thread({ messages: [], readReceipts: seen("2026-11-17T10:02:00.000Z") }));
    expect(mention(current, messages)).toBe("Vu");
  });

  it("un nouveau message de vous, vu à la relecture : la mention passe sous lui, « Envoyé » jusqu'à la lecture suivante", () => {
    let current = withReadReceipts(thread({ readReceipts: seen("2026-11-17T10:02:00Z") }));
    let messages = [MINE_1];
    expect(receiptMention(messages, current.readReceipts, "Alexis")).toMatchObject({ messageId: "m1", text: "Vu" });
    messages = mergeMessages(messages, [THEIRS, MINE_2]);
    current = threadAfterPoll(current, thread({ messages: [THEIRS, MINE_2], readReceipts: seen("2026-11-17T10:02:00Z") }));
    expect(receiptMention(messages, current.readReceipts, "Alexis")).toMatchObject({ messageId: "m2", text: "Envoyé" });
    current = threadAfterPoll(current, thread({ messages: [], readReceipts: seen("2026-11-17T10:11:00Z") }));
    expect(receiptMention(messages, current.readReceipts, "Alexis")).toMatchObject({ messageId: "m2", text: "Vu" });
  });

  it("après un envoi : l'identifiant, l'état et les confirmations renvoyés avec le message", () => {
    const sent: SendMessageResponse = { conversationId: "c9", message: MINE_2, state: "open", sendMode: "direct", readReceipts: seen("2026-11-17T10:02:00Z") };
    const before = thread({ id: null, state: "new", readReceipts: null, messages: [], hasOlder: false });
    const next = threadAfterSend(before, sent);
    expect(next).toEqual({ ...before, id: "c9", state: "open", sendMode: "direct", readReceipts: { seenAt: "2026-11-17T10:02:00Z" } });
    expect(receiptMention([MINE_2], next.readReceipts, "Alexis")).toMatchObject({ messageId: "m2", text: "Envoyé" });
    // Une invitation envoyée, ou un serveur plus ancien : aucune mention.
    expect(threadAfterSend(before, { ...sent, state: "invitation_sent", sendMode: "waiting", readReceipts: null }).readReceipts).toBeNull();
    const { readReceipts: _absent, ...old } = sent;
    expect(threadAfterSend(thread(), old).readReceipts).toBeNull();
  });
});

describe("l'écran de la conversation (lu comme du texte)", () => {
  const screen = read("app/(app)/conversation.tsx");

  it("les confirmations suivent le serveur à l'ouverture, à chaque relecture et après un envoi", () => {
    expect(screen).toContain("setThread(withReadReceipts(data));");
    expect(screen).toContain("setThread((current) => threadAfterPoll(current, data));");
    expect(screen).toContain("setThread((current) => (current ? threadAfterSend(current, sent) : current));");
    // « Vu » qui apparaît garde la relecture rapide, comme un nouveau message.
    expect(screen).toContain("const receiptsChanged = !sameReceipts(thread?.readReceipts, readReadReceipts(data.readReceipts));");
    expect(screen).toMatch(/const changed = [^;]*\|\| receiptsChanged;/);
    // Nulle part l'écran ne décide lui-même : tout passe par lib/read-receipts.ts.
    expect(screen).not.toContain("seenAt");
  });

  it("une seule mention, sous votre dernier message, lue par VoiceOver, sur une ligne de hauteur fixe", () => {
    expect(screen).toContain("const receipt = receiptMention(messages, thread.readReceipts, other.displayName);");
    const block = /\{receipt\?\.messageId === message\.id \? \(\s*<Text ([^>]*)>\s*\{receipt\.text\}\s*<\/Text>\s*\) : null\}/.exec(screen);
    expect(block).not.toBeNull();
    const props = block![1]!;
    expect(props).toContain("style={styles.receipt}");
    expect(props).toContain("numberOfLines={1}");
    expect(props).toContain("accessibilityLabel={receipt.label}");
    // Sur le site, le passage à « Vu » est annoncé sans interrompre.
    expect(props).toContain('accessibilityLiveRegion="polite"');
    // Sous la bulle, dans le bloc du message (jamais dans la bulle, qui ne change pas).
    expect(screen).toMatch(/<View key=\{message\.id\}>\s*<Bubble message=\{message\} onOptions=\{\(\) => setMenuFor\(message\)\} \/>\s*\{\/\*[^*]*\*\/\}\s*\{receipt\?\.messageId === message\.id \? \(/);
    // « Envoyé » et « Vu » occupent la même ligne : rien ne bouge quand l'un remplace l'autre.
    expect(screen).toContain('receipt: { alignSelf: "flex-end", marginTop: 2, lineHeight: 18, fontSize: font.caption, color: color.acier },');
    // Aucun texte en dur : les deux mentions viennent des catalogues.
    expect(screen).not.toMatch(/>\s*(Vu|Envoyé|Seen|Sent)\s*</);
  });
});

describe("textes FR / EN", () => {
  it("« Vu » / « Seen », « Envoyé » / « Sent », et leurs libellés pour VoiceOver", () => {
    expect(fr.messages.receiptSeen).toBe("Vu");
    expect(fr.messages.receiptSent).toBe("Envoyé");
    expect(en.messages.receiptSeen).toBe("Seen");
    expect(en.messages.receiptSent).toBe("Sent");
    expect(fr.messages.receiptSeenLabel("Alexis")).toBe("Votre dernier message a été vu par Alexis");
    expect(fr.messages.receiptSentLabel).toBe("Votre dernier message est envoyé");
    expect(en.messages.receiptSeenLabel("Alexis")).toBe("Alexis has seen your last message");
    expect(en.messages.receiptSentLabel).toBe("Your last message has been sent");
  });
});
