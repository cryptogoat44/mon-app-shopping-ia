import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_LEVEL, type ChatMessage, type ConversationSummary } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import {
  applyChanges,
  asDeleted,
  attachedLabels,
  attachmentFor,
  conversationPreview,
  likeLabel,
  mergeMessages,
  messageActionsFor,
  nextSyncedAt,
  quoteText,
  readMessagesStatus,
  replyTargetOf,
  withLike,
  withoutContent,
} from "../src/lib/conversations";
import { SHEET_CLOSE_FALLBACK_MS, afterSheetClose } from "../src/lib/after-sheet-close";
import { lastOwnMessage, receiptMention } from "../src/lib/read-receipts";
import { sendPostHref } from "../src/lib/send-post";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";

// Lot « messages, plus de confort » (migration 0044) : aimer un message, y
// répondre, le supprimer, envoyer une publication. La logique de l'écran,
// sans rendu (lib/conversations.ts, lib/read-receipts.ts) ; puis les écrans
// lus comme du texte, les textes FR / EN et la politique de confidentialité.
// Les règles de confidentialité elles-mêmes sont tenues par le serveur
// (apps/backend/tests/messagerieConfort.test.ts) : l'app n'affiche que ce
// qu'il renvoie.

afterEach(() => {
  setActiveLocale("fr");
});

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

const message = (id: string, createdAt: string, mine: boolean, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  mine,
  text: id,
  wish: null,
  createdAt,
  liked: { mine: false, theirs: false },
  replyTo: null,
  post: null,
  ...extra,
});
const A = message("a", "2026-11-18T10:00:00.000000+00:00", true);
const B = message("b", "2026-11-18T10:01:00.000000+00:00", false);
const C = message("c", "2026-11-18T10:02:00.000000+00:00", true, { replyTo: { id: "b", mine: false, kind: "text", excerpt: "b" } });
const DELETED = (source: ChatMessage): ChatMessage => ({ id: source.id, mine: source.mine, text: null, wish: null, post: null, deleted: true, createdAt: source.createdAt });

describe("relecture : ce qui a changé (applyChanges)", () => {
  it("un message aimé ou supprimé remplace celui qui est à l'écran, par son identifiant, sans changer l'ordre", () => {
    const liked = { ...B, liked: { mine: false, theirs: true } };
    expect(applyChanges([A, B, C], [liked])).toEqual([A, liked, C]);
    expect(applyChanges([A, B, C], [DELETED(A), liked])).toEqual([DELETED(A), liked, C]);
  });

  it("rien n'a changé : la même liste est rendue (l'écran ne se redessine pas)", () => {
    const current = [A, B, C];
    expect(applyChanges(current, [])).toBe(current);
    expect(applyChanges(current, undefined)).toBe(current);
    expect(applyChanges(current, null)).toBe(current);
    // Le serveur renvoie de nouveau un message déjà à jour (chevauchement de 10 secondes) : sans effet.
    expect(applyChanges(current, [{ ...B }])).toBe(current);
    // Réponse illisible d'un serveur : ignorée.
    expect(applyChanges(current, "oui" as unknown as ChatMessage[])).toBe(current);
  });

  it("un message changé qui n'est pas à l'écran (plus ancien que la page) n'est pas ajouté", () => {
    const older = message("z", "2026-11-01T10:00:00.000000+00:00", false, { liked: { mine: true, theirs: false } });
    const current = [A, B];
    expect(applyChanges(current, [older])).toBe(current);
  });

  it("la date à renvoyer au serveur suit sa dernière réponse ; absente (serveur plus ancien), la précédente est gardée", () => {
    expect(nextSyncedAt(null, { syncedAt: "2026-11-18T10:00:00.000Z" })).toBe("2026-11-18T10:00:00.000Z");
    expect(nextSyncedAt("2026-11-18T10:00:00.000Z", { syncedAt: "2026-11-18T10:00:05.000Z" })).toBe("2026-11-18T10:00:05.000Z");
    expect(nextSyncedAt("2026-11-18T10:00:00.000Z", {})).toBe("2026-11-18T10:00:00.000Z");
    expect(nextSyncedAt(null, {})).toBeNull();
    expect(nextSyncedAt("2026-11-18T10:00:00.000Z", { syncedAt: "" })).toBe("2026-11-18T10:00:00.000Z");
    expect(nextSyncedAt(null, { syncedAt: 12 as unknown as string })).toBeNull();
  });

  it("un nouveau message et un changement arrivent ensemble : réunis, puis mis à jour", () => {
    const D = message("d", "2026-11-18T10:03:00.000000+00:00", false);
    const merged = mergeMessages([A, B], [D]);
    expect(applyChanges(merged, [DELETED(B)]).map((entry) => [entry.id, entry.deleted === true])).toEqual([
      ["a", false],
      ["b", true],
      ["d", false],
    ]);
  });
});

