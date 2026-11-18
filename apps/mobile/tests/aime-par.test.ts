import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { isOwnMemberList, isPostGone, likeCountOpensList, likesListRoute, likesListTexts, memberListTitle, parseLikeCount, parseMemberListParams } from "../src/lib/member-lists";

// Liste « Aimé par » (lot « vie sociale », sans migration), côté app : le
// nombre de « j'aime » qui ouvre la liste, ce que l'écran « membres » lit dans
// son adresse, la phrase « certains comptes n'apparaissent pas » et les textes.

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const POST = "b1000000-0000-4000-8000-000000000001";
const ME = "a0000000-0000-4000-8000-000000000001";

afterEach(() => setActiveLocale("fr"));

describe("le nombre de « j'aime » sous une publication", () => {
  it("à zéro : un simple texte, jamais un lien ; dès un « j'aime » : un lien vers la liste", () => {
    expect(likeCountOpensList(0)).toBe(false);
    expect(likeCountOpensList(-1)).toBe(false);
    expect(likeCountOpensList(1)).toBe(true);
    expect(likeCountOpensList(250)).toBe(true);

    const card = read("components/post-card.tsx");
    // Une seule zone cliquable pour le nombre, et seulement au-dessus de zéro.
    expect(card).toContain("{likeCountOpensList(reactionCount) ? (");
    expect(card.match(/likesListRoute\(/g)).toHaveLength(1);
    expect(card).toContain("onPress={() => router.push(likesListRoute(post.id, reactionCount))}");
    // À zéro : le nombre reste affiché, en simple texte, et rien d'autre à sa place.
    expect(card).toContain("{likeCountOpensList(reactionCount) ? null : <Text style={styles.reactCount}>{reactionCount}</Text>}");
    expect(card.slice(card.indexOf('testID="nombre-jaime"'), card.indexOf("onPress={onOpenComments}"))).toContain(") : null}");
  });

  it("il mène à « /membres » avec la publication et le nombre affiché", () => {
    expect(likesListRoute(POST, 12)).toEqual({ pathname: "/membres", params: { kind: "likes", id: POST, count: "12" } });
  });

  it("le cœur garde son rôle (aimer, ne plus aimer) : le nombre qui ouvre la liste n'est pas dans son bouton", () => {
    const card = read("components/post-card.tsx");
    const heart = card.slice(card.indexOf("onPress={handleReactButton}"), card.indexOf("{likeCountOpensList(reactionCount) ? ("));
    expect(heart).toContain("accessibilityLabel={reacted ? t.post.unlike : t.post.like}");
    expect(heart).toContain("<HeartIcon");
    expect(heart).not.toContain("likesListRoute");
    // Toucher deux fois l'image aime toujours.
    expect(card).toContain("onPress={handleMediaPress}");
  });

  it("à zéro, toucher le « 0 » aime comme avant : le nombre est DANS le bouton du cœur, et seulement à zéro", () => {
    const card = read("components/post-card.tsx");
    const heart = card.slice(card.indexOf("onPress={handleReactButton}"), card.indexOf("{likeCountOpensList(reactionCount) ? ("));
    expect(heart.match(/\{reactionCount\}/g)).toHaveLength(1);
    expect(heart).toContain("{likeCountOpensList(reactionCount) ? null : <Text style={styles.reactCount}>{reactionCount}</Text>}");
    expect(heart.trimEnd().endsWith("</Pressable>")).toBe(true);
    // Plus de vue sans geste à côté du cœur.
    expect(card).not.toContain("likeCountPlain");
  });

  it("le cœur : une cible d'au moins 44 points par le remplissage (le site ignore « hitSlop »), sans déplacer l'icône ni le nombre", () => {
    const card = read("components/post-card.tsx");
    const heart = card.slice(card.indexOf("onPress={handleReactButton}"), card.indexOf("{likeCountOpensList(reactionCount) ? ("));
    expect(heart).not.toContain("hitSlop");
    expect(heart).toContain("style={[styles.likeButton, likeCountOpensList(reactionCount) ? styles.likeButtonBeforeCount : styles.likeButtonAlone]}");

    const style = (name: string): Record<string, number | string> => {
      const body = card.match(new RegExp(`\\n  ${name}: \\{([^}]*)\\}`))![1]!;
      return Object.fromEntries(body.split(",").map((pair) => pair.split(":").map((part) => part.trim())).map(([key, value]) => [key!, Number.isNaN(Number(value)) ? value!.replace(/"/g, "") : Number(value)]));
    };
    const ICON = 19;
    const button = style("likeButton");
    const beforeCount = style("likeButtonBeforeCount");
    const alone = style("likeButtonAlone");
    const count = style("likeCount");
    expect(heart).toContain(`<HeartIcon size={${ICON}}`);
    expect(button).toMatchObject({ minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center" });
    // Suivi du nombre cliquable : 44 de large, tout en remplissage réel.
    expect(Number(button.paddingLeft) + ICON + Number(beforeCount.paddingRight)).toBeGreaterThanOrEqual(44);
    // L'icône ne bouge pas, et la zone reste dans la marge de la publication.
    expect(button.marginLeft).toBe(-Number(button.paddingLeft));
    expect(card).toContain("post: { paddingHorizontal: space.lg,");
    expect(Number(button.paddingLeft)).toBeLessThanOrEqual(24);
    // Le nombre reste à 6 points de l'icône, dans les deux cas : aucun point mort entre les deux.
    expect(Number(beforeCount.paddingRight) + Number(count.paddingLeft ?? 0)).toBe(6);
    expect(alone.gap).toBe(6);
    // À zéro : la zone déborde à droite du « 0 » sans déplacer le bouton des commentaires.
    expect(alone.marginRight).toBe(-Number(alone.paddingRight));
    // La rangée garde sa hauteur (44 - 2 × 6 = 32).
    expect(button.marginVertical).toBe(-6);
  });

  it("accessibilité : un lien, annoncé avec le nombre, d'au moins 44 points de haut par le remplissage (pas un texte plus gros)", () => {
    const card = read("components/post-card.tsx");
    const link = card.slice(card.indexOf("router.push(likesListRoute"), card.indexOf("onPress={onOpenComments}"));
    expect(link).toContain('accessibilityRole="link"');
    expect(link).toContain("accessibilityLabel={t.memberLists.openLikes(reactionCount)}");
    expect(link).toContain("style={styles.likeCount}");
    expect(link).toContain("<Text style={styles.reactCount}>{reactionCount}</Text>");
    expect(card).toMatch(/likeCount: \{ minHeight: 44, /);
    // Le même style de texte qu'à zéro et que le nombre de commentaires.
    expect(card.match(/reactCount: \{[^}]*\}/)![0]).toBe("reactCount: { fontSize: font.secondary, color: color.acier }");
  });

  it("libellé lu par les lecteurs d'écran, au singulier et au pluriel, dans les deux langues", () => {
    expect(fr.memberLists.openLikes(1)).toBe("1 j'aime, voir qui a aimé");
    expect(fr.memberLists.openLikes(12)).toBe("12 j'aime, voir qui a aimé");
    expect(en.memberLists.openLikes(1)).toBe("1 like, see who liked");
    expect(en.memberLists.openLikes(12)).toBe("12 likes, see who liked");
  });

  it("trop de « j'aime » en peu de temps (429) : la phrase du serveur est montrée, le cœur revient à son état", () => {
    const card = read("components/post-card.tsx");
    expect(card).toContain("if (e instanceof ApiError && e.status === 429) showToast(e.message);");
    expect(card.match(/tooManyLikes\(e\);/g)).toHaveLength(2);
  });
});

describe("adresse de l'écran « membres » : kind=likes", () => {
  it("« Aimé par » : la publication, en minuscules", () => {
    expect(parseMemberListParams({ kind: "likes", id: POST })).toEqual({ kind: "likes", postId: POST });
    expect(parseMemberListParams({ kind: "likes", id: POST.toUpperCase() })).toEqual({ kind: "likes", postId: POST });
  });

  it("refusé : sans identifiant de publication, ou avec un identifiant qui n'en est pas un — rien n'est demandé au serveur", () => {
    for (const id of [undefined, null, "", "moi", "../me", `${POST}/likes`, `${POST}?x=1`, [POST], 3, {}]) expect(parseMemberListParams({ kind: "likes", id }), String(id)).toBeNull();
    // La liste des personnes qui ont vu une story n'existe pas encore.
    expect(parseMemberListParams({ kind: "viewers", id: POST })).toBeNull();
  });

  it("ce n'est la liste de personne : jamais « Retirer », même sous sa propre publication", () => {
    expect(isOwnMemberList({ kind: "likes", postId: POST }, ME)).toBe(false);
    expect(isOwnMemberList({ kind: "likes", postId: POST }, undefined)).toBe(false);
    const screen = read("app/(app)/membres.tsx");
    const likes = screen.slice(screen.indexOf("function LikesList("), screen.indexOf("export default function MembersScreen()"));
    expect(likes).not.toContain("RemoveFollowerSheet");
    expect(likes).not.toContain("showsRemoveFollower");
  });

  it("titre de l'écran, dans les deux langues", () => {
    expect(memberListTitle("likes")).toBe("Aimé par");
    setActiveLocale("en");
    expect(memberListTitle("likes")).toBe("Liked by");
  });

  it("le nombre lu dans l'adresse : des chiffres seulement, sinon inconnu", () => {
    expect(parseLikeCount("12")).toBe(12);
    expect(parseLikeCount("0")).toBe(0);
    for (const value of [undefined, null, "", "douze", "-3", "1.5", "1e9", "12345678901", ["12"], 12]) expect(parseLikeCount(value), String(value)).toBeNull();
  });
});

describe("« Certains comptes n'apparaissent pas dans cette liste. »", () => {
  const PARTIAL = "Certains comptes n'apparaissent pas dans cette liste.";
  const EMPTY = "Personne n'a encore aimé cette publication.";

  it("montrée seulement sous une liste entièrement chargée et plus courte que le nombre de « j'aime »", () => {
    expect(likesListTexts(3, false, 5)).toEqual({ emptyText: PARTIAL, note: PARTIAL });
  });

  it("refusé : pendant le chargement (il reste des pages), quand tout le monde est là, ou quand le nombre est inconnu", () => {
    expect(likesListTexts(3, true, 5).note).toBeNull();
    expect(likesListTexts(30, true, 35).note).toBeNull();
    expect(likesListTexts(5, false, 5).note).toBeNull();
    // Quelqu'un a aimé depuis l'ouverture : la liste est plus longue que le nombre.
    expect(likesListTexts(6, false, 5).note).toBeNull();
    expect(likesListTexts(3, false, null).note).toBeNull();
  });

  it("liste vide : « Personne n'a encore aimé » — sauf si la publication a des « j'aime » de comptes qu'on ne voit pas", () => {
    expect(likesListTexts(0, false, 0)).toEqual({ emptyText: EMPTY, note: null });
    expect(likesListTexts(0, false, null)).toEqual({ emptyText: EMPTY, note: null });
    // Deux « j'aime », aucun compte visible : on ne dit pas « personne », et la phrase n'est pas dite deux fois.
    expect(likesListTexts(0, false, 2)).toEqual({ emptyText: PARTIAL, note: null });
  });

  it("jamais de nombre de comptes cachés : la phrase ne contient aucun chiffre, dans les deux langues", () => {
    expect(fr.memberLists.likesPartial).not.toMatch(/\d/);
    expect(en.memberLists.likesPartial).not.toMatch(/\d/);
    setActiveLocale("en");
    expect(likesListTexts(3, false, 5).note).toBe("Some accounts do not appear in this list.");
    expect(likesListTexts(0, false, 0).emptyText).toBe("No one has liked this post yet.");
  });
});

describe("l'écran « Aimé par »", () => {
  const screen = read("app/(app)/membres.tsx");
  const likes = screen.slice(screen.indexOf("function LikesList("), screen.indexOf("export default function MembersScreen()"));

  it("la liste partagée : bouton d'abonnement à trois états sauf sur sa propre ligne, toucher une ligne ouvre le profil", () => {
    expect(likes).toContain("<MemberList");
    expect(likes).toContain("renderActions={(member) => (member.isMe ? null : <RowFollowButton member={member} onState={pages.setFollowState} onChanged={countsChanged} />)}");
    expect(likes).toContain('onOpenProfile={(member) => router.push({ pathname: "/profil", params: { id: member.id } })}');
    expect(screen).toContain('<LikesList key={target.postId} postId={target.postId} reactionCount={parseLikeCount(params.count)} />');
  });

  it("chargement : défilement, tirer pour rafraîchir, « Voir la suite », échec avec « Réessayer »", () => {
    expect(likes).toContain("useMemberPages(fetchPage, t.memberLists.loadError)");
    expect(likes).toContain("if (pages.autoLoad) void pages.loadMore(false);");
    expect(likes).toContain("onRefresh={() => void pages.refresh()}");
    expect(likes).toContain("onRetry={() => void load()}");
    expect(likes).toContain("loadMoreLabel={t.memberLists.loadMore}");
    // La phrase sous la liste : jamais avant le premier chargement.
    expect(likes).toContain("footerNote={pages.members === null ? null : texts.note}");
    expect(read("components/member-list.tsx")).toContain("{footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}");
  });

  it("publication indisponible (404) : l'état « Cette publication n'est pas disponible. », sans « Réessayer » ; toute autre erreur reste une erreur", () => {
    expect(isPostGone(404, "post_not_found")).toBe(true);
    expect(isPostGone(404, "user_not_found")).toBe(false);
    expect(isPostGone(500, "post_not_found")).toBe(false);
    expect(isPostGone(429, "member_list_limit")).toBe(false);
    expect(likes).toContain("if (e instanceof ApiError && isPostGone(e.status, e.body.error)) setGone(true);");
    expect(likes).toContain("<ErrorMessage style={styles.goneMessage}>{t.postDetail.notFound}</ErrorMessage>");
    expect(fr.postDetail.notFound).toBe("Cette publication n'est pas disponible.");
    // Le retour, sans écran précédent (lien direct) : la publication.
    expect(screen).toContain('else if (target?.kind === "likes") router.replace({ pathname: "/publication", params: { id: target.postId } });');
  });

  it("appel au serveur : la liste d'une publication, avec son curseur", () => {
    const api = read("lib/api.ts");
    expect(api).toContain("export async function fetchPostLikes(postId: string, cursor?: string): Promise<MemberPage> {");
    expect(api).toContain("authorizedFetch(`/api/posts/${postId}/likes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : \"\"}`)");
  });

  it("une ligne ne montre jamais de date (la liste ne dit pas quand quelqu'un a aimé)", () => {
    const list = read("components/member-list.tsx");
    expect(list).not.toMatch(/timeAgo|createdAt|likedAt/);
    expect(likes).not.toMatch(/timeAgo|createdAt|likedAt/);
  });
});

describe("textes", () => {
  it("les phrases validées, en français et en anglais, avec les mêmes clés", () => {
    expect(fr.memberLists).toMatchObject({
      likesTitle: "Aimé par",
      likesEmpty: "Personne n'a encore aimé cette publication.",
      likesPartial: "Certains comptes n'apparaissent pas dans cette liste.",
    });
    expect(en.memberLists).toMatchObject({
      likesTitle: "Liked by",
      likesEmpty: "No one has liked this post yet.",
      likesPartial: "Some accounts do not appear in this list.",
    });
    expect(Object.keys(en.memberLists).sort()).toEqual(Object.keys(fr.memberLists).sort());
  });

  it("politique de confidentialité : qui voit vos « j'aime », dans « Qui peut voir quoi », dans les deux langues", () => {
    const section = (doc: typeof privacyPolicy, title: string) => doc.sections.find((s) => s.title.startsWith(title))!.blocks.flat().join("\n");
    const french = section(privacyPolicy, "Qui peut voir quoi");
    expect(french).toContain(
      "Quand vous aimez une publication, les membres qui peuvent voir cette publication peuvent voir que vous l'avez aimée. Si votre compte est privé, seuls vos abonnés et l'auteur de la publication le voient."
    );
    const english = section(privacyPolicyEn, "Who can see what");
    expect(english).toContain("When you like a post, members who can see that post can see that you liked it. If your account is private, only your followers and the post's author can see it.");
    // Plus aucune phrase ne dit que le « j'aime » d'un compte privé suit la seule visibilité de la publication.
    expect(french).not.toContain("écrivez ou aimez");
    expect(english).not.toContain("write or like");
    expect(french).toContain("son auteur est informé de vos commentaires et de vos j'aime.");
    expect(english).toContain("its author is told of your comments and of your likes.");
  });
});
