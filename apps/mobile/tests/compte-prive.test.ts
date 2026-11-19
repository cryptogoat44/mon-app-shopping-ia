import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, type AppNotification, type NotificationType } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import {
  CLIENT_LEVEL_QUERY,
  followActionFor,
  followButton,
  followStateOf,
  knownNotifications,
  notificationActionText,
  notificationTarget,
  parseFollowResponse,
  parseMemberListKind,
  pendingRequestsCount,
  showsPrivateShell,
} from "../src/lib/follow-state";

// Compte privé et demandes d'abonnement (lot « vie sociale », migration
// 0045), côté app : le bouton à trois états, le profil réduit d'un compte
// privé, les lignes de l'onglet Activité, le réglage et les textes.

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => setActiveLocale("fr"));

describe("bouton d'abonnement : Suivre, Demandé, Abonné(e)", () => {
  it("l'état vient du serveur ; un serveur d'avant le lot ne donne que « isFollowing »", () => {
    expect(followStateOf({ isFollowing: false, followState: "requested" })).toBe("requested");
    expect(followStateOf({ isFollowing: true, followState: "following" })).toBe("following");
    expect(followStateOf({ isFollowing: false, followState: "none" })).toBe("none");
    expect(followStateOf({ isFollowing: true })).toBe("following");
    expect(followStateOf({ isFollowing: false })).toBe("none");
    // Une valeur inconnue ne devient jamais « abonné(e) » par erreur.
    expect(followStateOf({ isFollowing: false, followState: "autre" as never })).toBe("none");
  });

  it("ce que fait le bouton : suivre, ne plus suivre, ou annuler la demande", () => {
    expect(followActionFor("none")).toBe("follow");
    expect(followActionFor("following")).toBe("unfollow");
    expect(followActionFor("requested")).toBe("cancel");
  });

  it("libellés : « Demandé » porte l'indication « Touchez pour annuler » ; seul « Suivre » est le bouton principal", () => {
    expect(followButton("none", fr.userProfile.unfollow)).toEqual({ label: "Suivre", hint: undefined, primary: true });
    expect(followButton("requested", fr.userProfile.unfollow)).toEqual({ label: "Demandé", hint: "Touchez pour annuler", primary: false });
    expect(followButton("following", fr.userProfile.unfollow)).toEqual({ label: "Ne plus suivre", hint: undefined, primary: false });
    expect(followButton("following", fr.peopleSearch.following).label).toBe("Suivi(e)");
    setActiveLocale("en");
    expect(followButton("requested", en.userProfile.unfollow)).toEqual({ label: "Requested", hint: "Tap to cancel", primary: false });
    expect(followButton("none", en.userProfile.unfollow).label).toBe("Follow");
  });

  it("réponse du serveur : seule « requested » vaut une demande ; tout le reste, un abonnement", () => {
    expect(parseFollowResponse({ state: "requested" })).toBe("requested");
    expect(parseFollowResponse({ state: "following" })).toBe("following");
    for (const body of [null, undefined, {}, { state: "autre" }, "requested", 204]) expect(parseFollowResponse(body)).toBe("following");
  });

  it("les deux écrans passent par ces fonctions, et l'app demande le nouveau vocabulaire (« v=2 »)", () => {
    expect(CLIENT_LEVEL_QUERY).toBe("v=2");
    const profil = read("app/(app)/profil.tsx");
    expect(profil).toContain("const follow = followButton(followState, t.userProfile.unfollow);");
    expect(profil).toContain("accessibilityHint={follow.hint}");
    expect(profil).toContain('if (action === "follow") await followUser(profile.id, "profile");');
    const search = read("app/(app)/people-search.tsx");
    expect(search).toContain("const button = followButton(state, t.peopleSearch.following);");
    expect(search).toContain('setState(await followUser(person.id, "search"));');
    const api = read("lib/api.ts");
    expect(api).toContain("authorizedFetch(`/api/follows/${userId}?${CLIENT_LEVEL_QUERY}`, { method: \"POST\" })");
    // Une demande envoyée n'est jamais comptée comme un abonnement.
    expect(api).toContain('if (state === "following") track("follow_added", { context });');
    for (const route of ["/api/notifications?${CLIENT_LEVEL_QUERY}", "/api/notifications/unread-count?${CLIENT_LEVEL_QUERY}", "/api/notifications/read-all?${CLIENT_LEVEL_QUERY}"]) expect(api, route).toContain(route);
  });
});