describe("supprimer, signaler : ce qui reste à l'écran", () => {
  it("un message supprimé n'a plus ni texte, ni carte, ni « j'aime », ni citation", () => {
    const rich = message("r", "2026-11-18T10:00:00+00:00", true, {
      text: "Texte",
      wish: { title: "Sac", imageUrl: "https://x/a.jpg", imageThumbUrl: "https://x/a-mini.jpg", merchantName: null, merchantUrl: null, isAffiliate: false, productMatchId: null, priceMin: null, currency: null },
      liked: { mine: true, theirs: true },
      replyTo: { id: "b", mine: false, kind: "text", excerpt: "b" },
      post: { available: false },
    });
    expect(asDeleted(rich)).toEqual({ id: "r", mine: true, text: null, wish: null, post: null, deleted: true, createdAt: "2026-11-18T10:00:00+00:00" });
    expect(JSON.stringify(asDeleted(rich))).not.toContain("Texte");
  });

  it("supprimé par vous : il reste, vidé ; la réponse qui le citait montre « Message indisponible »", () => {
    const after = withoutContent([A, B, C], "b", false);
    expect(after).toEqual([A, DELETED(B), { ...C, replyTo: { id: "b", mine: false, kind: "unavailable", excerpt: null } }]);
    expect(quoteText(after[2]!.replyTo!)).toBe("Message indisponible");
  });

  it("signalé par vous : il quitte l'écran ; la réponse qui le citait ne le montre plus", () => {
    const after = withoutContent([A, B, C], "b", true);
    expect(after.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(after[1]!.replyTo).toEqual({ id: "b", mine: false, kind: "unavailable", excerpt: null });
    // Les autres messages ne bougent pas.
    expect(withoutContent([A, B, C], "inconnu", true)).toEqual([A, B, C]);
  });
});

describe("« Vu » jamais sous un message supprimé", () => {
  it("votre dernier message est le dernier qui n'est pas supprimé ; tous supprimés : aucune mention", () => {
    expect(lastOwnMessage([A, B, C])).toBe(C);
    expect(lastOwnMessage([A, B, DELETED(C)])).toBe(A);
    expect(lastOwnMessage([DELETED(A), B, DELETED(C)])).toBeNull();
    // La mention suit : sous le message encore montré, jamais sous « Message supprimé ».
    const receipts = { seenAt: A.createdAt };
    expect(receiptMention([A, B, DELETED(C)], receipts, "Alexis")).toMatchObject({ messageId: "a", status: "seen", text: "Vu" });
    expect(receiptMention([DELETED(A), B, DELETED(C)], receipts, "Alexis")).toBeNull();
    // Négatif : sans la suppression, la mention porte sur le dernier message, pas encore vu.
    expect(receiptMention([A, B, C], receipts, "Alexis")).toMatchObject({ messageId: "c", status: "sent" });
  });
});

describe("aimer", () => {
  it("votre « j'aime » est montré tout de suite, celui de l'autre membre ne bouge pas", () => {
    expect(withLike(B, true).liked).toEqual({ mine: true, theirs: false });
    expect(withLike({ ...B, liked: { mine: true, theirs: true } }, false).liked).toEqual({ mine: false, theirs: true });
    // Message venu d'un serveur plus ancien (sans le champ).
    const { liked: _none, ...old } = B;
    expect(withLike(old, true).liked).toEqual({ mine: true, theirs: false });
  });

  it("VoiceOver lit qui aime le message ; personne : rien", () => {
    expect(likeLabel({ liked: { mine: true, theirs: false } }, "Alexis")).toBe("Aimé par vous");
    expect(likeLabel({ liked: { mine: false, theirs: true } }, "Alexis")).toBe("Aimé par Alexis");
    expect(likeLabel({ liked: { mine: true, theirs: true } }, "Alexis")).toBe("Aimé par vous et Alexis");
    expect(likeLabel({ liked: { mine: false, theirs: false } }, "Alexis")).toBeNull();
    expect(likeLabel({}, "Alexis")).toBeNull();
    setActiveLocale("en");
    expect(likeLabel({ liked: { mine: true, theirs: true } }, "Alexis")).toBe("Liked by you and Alexis");
  });
});

describe("ce qu'on peut faire d'un message (messageActionsFor)", () => {
  const all = { actions: true, open: true, canWrite: true };

  it("reçu : Aimer, Répondre, Signaler, Bloquer ; le sien : Aimer, Répondre, Supprimer", () => {
    expect(messageActionsFor(B, all)).toEqual(["like", "reply", "report", "block"]);
    expect(messageActionsFor(A, all)).toEqual(["like", "reply", "delete"]);
    expect(messageActionsFor({ ...B, liked: { mine: true, theirs: false } }, all)).toEqual(["unlike", "reply", "report", "block"]);
  });

  it("serveur sans ces actions : rien pour ses messages ; « Signaler » et « Bloquer » restent toujours pour un message reçu", () => {
    const off = { actions: false, open: true, canWrite: true };
    expect(messageActionsFor(A, off)).toEqual([]);
    expect(messageActionsFor(B, off)).toEqual(["report", "block"]);
  });

  it("invitation (conversation pas encore ouverte) : pas de « j'aime » ; sans pouvoir écrire : pas de réponse", () => {
    expect(messageActionsFor(B, { actions: true, open: false, canWrite: false })).toEqual(["report", "block"]);
    expect(messageActionsFor(A, { actions: true, open: false, canWrite: false })).toEqual(["delete"]);
    expect(messageActionsFor(B, { actions: true, open: false, canWrite: true })).toEqual(["reply", "report", "block"]);
  });

  it("message supprimé : plus rien à faire du sien ; celui de l'autre peut encore être signalé", () => {
    expect(messageActionsFor(DELETED(A), all)).toEqual([]);
    expect(messageActionsFor(DELETED(B), all)).toEqual(["report", "block"]);
  });

  it("publication reçue ou envoyée : « Voir la publication » en premier, seulement si elle est disponible (VoiceOver ne peut pas toucher la carte)", () => {
    const card = { available: true as const, id: "post-1", author: { id: "u", username: "lou", displayName: "Lou", avatarUrl: null }, thumbUrl: null, caption: null };
    expect(messageActionsFor({ ...B, post: card }, all)).toEqual(["openPost", "like", "reply", "report", "block"]);
    expect(messageActionsFor({ ...A, post: card }, all)).toEqual(["openPost", "like", "reply", "delete"]);
    // Indisponible, ou message supprimé : rien à ouvrir.
    expect(messageActionsFor({ ...B, post: { available: false } }, all)).toEqual(["like", "reply", "report", "block"]);
    expect(messageActionsFor({ ...DELETED(B), post: card }, all)).toEqual(["report", "block"]);
    // Invitation reçue : la feuille s'ouvre (trois actions), « Signaler » et « Bloquer » y restent.
    expect(messageActionsFor({ ...B, post: card }, { actions: true, open: false, canWrite: false })).toEqual(["openPost", "report", "block"]);
  });
});

describe("ouvrir le menu « Signaler / Bloquer » après la feuille des actions (lib/after-sheet-close.ts)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("iPhone : rien ne s'ouvre tant que la feuille n'a pas fini de se fermer, puis une seule fois", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const after = afterSheetClose(false);
    after.schedule(run);
    expect(run).not.toHaveBeenCalled();
    after.flush();
    expect(run).toHaveBeenCalledTimes(1);
    // Le secours et un second signal ne relancent rien.
    vi.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS * 2);
    after.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("secours : sans signal de fermeture, le menu s'ouvre quand même après le délai", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const after = afterSheetClose(false);
    after.schedule(run);
    vi.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("site : tout de suite ; écran quitté : rien ne part ; une feuille fermée sans choix n'ouvre rien", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    afterSheetClose(true).schedule(run);
    expect(run).toHaveBeenCalledTimes(1);
    const after = afterSheetClose(false);
    const late = vi.fn();
    after.schedule(late);
    after.cancel();
    after.flush();
    vi.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS * 2);
    expect(late).not.toHaveBeenCalled();
    expect(() => afterSheetClose(false).flush()).not.toThrow();
  });

  it("l'écran n'ouvre plus le menu dans le même geste : il attend la fermeture de la feuille", () => {
    const screen = read("app/(app)/conversation.tsx");
    const sheet = read("components/message-actions-sheet.tsx");
    expect(screen).toContain('const afterSheet = useMemo(() => afterSheetClose(Platform.OS === "web"), []);');
    expect(screen).toContain("useEffect(() => () => afterSheet.cancel(), [afterSheet]);");
    expect(screen).toContain("onDismissed={afterSheet.flush}");
    const handle = screen.slice(screen.indexOf("function handleAction("), screen.indexOf("async function handleAccept("));
    expect(handle).toContain("afterSheet.schedule(() => {");
    // Aucune ouverture directe du menu hors de cette attente.
    expect(handle.slice(0, handle.indexOf("afterSheet.schedule("))).not.toContain("setMenuFor(");
    expect(sheet).toContain("onRequestClose={onClose} onDismiss={onDismissed}>");
    // « Voir la publication » ouvre la même page que la carte.
    expect(handle).toContain("if (message.post?.available) openPost(message.post.id);");
    expect(screen).toContain("onOpenPost={openPost}");
  });
});

