import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MENTIONS_FROM, MENTION_MAX_PER_TEXT, NOTIFICATION_TYPES, extractMentions, type AppNotification, type PostComment, type PublicProfile } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import {
  MENTION_SEARCH_DELAY_MS,
  MENTION_SUGGESTIONS_MAX,
  NO_REPLIES,
  appendPage,
  applyMention,
  hasThreadFields,
  likeButtonLabel,
  mentionSuggestions,
  mentionTokenAt,
  mentionsViewer,
  optimisticLikeCount,
  repliesNeedLoading,
  rootIdOf,
  showsViewReplies,
  splitMentions,
  withCreatedComment,
  withLike,
  withReplyCount,
  withoutComment,
  withoutViewerMention,
  type RepliesState,
} from "../src/lib/comment-threads";
import { knownNotifications, notificationActionText, notificationTarget } from "../src/lib/follow-state";

// Commentaires : réponses, « j'aime », mentions (lot « vie sociale »,
// migration 0046), côté app : le mot sous le curseur, le découpage d'un texte
// en liens, l'état du fil après chaque geste, le réglage, et les textes.

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const ME = "a0000000-0000-4000-8000-000000000001";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";

function comment(id: string, extra: Partial<PostComment> = {}): PostComment {
  return {
    id,
    body: `Commentaire ${id}`,
    createdAt: "2026-11-18T10:00:00.000Z",
    author: { id: CARL, username: "carl", displayName: "Carl", avatarUrl: null },
    canDelete: false,
    parentId: null,
    likeCount: 0,
    viewerHasLiked: false,
    mentions: [],
    replyCount: 0,
    ...extra,
  };
}

const open = (items: PostComment[], nextCursor: string | null = null): RepliesState => ({ items, nextCursor, open: true, loading: false, failed: false });

afterEach(() => setActiveLocale("fr"));