describe("profil d'un compte privé", () => {
  const stranger = { isMe: false, isFollowing: false, followState: "none" as const, isPrivate: true };

  it("réduit (cadenas, phrase, aucune grille) pour qui n'est pas un abonné accepté — une demande en attente n'y change rien", () => {
    expect(showsPrivateShell(stranger)).toBe(true);
    expect(showsPrivateShell({ ...stranger, followState: "requested" })).toBe(true);
  });

  it("entier pour l'abonné accepté, pour soi-même, pour un compte public et pour un serveur d'avant le lot", () => {
    expect(showsPrivateShell({ ...stranger, isFollowing: true, followState: "following" })).toBe(false);
    expect(showsPrivateShell({ ...stranger, isMe: true })).toBe(false);
    expect(showsPrivateShell({ ...stranger, isPrivate: false })).toBe(false);
    expect(showsPrivateShell({ isMe: false, isFollowing: false })).toBe(false);
  });

  it("l'écran ne montre alors ni grille, ni nombre de publications, ni collections, et ne charge pas la suite", () => {
    const profil = read("app/(app)/profil.tsx");
    expect(profil).toContain("const isShell = showsPrivateShell(profile);");
    expect(profil).toContain("data={isShell ? [] : chunk(posts ?? [], 3)}");
    expect(profil).toContain("onEndReached={isShell ? undefined : handleLoadMore}");
    expect(profil).toContain("{isShell ? null : <Text style={styles.count}>{`${t.userProfile.posts_count(profile.postsCount)}${COUNT_SEPARATOR}`}</Text>}");
    expect(profil).toContain("<Text style={styles.shellText}>{t.privateAccount.shellNotice}</Text>");
    const shell = profil.slice(profil.indexOf("{isShell ? ("), profil.indexOf("<Text style={styles.sectionTitle}>"));
    expect(shell.indexOf("<LockIcon")).toBeGreaterThan(-1);
    // Les collections et le titre « Publications » sont dans l'autre branche.
    expect(shell.indexOf("<LockIcon")).toBeLessThan(shell.indexOf("<FriendCollections"));
  });
});

describe("onglet Activité", () => {
  const notification = (type: NotificationType, postId: string | null = null): AppNotification => ({
    id: "n1",
    type,
    actor: { id: "acteur", username: "alice", displayName: "Alice", avatarUrl: null },
    createdAt: "2026-11-18T10:00:00.000Z",
    read: false,
    postId,
    moderation: null,
    reportedType: null,
  });

  it("texte des lignes : demande reçue et demande acceptée, dans les deux langues ; les anciennes ne changent pas", () => {
    expect(notificationActionText("follow_request")).toBe("demande à vous suivre.");
    expect(notificationActionText("follow_accepted")).toBe("a accepté votre demande.");
    expect(notificationActionText("follow")).toBe(fr.notifications.follow);
    expect(notificationActionText("like")).toBe(fr.notifications.like);
    expect(notificationActionText("comment")).toBe(fr.notifications.comment);
    expect(notificationActionText("piece_received")).toBe(fr.notifications.pieceReceived);
    setActiveLocale("en");
    expect(notificationActionText("follow_request")).toBe("asked to follow you.");
    expect(notificationActionText("follow_accepted")).toBe("accepted your request.");
  });

  it("où mène une ligne : la liste des demandes, le profil de la personne qui a accepté, la publication, les pièces reçues", () => {
    expect(notificationTarget(notification("follow_request"), "acteur")).toEqual({ screen: "requests" });
    expect(notificationTarget(notification("follow_accepted"), "acteur")).toEqual({ screen: "profile", id: "acteur" });
    expect(notificationTarget(notification("follow"), "acteur")).toEqual({ screen: "profile", id: "acteur" });
    expect(notificationTarget(notification("like", "p1"), "acteur")).toEqual({ screen: "post", id: "p1" });
    expect(notificationTarget(notification("comment", "p1"), "acteur")).toEqual({ screen: "post", id: "p1" });
    expect(notificationTarget(notification("like"), "acteur")).toEqual({ screen: "profile", id: "acteur" });
    expect(notificationTarget(notification("piece_received"), "acteur")).toEqual({ screen: "pieces" });
  });

  it("un type que cette version ne connaît pas n'est jamais affiché sous le texte d'un autre", () => {
    const list = [notification("follow_request"), { ...notification("like"), type: "type_d_une_version_future" as NotificationType }, notification("like")];
    expect(knownNotifications(list).map((n) => n.type)).toEqual(["follow_request", "like"]);
    for (const type of NOTIFICATION_TYPES) expect(knownNotifications([notification(type)])).toHaveLength(1);
    const screen = read("app/(app)/(tabs)/activite.tsx");
    expect(screen).toContain("setNotifications(knownNotifications(data));");
    // La suite se décide sur la page reçue, pas sur ce qui en est affiché.
    expect(screen).toContain("setHasMore(data.length === NOTIFICATIONS_PAGE_SIZE);");
  });

  it("l'entrée « Demandes d'abonnement (n) » n'apparaît que s'il y en a, et mène à la liste", () => {
    expect(pendingRequestsCount(null)).toBe(0);
    expect(pendingRequestsCount({})).toBe(0);
    expect(pendingRequestsCount({ isPrivate: true, followRequestsCount: 0 })).toBe(0);
    expect(pendingRequestsCount({ isPrivate: true, followRequestsCount: 3 })).toBe(3);
    expect(pendingRequestsCount({ followRequestsCount: -1 })).toBe(0);
    expect(pendingRequestsCount({ followRequestsCount: Number.NaN })).toBe(0);
    expect(fr.privateAccount.requestsEntry(3)).toBe("Demandes d'abonnement (3)");
    expect(en.privateAccount.requestsEntry(1)).toBe("Follow requests (1)");
    const screen = read("app/(app)/(tabs)/activite.tsx");
    expect(screen).toContain("{requestsCount > 0 ? (");
    expect(screen).toContain('router.push({ pathname: "/membres", params: { kind: "requests" } })');
  });
});