describe("répondre", () => {
  it("la barre au-dessus du champ dit à qui l'on répond, avec le début du message", () => {
    expect(replyTargetOf(B, "Alexis")).toEqual({ id: "b", title: "Réponse à Alexis", excerpt: "b" });
    expect(replyTargetOf(A, "Alexis")).toEqual({ id: "a", title: "Réponse à votre message", excerpt: "a" });
    const post = message("p", "2026-11-18T10:00:00+00:00", false, { text: null, post: { available: false } });
    // Une publication : jamais rien d'elle dans la barre.
    expect(replyTargetOf(post, "Alexis").excerpt).toBe("Publication partagée");
  });

  it("le message cité : son extrait, « Publication partagée », ou « Message indisponible »", () => {
    expect(quoteText({ id: "x", mine: false, kind: "text", excerpt: "Tu as vu ce sac ?" })).toBe("Tu as vu ce sac ?");
    expect(quoteText({ id: "x", mine: false, kind: "wish", excerpt: "Sac cabas" })).toBe("Sac cabas");
    expect(quoteText({ id: "x", mine: false, kind: "wish", excerpt: null })).toBe("Envie partagée");
    expect(quoteText({ id: "x", mine: false, kind: "post", excerpt: null })).toBe("Publication partagée");
    expect(quoteText({ id: "x", mine: false, kind: "unavailable", excerpt: null })).toBe("Message indisponible");
    // Même si un serveur envoyait un extrait avec « indisponible », l'app ne le montre pas.
    expect(quoteText({ id: "x", mine: false, kind: "unavailable", excerpt: "secret" })).toBe("Message indisponible");
  });
});