describe("le mot sous le curseur : faut-il proposer des membres ?", () => {
  it("oui dès une lettre après « @ », en début de texte ou après un espace, une parenthèse, un retour à la ligne", () => {
    expect(mentionTokenAt("@a", 2)).toEqual({ query: "a", start: 0, end: 2 });
    expect(mentionTokenAt("Bravo @Car", 10)).toEqual({ query: "car", start: 6, end: 10 });
    expect(mentionTokenAt("(@dora_2", 8)).toEqual({ query: "dora_2", start: 1, end: 8 });
    expect(mentionTokenAt("ligne\n@eve", 10)).toEqual({ query: "eve", start: 6, end: 10 });
    // Le curseur au milieu du mot : seulement ce qui le précède.
    expect(mentionTokenAt("Bravo @carl !", 9)).toEqual({ query: "ca", start: 6, end: 9 });
    // Le second « @ » d'un texte.
    expect(mentionTokenAt("@anna et @b", 11)).toEqual({ query: "b", start: 9, end: 11 });
  });

  it("non : pas d'arobase, arobase seule, espace après l'arobase, adresse e-mail, mot trop long, curseur ailleurs", () => {
    expect(mentionTokenAt("", 0)).toBeNull();
    expect(mentionTokenAt("Bravo", 5)).toBeNull();
    expect(mentionTokenAt("@", 1)).toBeNull();
    expect(mentionTokenAt("@anna merci", 11)).toBeNull();
    expect(mentionTokenAt("@anna ", 6)).toBeNull();
    expect(mentionTokenAt("anna@exemple", 12)).toBeNull();
    expect(mentionTokenAt("a.@bru", 6)).toBeNull();
    expect(mentionTokenAt("@@bru", 5)).toBeNull();
    expect(mentionTokenAt(`@${"a".repeat(21)}`, 22)).toBeNull();
    expect(mentionTokenAt("@anna", 0)).toBeNull();
    expect(mentionTokenAt("@anna", 99)).toBeNull();
    expect(mentionTokenAt("@é", 2)).toBeNull();
  });

  it("choisir un membre remplace le mot en cours par « @pseudo » et un espace, sans toucher au reste", () => {
    const end = mentionTokenAt("Bravo @ca", 9)!;
    expect(applyMention("Bravo @ca", end, "carl")).toEqual({ text: "Bravo @carl ", cursor: 12 });
    const middle = mentionTokenAt("Bravo @ca pour tout", 9)!;
    expect(applyMention("Bravo @ca pour tout", middle, "carl")).toEqual({ text: "Bravo @carl pour tout", cursor: 12 });
    // Le curseur au milieu d'un pseudo déjà tapé : tout le mot est remplacé.
    const inside = mentionTokenAt("Vu @carlos ?", 6)!;
    expect(applyMention("Vu @carlos ?", inside, "carl")).toEqual({ text: "Vu @carl ?", cursor: 9 });
    // Ce que le serveur lira est bien une mention.
    expect(extractMentions(applyMention("Bravo @ca", end, "carl").text)).toEqual(["carl"]);
  });

  it(`au plus ${MENTION_SUGGESTIONS_MAX} suggestions, après une courte pause, jamais un compte sans pseudo`, () => {
    expect(MENTION_SUGGESTIONS_MAX).toBe(5);
    expect(MENTION_SEARCH_DELAY_MS).toBe(300);
    const person = (index: number, username = `membre${index}`): PublicProfile => ({ id: `id-${index}`, username, displayName: `Membre ${index}`, avatarUrl: null, isFollowing: false });
    const results = [person(1), person(2, ""), person(3), person(4), person(5), person(6), person(7)];
    expect(mentionSuggestions(results).map((profile) => profile.username)).toEqual(["membre1", "membre3", "membre4", "membre5", "membre6"]);
    expect(mentionSuggestions([])).toEqual([]);
  });

  it("le champ de saisie : suggestions seulement si le serveur a les mentions, recherche existante, liste de boutons", () => {
    const section = read("components/comments-section.tsx");
    expect(section).toContain("const mentionsOn = profile?.mentionsFrom !== undefined;");
    expect(section).toContain("const token = mentionsOn ? mentionTokenAt(draft, cursor) : null;");
    // La recherche de comptes existante, pas une route à part ; annulée si la frappe continue.
    expect(section).toContain("searchUsers(query)");
    expect(section).toContain("}, MENTION_SEARCH_DELAY_MS);");
    expect(section).toContain("clearTimeout(timer);");
    expect(section).toContain("if (current) setSuggestions(mentionSuggestions(results));");
    const list = section.slice(section.indexOf("{suggestions.length > 0 && token ? ("), section.indexOf("<View style={styles.composer}>"));
    expect(list).toContain('role="list"');
    expect(list).toContain("accessibilityLabel={t.commentThreads.suggestionsLabel}");
    expect(list).toContain('accessibilityRole="button"');
    expect(list).toContain("accessibilityLabel={t.commentThreads.suggestionLabel(person.displayName || person.username)}");
    expect(section).toMatch(/suggestion: \{ minHeight: 44, /);
    // L'indice « Tapez @ » n'apparaît que si le serveur a les mentions.
    expect(section).toContain("{mentionsOn && draft.length === 0 ? <Text style={styles.hint}>{t.commentThreads.mentionHint}</Text> : null}");
  });
});

describe("le texte d'un commentaire : quels « @pseudo » deviennent des liens", () => {
  it("permis : seulement les mentions renvoyées par le serveur, à leur place exacte, majuscules comprises", () => {
    const body = "Bravo @Carl, et merci @dora !";
    expect(
      splitMentions(body, [
        { handle: "carl", userId: CARL },
        { handle: "dora", userId: DORA },
      ])
    ).toEqual([{ text: "Bravo " }, { text: "@Carl", userId: CARL }, { text: ", et merci " }, { text: "@dora", userId: DORA }, { text: " !" }]);
    // Le texte recollé est exactement celui d'origine.
    expect(splitMentions(body, [{ handle: "dora", userId: DORA }]).map((part) => part.text).join("")).toBe(body);
    // Deux fois le même pseudo : deux liens.
    expect(splitMentions("@carl et @carl", [{ handle: "carl", userId: CARL }]).filter((part) => part.userId)).toHaveLength(2);
    expect(splitMentions("@carl", [{ handle: "carl", userId: CARL }])).toEqual([{ text: "@carl", userId: CARL }]);
  });

  it("refusé : un pseudo que le serveur n'a pas renvoyé (inconnu, mention refusée ou retirée, compte bloqué) reste un simple texte", () => {
    const body = "Bravo @carl et @dora, écrivez à eve@exemple.fr";
    expect(splitMentions(body, [])).toEqual([{ text: body }]);
    expect(splitMentions(body, undefined)).toEqual([{ text: body }]);
    const parts = splitMentions(body, [{ handle: "dora", userId: DORA }]);
    expect(parts.filter((part) => part.userId).map((part) => part.text)).toEqual(["@dora"]);
    expect(parts.find((part) => part.text.includes("@carl"))?.userId).toBeUndefined();
    // Une adresse e-mail n'est jamais un lien, même si le serveur renvoyait ce pseudo.
    expect(splitMentions("eve@exemple.fr", [{ handle: "exemple", userId: DORA }])).toEqual([{ text: "eve@exemple.fr" }]);
    // Une mention renvoyée pour un pseudo absent du texte ne crée aucun lien.
    expect(splitMentions("Bonjour", [{ handle: "carl", userId: CARL }])).toEqual([{ text: "Bonjour" }]);
  });

  it("le composant ne fait un lien que pour un morceau qui a un compte, et l'annonce comme un lien vers le profil", () => {
    const component = read("components/mention-text.tsx");
    expect(component).toContain("splitMentions(body, mentions)");
    expect(component).toContain("return userId && onOpenProfile ? (");
    expect(component).toContain("onPress={() => onOpenProfile(userId)}");
    expect(component).toContain('accessibilityRole="link"');
    expect(component).toContain("accessibilityLabel={t.common.viewProfile(part.text)}");
    // Aucune recherche de compte dans l'app : le serveur seul décide de ce qui est un lien.
    expect(component).not.toMatch(/searchUsers|fetch/);
    const section = read("components/comments-section.tsx");
    expect(section).toContain("<MentionText body={comment.body} mentions={comment.mentions} onOpenProfile={onOpenProfile} />");
  });

  it("« Retirer ma mention » : seulement sur un commentaire qui mentionne le lecteur ; le texte reste, le lien part", () => {
    const mine = comment("1", { body: "Bravo @moi et @dora", mentions: [{ handle: "moi", userId: ME }, { handle: "dora", userId: DORA }] });
    expect(mentionsViewer(mine, ME)).toBe(true);
    expect(mentionsViewer(mine, CARL)).toBe(false);
    expect(mentionsViewer(mine, undefined)).toBe(false);
    expect(mentionsViewer(comment("2"), ME)).toBe(false);
    expect(mentionsViewer({ mentions: undefined }, ME)).toBe(false);
    const after = withoutViewerMention(mine, ME);
    expect(after.body).toBe(mine.body);
    expect(after.mentions).toEqual([{ handle: "dora", userId: DORA }]);

    const section = read("components/comments-section.tsx");
    expect(section).toContain("const menuMentionsMe = menuFor !== null && mentionsViewer(menuFor, viewerId);");
    expect(section).toContain("extraAction={menuFor && menuMentionsMe ? { label: t.commentThreads.removeMyMention, onPress: () => void handleRemoveMention(menuFor) } : undefined}");
    expect(section).toContain("await removeMyMention(comment.id);");
    const api = read("lib/api.ts");
    expect(api).toContain("await authorizedFetch(`/api/comments/${commentId}/mentions/me`, { method: \"DELETE\" });");
    // Le menu n'ajoute rien quand aucune action n'est donnée.
    const menu = read("components/report-block-menu.tsx");
    expect(menu).toContain("{extraAction ? (");
  });
});

describe("le fil : commentaires d'origine, réponses à part", () => {
  it("sans la migration (ou avec un serveur d'avant), ni cœur ni « Répondre »", () => {
    expect(hasThreadFields(comment("1"))).toBe(true);
    const flat: PostComment = { id: "1", body: "À plat", createdAt: "2026-11-18T10:00:00.000Z", author: comment("x").author, canDelete: false };
    expect(hasThreadFields(flat)).toBe(false);
    const section = read("components/comments-section.tsx");
    const row = section.slice(section.indexOf("function renderComment("), section.indexOf("function renderReplies("));
    expect(row).toContain("const threaded = hasThreadFields(comment);");
    expect(row).toContain("{threaded ? (");
    expect(row.indexOf("{threaded ? (")).toBeLessThan(row.indexOf("toggleLike(comment)"));
    expect(row.indexOf("{threaded ? (")).toBeLessThan(row.indexOf("t.commentThreads.reply"));
  });

  it("l'app demande le fil (« v=2 ») ; les réponses, l'envoi d'une réponse et le « j'aime » ont leurs appels", () => {
    const api = read("lib/api.ts");
    expect(api).toContain("await authorizedFetch(`/api/posts/${postId}/comments?${CLIENT_LEVEL_QUERY}${query}`);");
    expect(api).toContain("await authorizedFetch(`/api/comments/${commentId}/replies${query}`);");
    expect(api).toContain("const payload: CreateCommentRequest = parentId ? { body, parentId } : { body };");
    expect(api).toContain("await authorizedFetch(`/api/comments/${commentId}/like`, { method: \"PUT\", body: JSON.stringify(payload) });");
  });

  it("« Voir les n réponses » : seulement s'il y en a et tant qu'elles ne sont pas affichées", () => {
    expect(showsViewReplies(comment("1", { replyCount: 3 }), NO_REPLIES)).toBe(true);
    expect(showsViewReplies(comment("1", { replyCount: 0 }), NO_REPLIES)).toBe(false);
    expect(showsViewReplies(comment("1", { replyCount: 3 }), open([comment("r1", { parentId: "1" })]))).toBe(false);
    expect(showsViewReplies({ replyCount: undefined }, NO_REPLIES)).toBe(false);
    expect(rootIdOf(comment("1"))).toBe("1");
    expect(rootIdOf(comment("r1", { parentId: "1" }))).toBe("1");
    const section = read("components/comments-section.tsx");
    // Un seul cran de retrait, et les réponses ne sont jamais chargées d'avance.
    expect(section).toContain("replies: { marginLeft: 38 },");
    expect(section).toContain("{thread.open ? thread.items.map((reply) => renderComment(reply, true)) : null}");
    expect(section.match(/fetchReplies\(/g)).toHaveLength(1);
    expect(section.slice(section.indexOf("const load = useCallback"), section.indexOf("async function loadMore"))).not.toContain("fetchReplies");
  });

  it("une page ajoutée ne répète jamais un commentaire déjà affiché", () => {
    const shown = [comment("1"), comment("2")];
    expect(appendPage(shown, [comment("2"), comment("3")]).map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(appendPage([], [comment("1")]).map((item) => item.id)).toEqual(["1"]);
  });

  it("après l'envoi : un commentaire va à la fin du fil ; une réponse sous son commentaire d'origine, qui en compte une de plus", () => {
    const list = [comment("1", { replyCount: 1 }), comment("2")];
    const top = withCreatedComment(list, {}, comment("3"));
    expect(top.comments.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(top.replies).toEqual({});

    const threads = { "1": open([comment("r1", { parentId: "1" })]) };
    const reply = withCreatedComment(list, threads, comment("r2", { parentId: "1" }));
    expect(reply.comments.map((item) => [item.id, item.replyCount])).toEqual([["1", 2], ["2", 0]]);
    expect(reply.replies["1"]!.items.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(reply.replies["1"]!.open).toBe(true);
    // Les listes d'origine ne sont pas modifiées.
    expect(list[0]!.replyCount).toBe(1);
    expect(threads["1"].items).toHaveLength(1);

    // Réponses pas encore affichées : l'écran les charge au lieu d'en montrer une seule.
    expect(repliesNeedLoading({}, "1")).toBe(true);
    expect(repliesNeedLoading({ "1": { ...NO_REPLIES, items: [comment("r1", { parentId: "1" })] } }, "1")).toBe(true);
    expect(repliesNeedLoading(threads, "1")).toBe(false);
    const section = read("components/comments-section.tsx");
    expect(section).toContain("if (rootId !== null && repliesNeedLoading(replies, rootId)) {");
    expect(section).toContain("const created = await createComment(postId, body, replyTo?.targetId);");
  });

  it("après une suppression ou un signalement : un commentaire d'origine emporte ses réponses ; une réponse en retire une du nombre", () => {
    const list = [comment("1", { replyCount: 2 }), comment("2")];
    const threads = { "1": open([comment("r1", { parentId: "1" }), comment("r2", { parentId: "1" })]), "2": NO_REPLIES };

    const withoutReply = withoutComment(list, threads, comment("r1", { parentId: "1" }));
    expect(withoutReply.comments.map((item) => [item.id, item.replyCount])).toEqual([["1", 1], ["2", 0]]);
    expect(withoutReply.replies["1"]!.items.map((item) => item.id)).toEqual(["r2"]);

    const withoutRoot = withoutComment(list, threads, comment("1"));
    expect(withoutRoot.comments.map((item) => item.id)).toEqual(["2"]);
    expect(Object.keys(withoutRoot.replies)).toEqual(["2"]);

    // Une réponse inconnue de l'écran ne change aucun nombre.
    const unknown = withoutComment(list, threads, comment("r9", { parentId: "1" }));
    expect(unknown.comments.map((item) => item.replyCount)).toEqual([2, 0]);
    expect(withReplyCount(list, "1", -5)[0]!.replyCount).toBe(0);
  });

  it("le nombre de commentaires de la publication vient du serveur, jamais de la longueur de la liste affichée", () => {
    const section = read("components/comments-section.tsx");
    expect(section).not.toContain("onCountChange");
    expect(section).not.toMatch(/comments\.length\)/);
    expect(section.match(/onChanged\?\.\(\);/g)!.length).toBeGreaterThanOrEqual(3);
    const screen = read("app/(app)/publication.tsx");
    expect(screen).toContain("setCommentCount((await fetchPost(id)).commentCount);");
    expect(screen).toContain("onChanged={refreshCommentCount}");
    expect(screen).toContain("commentCount={commentCount ?? post.commentCount}");
  });

  it("après un blocage depuis le menu, le fil est relu auprès du serveur (les réponses faites à ce compte partent aussi)", () => {
    const section = read("components/comments-section.tsx");
    const blocked = section.slice(section.indexOf("onBlocked={() => {"), section.indexOf("onReported={() => {"));
    expect(blocked).toContain("void load();");
    expect(blocked).toContain("onChanged?.();");
  });
});

describe("aimer un commentaire", () => {
  it("le cœur bouge tout de suite, d'un seul cran, jamais sous zéro", () => {
    expect(optimisticLikeCount({ likeCount: 2, viewerHasLiked: false }, true)).toBe(3);
    expect(optimisticLikeCount({ likeCount: 2, viewerHasLiked: true }, false)).toBe(1);
    // Déjà dans l'état voulu : rien ne bouge.
    expect(optimisticLikeCount({ likeCount: 2, viewerHasLiked: true }, true)).toBe(2);
    expect(optimisticLikeCount({ likeCount: 0, viewerHasLiked: true }, false)).toBe(0);
    expect(optimisticLikeCount({ likeCount: undefined, viewerHasLiked: undefined }, true)).toBe(1);

    const list = [comment("1", { likeCount: 2 }), comment("2", { likeCount: 5 })];
    const liked = withLike(list, "1", true, 3);
    expect(liked.map((item) => [item.likeCount, item.viewerHasLiked])).toEqual([[3, true], [5, false]]);
    // Les autres commentaires ne sont pas recopiés.
    expect(liked[1]).toBe(list[1]);
    expect(withLike(list, "1", false, -4)[0]!.likeCount).toBe(0);
  });

  it("si le serveur refuse, le cœur revient à son état ; trop de « j'aime » : la phrase du serveur", () => {
    const section = read("components/comments-section.tsx");
    const toggle = section.slice(section.indexOf("async function toggleLike("), section.indexOf("async function handleRemoveMention("));
    expect(toggle).toContain("const before = { liked: comment.viewerHasLiked === true, count: comment.likeCount ?? 0 };");
    expect(toggle).toContain("patch(comment, (list) => withLike(list, comment.id, before.liked, before.count));");
    expect(toggle).toContain("showToast(e instanceof ApiError && e.status === 429 ? e.message : t.commentThreads.likeError);");
    // Le nombre affiché ensuite est celui du serveur.
    expect(toggle).toContain("withLike(list, comment.id, result.viewerHasLiked, result.likeCount)");
  });

  it("accessibilité : le cœur annonce son action, son état et son nombre ; cible d'au moins 44 points par le remplissage", () => {
    expect(likeButtonLabel(false, 0)).toBe("Aimer ce commentaire, 0 j'aime");
    expect(likeButtonLabel(true, 3)).toBe("Ne plus aimer, 3 j'aime");
    setActiveLocale("en");
    expect(likeButtonLabel(false, 1)).toBe("Like this comment, 1 like");
    expect(likeButtonLabel(true, 2)).toBe("Unlike, 2 likes");

    const section = read("components/comments-section.tsx");
    const heart = section.slice(section.indexOf("onPress={() => void toggleLike(comment)}"), section.indexOf('testID="repondre-commentaire"'));
    expect(heart).toContain("accessibilityLabel={likeButtonLabel(liked, likeCount)}");
    expect(heart).toContain("accessibilityState={{ selected: liked }}");
    expect(heart).toContain("aria-pressed={liked}");
    expect(heart).not.toContain("hitSlop");
    expect(section).toMatch(/like: \{ minHeight: 44, minWidth: 44, /);
    expect(section).toMatch(/metaButton: \{ minHeight: 44, /);
    expect(section).toMatch(/cancelReply: \{ minHeight: 44, minWidth: 44, /);
  });
});

describe("répondre", () => {
  it("le champ dit à qui l'on répond, avec un bouton pour annuler ; l'erreur du serveur s'affiche sous le champ", () => {
    const section = read("components/comments-section.tsx");
    expect(section).toContain("onPress={() => setReplyTo({ targetId: comment.id, rootId: rootIdOf(comment), name: comment.author.displayName })}");
    const banner = section.slice(section.indexOf("{replyTo ? ("), section.indexOf("{suggestions.length > 0 && token ? ("));
    expect(banner).toContain("{t.commentThreads.replyingTo(replyTo.name)}");
    expect(banner).toContain("onPress={() => setReplyTo(null)}");
    expect(banner).toContain("accessibilityLabel={t.commentThreads.cancelReply}");
    expect(section).toContain("setSendError(e instanceof ApiError ? e.message : t.comments.error);");
    // Après l'envoi, on ne répond plus à personne.
    expect(section.slice(section.indexOf("async function handleSend()"), section.indexOf("function remove("))).toContain("setReplyTo(null);");
  });
});

describe("réglage « Qui peut me mentionner »", () => {
  const setting = read("components/mentions-from-setting.tsx");

  it("dans les Réglages, dans le bloc « Confidentialité du compte », juste après « Compte privé » et avant « Qui peut m'envoyer des pièces »", () => {
    const settings = read("app/(app)/settings.tsx");
    const account = settings.indexOf("<PrivateAccountSetting />");
    const mentions = settings.indexOf("<MentionsFromSetting />");
    const pieces = settings.indexOf("<PieceSendsSetting />");
    expect(account).toBeGreaterThan(-1);
    expect(mentions).toBeGreaterThan(account);
    expect(pieces).toBeGreaterThan(mentions);
    // Lot « découverte » (migration 0050) : « Proposer mon compte aux autres membres » entre les deux, du même bloc ;
    // puis les deux réglages des étagères des amis (migration 0058).
    expect(settings.slice(mentions + "<MentionsFromSetting />".length, pieces).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\s+/g, " ").trim()).toBe("<DiscoverableSetting /> <FriendShelvesSetting />");
  });

  it("caché tant que le serveur n'a pas les mentions ; trois choix ; valeur de départ protectrice", () => {
    expect(DEFAULT_MENTIONS_FROM).toBe("following");
    expect(setting).toContain("const stored = profile?.mentionsFrom;");
    expect(setting).toContain("if (stored === undefined) return null;");
    // Lot « finitions de l'œil » : la liste à cocher des Réglages (components/settings-choice.tsx), même groupe radio.
    expect(setting).toContain("<SettingsChoice");
    for (const value of ["everyone", "following", "nobody"]) expect(setting, value).toContain(`{ value: "${value}", label: t.commentThreads.${value} }`);
    expect(setting).toContain("<Text style={styles.hint}>{t.commentThreads.settingHelp}</Text>");
  });

  it("le choix bouge tout de suite ; si l'enregistrement échoue, il revient et un message le dit", () => {
    const choose = setting.slice(setting.indexOf("async function choose("), setting.indexOf("if (stored === undefined) return null;"));
    expect(choose.indexOf("setValue(next);")).toBeLessThan(choose.indexOf("await updateMentionsFrom(next);"));
    expect(choose).toContain("setValue(previous);");
    expect(choose).toContain("setError(true);");
    expect(setting).toContain("{error ? <ErrorMessage style={styles.error}>{t.commentThreads.settingError}</ErrorMessage> : null}");
    expect(read("lib/api.ts")).toContain('await authorizedFetch("/api/me/mentions-from", { method: "PUT", body: JSON.stringify(payload) });');
  });
});

describe("onglet Activité : « reply » et « mention »", () => {
  const notification = (type: AppNotification["type"]): AppNotification => ({
    id: "n1",
    type,
    actor: { id: CARL, username: "carl", displayName: "Carl", avatarUrl: null },
    createdAt: "2026-11-18T10:00:00.000Z",
    read: false,
    postId: "b1000000-0000-4000-8000-000000000001",
    moderation: null,
    reportedType: null,
  });

  it("chacune a sa phrase, dans les deux langues, et mène à la publication", () => {
    expect(NOTIFICATION_TYPES).toContain("reply");
    expect(NOTIFICATION_TYPES).toContain("mention");
    expect(notificationActionText("reply")).toBe("a répondu à votre commentaire.");
    expect(notificationActionText("mention")).toBe("vous a mentionné(e) dans un commentaire.");
    setActiveLocale("en");
    expect(notificationActionText("reply")).toBe("replied to your comment.");
    expect(notificationActionText("mention")).toBe("mentioned you in a comment.");
    for (const type of ["reply", "mention"] as const) {
      expect(notificationTarget(notification(type), CARL)).toEqual({ screen: "post", id: "b1000000-0000-4000-8000-000000000001" });
      expect(knownNotifications([notification(type)])).toHaveLength(1);
    }
  });
});

describe("textes", () => {
  it("la section « commentThreads » : français (vouvoiement) et anglais", () => {
    expect(fr.commentThreads.reply).toBe("Répondre");
    expect(fr.commentThreads.replyingTo("Carl")).toBe("Réponse à Carl");
    expect(fr.commentThreads.showReplies(1)).toBe("Voir la réponse");
    expect(fr.commentThreads.showReplies(4)).toBe("Voir les 4 réponses");
    expect(fr.commentThreads.hideReplies).toBe("Masquer les réponses");
    expect(fr.commentThreads.like).toBe("Aimer ce commentaire");
    expect(fr.commentThreads.unlike).toBe("Ne plus aimer");
    expect(fr.commentThreads.likes(3)).toBe("3 j'aime");
    expect(fr.commentThreads.mentionHint).toBe("Tapez @ pour mentionner un membre");
    expect(fr.commentThreads.settingTitle).toBe("Qui peut me mentionner");
    expect(fr.commentThreads.settingHelp).toBe("Dans un commentaire ou sur une photo.");
    // Lot « finitions de l'œil » : « Comptes que je suis », la même forme que les autres blocs « Qui peut… ».
    expect([fr.commentThreads.everyone, fr.commentThreads.following, fr.commentThreads.nobody]).toEqual(["Tout le monde", "Comptes que je suis", "Personne"]);
    expect(fr.commentThreads.removeMyMention).toBe("Retirer ma mention");

    expect(en.commentThreads.reply).toBe("Reply");
    expect(en.commentThreads.replyingTo("Carl")).toBe("Replying to Carl");
    expect(en.commentThreads.showReplies(1)).toBe("View 1 reply");
    expect(en.commentThreads.showReplies(4)).toBe("View 4 replies");
    expect(en.commentThreads.hideReplies).toBe("Hide replies");
    expect(en.commentThreads.likes(1)).toBe("1 like");
    expect(en.commentThreads.likes(3)).toBe("3 likes");
    expect(en.commentThreads.mentionHint).toBe("Type @ to mention a member");
    expect(en.commentThreads.settingTitle).toBe("Who can mention me");
    expect([en.commentThreads.everyone, en.commentThreads.following, en.commentThreads.nobody]).toEqual(["Everyone", "Accounts I follow", "No one"]);
    expect(en.commentThreads.removeMyMention).toBe("Remove my mention");
    expect(Object.keys(en.commentThreads)).toEqual(Object.keys(fr.commentThreads));
    // Jamais de tutoiement.
    for (const text of Object.values(fr.commentThreads)) expect(typeof text === "string" ? text : text("Carl" as never), "tutoiement").not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
  });

  it("la nouvelle section est ajoutée à la fin des deux catalogues", () => {
    // Après elle : les sections des migrations 0047 (photos-identifications.test.ts) et 0048 (publications-enregistrees.test.ts).
    for (const catalog of [fr, en]) {
      const keys = Object.keys(catalog);
      expect(keys.indexOf("commentThreads")).toBe(keys.indexOf("memberLists") + 1);
      expect(keys.slice(keys.indexOf("commentThreads") + 1)).toEqual(["carousel", "savedPosts", "profilePins", "forYou", "activityPush", "look", "friendShelves"]);
    }
  });

  it(`au plus ${MENTION_MAX_PER_TEXT} mentions par commentaire, la même règle que le serveur (code partagé)`, () => {
    expect(extractMentions("@aaa @bbb @ccc @ddd @eee @fff")).toHaveLength(MENTION_MAX_PER_TEXT);
  });

  it("la politique de confidentialité dit ce que sont les réponses, les « j'aime » et les mentions, et comment s'en protéger", () => {
    const text = (doc: typeof privacyPolicy) => doc.sections.flatMap((section) => section.blocks.flat()).join("\n");
    const french = text(privacyPolicy);
    expect(french).toContain(
      "Vous pouvez répondre à un commentaire, l'aimer et mentionner un membre avec @. Le réglage « Qui peut me mentionner » vous laisse choisir qui peut vous mentionner ou vous identifier : tout le monde, les comptes que vous suivez (réglage de départ), ou personne. Une mention vous est signalée par une notification et vous pouvez la retirer. Si vous bloquez un membre, ses mentions de vous disparaissent."
    );
    const english = text(privacyPolicyEn);
    expect(english).toContain(
      "You can reply to a comment, like it and mention a member with @. The setting “Who can mention me” lets you choose who can mention or tag you: everyone, accounts you follow (the starting value), or no one. You are notified when you are mentioned and you can remove the mention. If you block a member, their mentions of you disappear."
    );
    // Les mentions figurent dans ce qui est conservé, et dans ce qui est effacé avec le compte
    // (suivies des personnes identifiées, migration 0047).
    // (« publications enregistrées » : migration 0048, publications-enregistrees.test.ts.)
    expect(french).toContain("commentaires, mentions, personnes identifiées, « j'aime », publications enregistrées, notifications");
    expect(french).toContain("publications, commentaires, mentions, personnes identifiées, « j'aime », publications enregistrées, abonnements");
    expect(english).toContain("comments, mentions, tagged people, likes, saved posts, notifications");
    expect(english).toContain("posts, comments, mentions, tagged people, likes, saved posts, follows");
    // Le nom du réglage est celui de l'app.
    expect(french).toContain(`« ${fr.commentThreads.settingTitle} »`);
    expect(english).toContain(`“${en.commentThreads.settingTitle}”`);
  });
});