describe("écran des demandes", () => {
  it("« requests » est une des listes de l'écran ; toute valeur inconnue ramène à l'onglet Activité", () => {
    expect(parseMemberListKind("requests")).toBe("requests");
    for (const kind of ["followers", "following", "likes", "viewers"]) expect(parseMemberListKind(kind)).toBe(kind);
    for (const kind of ["", "autre", undefined, null, ["requests"], 3]) expect(parseMemberListKind(kind)).toBeNull();
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain('if (!target) return <Redirect href="/activite" />;');
    expect(screen).toContain('{target.kind === "requests" ? <RequestsList /> : ');
  });

  it("Accepter et Refuser sur chaque ligne, états vide et erreur, suite tant que le serveur en annonce une", () => {
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("if (accept) await acceptFollowRequest(member.id);");
    expect(screen).toContain("else await declineFollowRequest(member.id);");
    expect(screen).toContain("accessibilityLabel={t.privateAccount.acceptLabel(member.displayName)}");
    expect(screen).toContain("accessibilityLabel={t.privateAccount.declineLabel(member.displayName)}");
    expect(screen).toContain("emptyText={t.privateAccount.requestsEmpty}");
    // Une page vide alors qu'il en reste : la suite se décide sur le curseur seul.
    expect(screen).toContain("hasMore: cursor !== null");
    const list = read("components/member-list.tsx");
    expect(list).toContain("<LoadFailure message={error} onRetry={onRetry} />");
    // La phrase « personne » n'apparaît que s'il ne reste rien à charger.
    expect(list).toMatch(/ListEmptyComponent=\{\s*hasMore \? null : \(/);
    expect(list).toContain("<Text style={styles.empty}>{emptyText}</Text>");
    // Jamais de date dans une ligne.
    expect(list).not.toMatch(/createdAt|timeAgo|formatLongDate/);
    const api = read("lib/api.ts");
    expect(api).toContain("authorizedFetch(`/api/follow-requests/${userId}/accept`, { method: \"POST\" })");
    expect(api).toContain("authorizedFetch(`/api/follow-requests/${userId}`, { method: \"DELETE\" })");
  });
});

describe("réglage « Compte privé »", () => {
  const setting = read("components/private-account-setting.tsx");

  it("dans les Réglages, bloc « Confidentialité du compte », juste avant « Qui peut m'envoyer des pièces »", () => {
    const settings = read("app/(app)/settings.tsx");
    const account = settings.indexOf("<PrivateAccountSetting />");
    const pieces = settings.indexOf("<PieceSendsSetting />");
    expect(account).toBeGreaterThan(-1);
    expect(pieces).toBeGreaterThan(account);
    // Entre les deux : seulement « Qui peut me mentionner » (migration 0046) et
    // « Proposer mon compte aux autres membres » (migration 0050), du même bloc.
    const between = settings.slice(account + "<PrivateAccountSetting />".length, pieces).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(between.replace(/\s+/g, " ").trim()).toBe("<MentionsFromSetting /> <DiscoverableSetting />");
    expect(setting).toContain("<Text style={styles.label}>{t.privateAccount.sectionTitle}</Text>");
  });

  it("caché tant que le serveur n'a pas le compte privé ; un vrai interrupteur, avec son libellé", () => {
    expect(setting).toContain("const stored = profile?.isPrivate;");
    expect(setting).toContain("if (stored === undefined) return null;");
    expect(setting).toContain("<Switch");
    expect(setting).toContain("accessibilityLabel={t.privateAccount.settingTitle}");
    expect(setting).toContain("<Text style={styles.hint}>{t.privateAccount.settingHelp}</Text>");
  });

  it("repasser en public demande une confirmation ; l'interrupteur revient et un message le dit si l'enregistrement échoue", () => {
    // Couper ne fait qu'ouvrir la confirmation : rien n'est envoyé avant « Repasser en public ».
    expect(setting).toContain("if (!next) setConfirming(true);\n    else void apply(true);");
    expect(setting.match(/apply\(false\)/g)).toHaveLength(1);
    expect(setting).toContain("<Text style={styles.confirmText}>{t.privateAccount.goPublicConfirm}</Text>");
    expect(setting).toContain("setValue(previous);\n      showToast(t.privateAccount.settingError);");
  });

  it("la note sous les choix de visibilité n'apparaît que pour un compte privé, sur les trois écrans où l'on publie", () => {
    const note = read("components/private-account-note.tsx");
    expect(note).toContain("if (profile?.isPrivate !== true) return null;");
    for (const screen of ["app/(app)/post-item/new.tsx", "app/(app)/envie.tsx", "app/(app)/vault-item/[id].tsx"]) expect(read(screen), screen).toContain("<PrivateAccountNote");
  });
});

describe("textes", () => {
  it("les phrases validées, en français et en anglais", () => {
    expect(fr.privateAccount).toMatchObject({
      settingTitle: "Compte privé",
      settingHelp: "Seuls les abonnés que vous acceptez voient vos publications, vos listes et vos j'aime. Vos abonnés actuels restent abonnés.",
      shellNotice: "Ce compte est privé. Abonnez-vous pour voir ses publications.",
      requested: "Demandé",
      cancelRequest: "Annuler la demande",
      accept: "Accepter",
      decline: "Refuser",
      requestsEmpty: "Aucune demande en attente.",
      postNote: "Compte privé : seuls vos abonnés voient vos publications.",
      goPublicConfirm: "Repasser en compte public ? Tout le monde pourra vous suivre et voir vos publications publiques. Les demandes en attente seront effacées.",
    });
    expect(en.privateAccount).toMatchObject({
      settingTitle: "Private account",
      settingHelp: "Only followers you approve see your posts, your lists and your likes. Your current followers stay.",
      shellNotice: "This account is private. Follow to see their posts.",
      requested: "Requested",
      cancelRequest: "Cancel request",
      accept: "Accept",
      decline: "Decline",
      requestsEmpty: "No pending requests.",
      postNote: "Private account: only your followers see your posts.",
      goPublicConfirm: "Switch back to a public account? Anyone will be able to follow you and see your public posts. Pending requests will be erased.",
    });
  });

  it("politique de confidentialité : le compte privé est décrit dans « Qui peut voir quoi », dans les deux langues", () => {
    const section = (doc: typeof privacyPolicy, title: string) => doc.sections.find((s) => s.title.startsWith(title))!.blocks.flat().join("\n");
    const french = section(privacyPolicy, "Qui peut voir quoi");
    expect(french).toContain("Vous pouvez rendre votre compte privé.");
    expect(french).toContain("ne sont alors visibles que par les abonnés que vous avez acceptés");
    expect(french).toContain("vous n'apparaissez plus dans les listes des autres comptes pour eux");
    expect(french).toContain("la personne dont vous refusez la demande n'est pas prévenue");
    expect(french).toContain("Si vous repassez en compte public, les demandes en attente sont effacées.");
    // Ce qu'un compte privé écrit chez un autre membre suit la visibilité de cette publication ; ses « j'aime » : voir aime-par.test.ts.
    expect(french).toContain("Ce que vous écrivez sous la publication d'un autre membre reste visible selon la visibilité de cette publication ; son auteur est informé de vos commentaires et de vos j'aime.");
    // La limite connue reste dite : une image dont on a gardé l'adresse reste lisible.
    expect(french).toContain("peut continuer à l'ouvrir");
    const english = section(privacyPolicyEn, "Who can see what");
    expect(english).toContain("You can make your account private.");
    expect(english).toContain("visible only to followers you have approved");
    expect(english).toContain("What you write under another member's post remains visible according to that post's visibility; its author is told of your comments and of your likes.");
    expect(english).toContain("a person whose request you decline is not notified");
    expect(english).toContain("If you switch back to a public account, pending requests are erased.");
  });
});