describe("envoyer une publication", () => {
  it("la carte jointe part comme `postId`, une seule carte à la fois", () => {
    expect(attachmentFor({ id: "post-1", kind: "post" })).toEqual({ postId: "post-1" });
    expect(attachmentFor({ id: "w-1" })).toEqual({ wishId: "w-1" });
    expect(attachmentFor({ id: "m-1", kind: "match" })).toEqual({ matchId: "m-1" });
    expect(attachmentFor(null)).toEqual({});
    expect(attachedLabels({ title: "Publication de Lou", kind: "post" })).toEqual({ title: "Publication de Lou", remove: "Retirer la publication" });
  });

  it("du fil au choix de la conversation : seul l'identifiant de la publication voyage", () => {
    expect(sendPostHref("post-42")).toEqual({ pathname: "/choisir-conversation", params: { postId: "post-42" } });
    const choose = read("app/(app)/choisir-conversation.tsx");
    expect(choose).toContain("const attached = wishId ? { wishId } : matchId ? { matchId } : postId ? { postId } : {};");
    const conversation = read("app/(app)/conversation.tsx");
    expect(conversation).toContain('setWish({ id: postId, title: t.messageActions.attachedPost, imageUrl: null, kind: "post" });');
    expect(conversation).toContain("...(replyTo ? { replyToId: replyTo.id } : {}), ...attachmentFor(wish) });");
  });

  it("le bouton « Envoyer dans un message » du fil : caché tant que le serveur n'a pas ces actions, et pour une publication que vous seul voyez", () => {
    const card = read("components/post-card.tsx");
    expect(card).toContain("const canSendInMessage = useMessagesStatus().actions === true;");
    const button = /\{canSendInMessage && post\.privacy !== "private" \? \(\s*<Pressable([\s\S]*?)>\s*<SendIcon size=\{19\} \/>\s*<\/Pressable>\s*\) : null\}/.exec(card);
    expect(button).not.toBeNull();
    expect(button![1]).toContain("onPress={() => router.push(sendPostHref(post.id))}");
    expect(button![1]).toContain("accessibilityLabel={t.messageActions.sendPost}");
    // À la fin de la rangée d'actions, après le partage (les autres boutons ne changent pas d'ordre).
    expect(card.indexOf("<ShareIcon size={19} />")).toBeLessThan(card.indexOf("<SendIcon size={19} />"));
    expect(card.indexOf("<SendIcon size={19} />")).toBeLessThan(card.indexOf("const styles = themedStyles"));
  });

  it("la carte reçue : « Publication indisponible » sans rien d'autre quand le serveur ne transmet rien", () => {
    const card = read("components/message-post-card.tsx");
    const unavailable = card.slice(card.indexOf("if (!card.available) {"), card.indexOf("<Pressable"));
    expect(unavailable).toContain("{t.messageActions.postUnavailable}");
    expect(unavailable).not.toMatch(/author|caption|thumbUrl|onOpen/);
    expect(card).toContain("onPress={() => onOpen(card.id)}");
    expect(read("app/(app)/conversation.tsx")).toContain('router.push({ pathname: "/publication", params: { id: openedId } })');
  });
});

describe("aperçu de la liste et état de la messagerie", () => {
  const summary = (lastMessage: ConversationSummary["lastMessage"]): ConversationSummary => ({
    id: "c1",
    other: { id: "u2", username: "alexis", displayName: "Alexis", avatarUrl: null },
    state: "open",
    lastMessage,
    lastMessageAt: "2026-11-18T10:00:00+00:00",
    unread: false,
  });
  const last = { text: null, hasWish: false, mine: false, hidden: false, createdAt: "2026-11-18T10:00:00+00:00" };

  it("« Message supprimé » et « Publication partagée », jamais leur contenu", () => {
    expect(conversationPreview(summary({ ...last, deleted: true }))).toBe("Message supprimé");
    // Même si un serveur renvoyait un texte avec un message supprimé, l'app ne le montre pas.
    expect(conversationPreview(summary({ ...last, deleted: true, text: "contenu" }))).toBe("Message supprimé");
    expect(conversationPreview(summary({ ...last, hasPost: true }))).toBe("Publication partagée");
    expect(conversationPreview(summary({ ...last, hasPost: true, mine: true }))).toBe("Vous : Publication partagée");
    expect(conversationPreview(summary({ ...last, hasPost: true, text: "Regarde" }))).toBe("Regarde");
    // Masqué ou signalé par vous : comme avant, avant tout le reste.
    expect(conversationPreview(summary({ ...last, hidden: true, deleted: true }))).toBe("Message indisponible");
    setActiveLocale("en");
    expect(conversationPreview(summary({ ...last, deleted: true }))).toBe("Message deleted");
    expect(conversationPreview(summary({ ...last, hasPost: true }))).toBe("Shared post");
  });

  it("`actions` : vrai seulement si le serveur le dit exactement ; absent (serveur plus ancien) : les actions ne sont pas proposées", () => {
    expect(readMessagesStatus({ enabled: true, unreadCount: 0, push: false, actions: true }).actions).toBe(true);
    for (const actions of [undefined, false, "true", 1, null]) expect(readMessagesStatus({ enabled: true, unreadCount: 0, actions }).actions, String(actions)).toBe(false);
    expect(readMessagesStatus({ enabled: false, unreadCount: 0, actions: true }).actions).toBe(false);
    expect(readMessagesStatus(null).actions).toBe(false);
  });
});

describe("les écrans, lus comme du texte", () => {
  const api = read("lib/api.ts");
  const screen = read("app/(app)/conversation.tsx");
  const sheet = read("components/message-actions-sheet.tsx");

  it("l'app dit au serveur qu'elle comprend le nouveau vocabulaire (v=2) sur les quatre lectures, et lui renvoie la date de sa dernière réponse", () => {
    expect(CLIENT_LEVEL).toBe("2");
    expect(api).toContain("const SPEAKS = `v=${CLIENT_LEVEL}`;");
    expect(api).toContain("authorizedFetch(`/api/conversations?${SPEAKS}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : \"\"}`)");
    expect(api).toContain("authorizedFetch(`/api/conversations/${encodeURIComponent(id)}?${SPEAKS}${page}${changed}`)");
    expect(api).toContain("authorizedFetch(`/api/conversations/with/${encodeURIComponent(userId)}?${SPEAKS}`)");
    expect(api).toContain('authorizedFetch(`/api/messages?${SPEAKS}`, { method: "POST", body: JSON.stringify(payload) })');
    expect(api).toContain('authorizedFetch(`/api/messages/${encodeURIComponent(messageId)}/reaction`, { method: "PUT", body: JSON.stringify(payload) })');
    expect(api).toContain('authorizedFetch(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" })');
    expect(screen).toContain("data = await fetchConversation(conversationId, { after: newestCreatedAt(messagesRef.current), changedSince: syncedAt.current });");
    expect(screen).toContain("const next = applyChanges(merged, data.changed);");
    expect(screen).toContain("syncedAt.current = nextSyncedAt(syncedAt.current, data);");
  });

  it("toutes les actions sont dans la feuille (le site n'a pas d'appui long) ; « Supprimer » est confirmé avant de partir", () => {
    for (const action of ["like", "unlike", "reply", "delete", "report", "block"]) expect(sheet).toContain(`${action}: t.messageActions.${action},`);
    expect(sheet).toContain("openPost: t.messageActions.viewPost,");
    expect(fr.messageActions.viewPost).toBe("Voir la publication");
    expect(sheet).toContain('if (action === "delete" && !confirmDelete) {');
    expect(sheet).toContain("{t.messageActions.deleteConfirm}");
    expect(sheet).not.toContain("Platform.OS");
    expect(sheet).not.toContain("onLongPress");
    expect(fr.messageActions.deleteConfirm).toBe("Supprimer ce message pour vous deux ?");
    // L'écran ne propose ces actions que si le serveur les a.
    expect(screen).toContain("const actionsEnabled = useMessagesStatus().actions === true;");
    expect(screen).toContain('return messageActionsFor(message, { actions: actionsEnabled, open: thread?.state === "open", canWrite: thread ? canWrite(thread.sendMode) : false });');
  });

  it("« Signaler » et « Bloquer » passent par le menu existant (règle 1.2 d'Apple), ouvert à la bonne étape", () => {
    const menu = read("components/report-block-menu.tsx");
    expect(menu).toContain("if (visible && initialStep) setStep(initialStep);");
    expect(menu).toContain("await reportContent(reportRequest(target, reason));");
    expect(screen).toContain('setMenuStep(action === "report" ? "report" : "confirmBlock");');
    // La feuille ne signale ni ne bloque elle-même.
    expect(sheet).not.toMatch(/reportContent|blockUser/);
  });

  it("deux appuis aiment le message ; un « j'aime » refusé revient en arrière, avec le message du serveur", () => {
    const bubble = screen.slice(screen.indexOf("function Bubble("), screen.indexOf("// Une conversation (lot messages)"));
    expect(bubble).toContain("if (onLike && now - lastTap.current < DOUBLE_TAP_DELAY_MS) onLike();");
    expect(screen).toContain('onLike={actionsFor(message).includes("like") ? () => void toggleLike(message, true) : undefined}');
    const toggle = screen.slice(screen.indexOf("async function toggleLike("), screen.indexOf("async function handleDelete("));
    expect(toggle).toContain("withLike(entry, liked)");
    expect(toggle).toContain("withLike(entry, !liked)");
    expect(toggle).toContain("showToast(e instanceof ApiError ? e.message : t.messageActions.likeError);");
    // Le cœur sous la bulle dit qui aime (VoiceOver), jamais par la couleur seule.
    expect(bubble).toContain("accessibilityLabel={liked}");
  });

  it("un message supprimé n'affiche que « Message supprimé » : ni citation, ni carte, ni texte", () => {
    const bubble = screen.slice(screen.indexOf("function Bubble("), screen.indexOf("// Une conversation (lot messages)"));
    const deleted = bubble.slice(bubble.indexOf("{message.deleted ? ("), bubble.indexOf("<Text style={[styles.bubbleTime"));
    expect(deleted).toMatch(/\{message\.deleted \? \(\s*<Text [^>]*>\{t\.messageActions\.deleted\}<\/Text>\s*\) : \(/);
    // Tout le reste est dans l'autre branche.
    const live = deleted.slice(deleted.indexOf(") : ("));
    for (const part of ["message.replyTo", "quote", "message.post", "message.wish", "message.text"]) expect(live, part).toContain(part.replace("message.replyTo", "quote"));
    expect(bubble).not.toMatch(/>\s*(Message supprimé|Message deleted)\s*</);
  });

  it("la file de modération dit « Supprimé par son auteur le … » pour le message signalé, « Message supprimé » pour ceux d'autour", () => {
    const item = read("components/moderation-item.tsx");
    expect(item).toContain("entry.reported && preview.deletedAt ? t.messageActions.deletedByAuthorOn(formatLongDate(preview.deletedAt, getActiveLocale())) : t.messageActions.deleted");
    expect(fr.messageActions.deletedByAuthorOn("18 novembre 2026")).toBe("Supprimé par son auteur le 18 novembre 2026");
    expect(en.messageActions.deletedByAuthorOn("November 18, 2026")).toBe("Deleted by its author on November 18, 2026");
  });
});

describe("textes FR / EN (fiche)", () => {
  it("les libellés de la fiche, mot pour mot", () => {
    const expected: [keyof typeof fr.messageActions, string, string][] = [
      ["like", "Aimer", "Like"],
      ["unlike", "Ne plus aimer", "Unlike"],
      ["reply", "Répondre", "Reply"],
      ["delete", "Supprimer", "Delete"],
      ["deleteConfirm", "Supprimer ce message pour vous deux ?", "Delete this message for both of you?"],
      ["deleted", "Message supprimé", "Message deleted"],
      ["cancelReply", "Annuler la réponse", "Cancel reply"],
      ["quoteUnavailable", "Message indisponible", "Message unavailable"],
      ["postUnavailable", "Publication indisponible", "Post unavailable"],
      ["sendPost", "Envoyer dans un message", "Send in a message"],
      ["previewPost", "Publication partagée", "Shared post"],
    ];
    for (const [key, french, english] of expected) {
      expect(fr.messageActions[key], key).toBe(french);
      expect(en.messageActions[key], key).toBe(english);
    }
    expect(fr.messageActions.replyingTo("Alexis")).toBe("Réponse à Alexis");
    expect(en.messageActions.replyingTo("Alexis")).toBe("Replying to Alexis");
  });

  it("la section est ajoutée à la fin des deux catalogues, avec les mêmes clés", () => {
    // Puis seulement les sections du lot « vie sociale » (migrations 0045 à 0049), fusionné après,
    // et celles du lot « découverte » (« Pour vous », 0050 ; notifications d'activité, 0051).
    for (const catalog of [fr, en]) {
      const keys = Object.keys(catalog);
      expect(keys.slice(keys.indexOf("messageActions") + 1)).toEqual(["privateAccount", "memberLists", "commentThreads", "carousel", "savedPosts", "profilePins", "forYou", "activityPush"]);
    }
    expect(Object.keys(en.messageActions).sort()).toEqual(Object.keys(fr.messageActions).sort());
    for (const value of Object.values(fr.messageActions)) {
      const text = typeof value === "function" ? value("Alexis") : value;
      expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
    }
  });
});

describe("politique de confidentialité", () => {
  const text = (policy: { sections: readonly { title: string; blocks: readonly unknown[] }[] }, title: RegExp) =>
    JSON.stringify(policy.sections.find((section) => title.test(section.title))?.blocks ?? []);

  it("section « Qui peut voir quoi » : aimer, répondre, envoyer une publication, supprimer ; ce qui reste d'un message supprimé", () => {
    const french = text(privacyPolicy, /^Qui peut voir quoi/);
    expect(french).toContain("Dans une conversation, vous pouvez aimer un message, y répondre, envoyer une publication et supprimer vos propres messages.");
    expect(french).toContain("Un message supprimé est effacé pour vous deux ; seule la mention « Message supprimé » reste. L'autre membre a pu le lire avant.");
    expect(french).toContain("S'il avait été signalé avant d'être supprimé, son contenu est conservé pour la modération : l'autre membre ne peut plus le lire, et vous le retrouvez dans l'export de vos données.");
    expect(french).toContain("Une publication envoyée n'est montrée à l'autre membre que s'il a le droit de la voir, au moment où il regarde.");
    const english = text(privacyPolicyEn, /^Who can see what/);
    expect(english).toContain("In a conversation you can like a message, reply to it, send a post and delete your own messages.");
    expect(english).toContain("A deleted message is erased for both of you; only the line “Message deleted” remains. The other member may have read it before.");
    expect(english).toContain("If it had been reported before being deleted, its content is kept for moderation: the other member can no longer read it, and you will find it in your data export.");
    expect(english).toContain("A post you send is shown to the other member only if they are allowed to see it, at the time they look.");
  });

  it("le nouveau bloc est ajouté à la fin de la section, dans les deux langues", () => {
    const last = (policy: { sections: readonly { title: string; blocks: readonly unknown[] }[] }, title: RegExp) => policy.sections.find((section) => title.test(section.title))?.blocks.at(-1);
    expect(String(last(privacyPolicy, /^Qui peut voir quoi/))).toMatch(/^Dans une conversation, vous pouvez aimer un message/);
    expect(String(last(privacyPolicyEn, /^Who can see what/))).toMatch(/^In a conversation you can like a message/);
  });
});
