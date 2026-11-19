import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { showsPrivateShell } from "../src/lib/follow-state";
import {
  MAX_EMPTY_PAGES_IN_A_ROW,
  MEMBER_NAME_MIN_WIDTH,
  actionsWrapUnderName,
  isOwnMemberList,
  loadsWithoutTap,
  memberListEmptyText,
  memberListRoute,
  memberListTitle,
  nextEmptyStreak,
  parseMemberListParams,
  showsFindPeople,
  showsRemoveFollower,
  withFollowState,
} from "../src/lib/member-lists";

// Listes des abonnés et des abonnements (lot « vie sociale », sans
// migration), côté app : ce que l'écran « membres » lit dans son adresse, les
// libellés des compteurs, le chargement de la suite et les textes.

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const ME = "a0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";

afterEach(() => setActiveLocale("fr"));

describe("adresse de l'écran « membres »", () => {
  it("abonnés et abonnements d'un membre ; sans identifiant, les siens", () => {
    expect(parseMemberListParams({ kind: "followers", id: OTHER })).toEqual({ kind: "followers", userId: OTHER });
    expect(parseMemberListParams({ kind: "following", id: OTHER.toUpperCase() })).toEqual({ kind: "following", userId: OTHER });
    expect(parseMemberListParams({ kind: "followers" })).toEqual({ kind: "followers", userId: null });
    expect(parseMemberListParams({ kind: "following", id: "" })).toEqual({ kind: "following", userId: null });
    // Les demandes reçues n'ont pas d'identifiant : toujours les siennes.
    expect(parseMemberListParams({ kind: "requests", id: OTHER })).toEqual({ kind: "requests" });
  });

  it("refusé : un identifiant qui n'en est pas un, une liste inconnue ou pas encore construite — rien n'est demandé au serveur", () => {
    for (const id of ["moi", "../me", `${OTHER}/posts`, `${OTHER}?x=1`, ["a"], 3, {}]) expect(parseMemberListParams({ kind: "followers", id }), String(id)).toBeNull();
    for (const kind of ["viewers", "autre", "", undefined, null, ["followers"]]) expect(parseMemberListParams({ kind, id: OTHER }), String(kind)).toBeNull();
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("const target = parseMemberListParams(params);");
    expect(screen).toContain('if (!target) return <Redirect href="/activite" />;');
  });

  it("« ma » liste : sans identifiant, ou avec le mien ; jamais celle d'un autre, même si mon profil n'est pas encore chargé", () => {
    expect(isOwnMemberList({ kind: "followers", userId: null }, ME)).toBe(true);
    expect(isOwnMemberList({ kind: "followers", userId: ME }, ME.toUpperCase())).toBe(true);
    expect(isOwnMemberList({ kind: "requests" }, undefined)).toBe(true);
    expect(isOwnMemberList({ kind: "followers", userId: OTHER }, ME)).toBe(false);
    expect(isOwnMemberList({ kind: "following", userId: OTHER }, undefined)).toBe(false);
    expect(isOwnMemberList({ kind: "following", userId: OTHER }, null)).toBe(false);
  });

  it("les compteurs mènent à « /membres » avec la liste et le membre", () => {
    expect(memberListRoute("followers", OTHER)).toEqual({ pathname: "/membres", params: { kind: "followers", id: OTHER } });
    expect(memberListRoute("following", ME)).toEqual({ pathname: "/membres", params: { kind: "following", id: ME } });
  });
});

describe("titres, listes vides et actions", () => {
  it("titre de l'écran, dans les deux langues", () => {
    expect(memberListTitle("followers")).toBe("Abonnés");
    expect(memberListTitle("following")).toBe("Abonnements");
    expect(memberListTitle("requests")).toBe(fr.privateAccount.requestsTitle);
    setActiveLocale("en");
    expect(memberListTitle("followers")).toBe("Followers");
    expect(memberListTitle("following")).toBe("Following");
  });

  it("liste vide : « vous » pour la sienne, « ce compte » pour celle d'un autre", () => {
    expect(memberListEmptyText("followers", true)).toBe("Personne ne vous suit pour l'instant.");
    expect(memberListEmptyText("followers", false)).toBe("Ce compte n'a pas encore d'abonnés.");
    expect(memberListEmptyText("following", true)).toBe("Vous ne suivez encore personne.");
    expect(memberListEmptyText("following", false)).toBe("Ce compte ne suit encore personne.");
  });

  it("« Trouver des profils » : seulement sous ses propres abonnements", () => {
    expect(showsFindPeople("following", true)).toBe(true);
    expect(showsFindPeople("following", false)).toBe(false);
    expect(showsFindPeople("followers", true)).toBe(false);
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("showsFindPeople(kind, own) ? (");
    expect(screen).toContain('onPress={() => router.push("/people-search")}');
  });

  it("« Retirer » : seulement sur SES abonnés — jamais sur les abonnés d'un autre, ses abonnements, ni sa propre ligne", () => {
    const row = { isMe: false };
    expect(showsRemoveFollower("followers", true, row)).toBe(true);
    expect(showsRemoveFollower("followers", false, row)).toBe(false);
    expect(showsRemoveFollower("following", true, row)).toBe(false);
    expect(showsRemoveFollower("followers", true, { isMe: true })).toBe(false);
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("{showsRemoveFollower(kind, own, member) ? (");
    // Toucher « Retirer » ne retire rien : cela ouvre la confirmation.
    expect(screen).toContain("onPress={() => setRemoving(member)}");
    expect(screen).not.toContain("removeFollower(");
  });
});

describe("retirer un abonné : la confirmation", () => {
  const sheet = read("components/remove-follower-sheet.tsx");

  it("la phrase nomme la personne et dit qu'elle ne sera pas prévenue ; un seul appel, après « Retirer »", () => {
    expect(fr.memberLists.removeConfirm("Alice")).toBe("Retirer Alice de vos abonnés ? Cette personne ne sera pas prévenue.");
    expect(en.memberLists.removeConfirm("Alice")).toBe("Remove Alice from your followers? They will not be notified.");
    expect(sheet).toContain("t.memberLists.removeConfirm(member.displayName)");
    expect(sheet.match(/removeFollower\(member\.id\)/g)).toHaveLength(1);
    expect(sheet).toContain('onPress={() => void run("remove")}');
    expect(sheet).toContain("showToast(action === \"remove\" ? t.memberLists.removed : t.moderation.blockSuccess);");
  });

  it("compte public : la feuille dit que la personne pourra se réabonner et propose de la bloquer, avec une seconde confirmation", () => {
    expect(sheet).toContain("{publicAccount ? <Text style={styles.note}>{t.memberLists.removeNotePublic}</Text> : null}");
    expect(sheet).toContain('onPress={() => setStep("confirmBlock")}');
    expect(sheet).toContain("<Text style={styles.confirmText}>{t.moderation.blockConfirm}</Text>");
    expect(sheet.match(/blockUser\(member\.id\)/g)).toHaveLength(1);
    // Compte privé : ni la note, ni le blocage proposé ici.
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("publicAccount={profile?.isPrivate !== true}");
  });

  it("un échec le dit et laisse la ligne en place", () => {
    expect(sheet).toContain("t.memberLists.removeError");
    const run = sheet.slice(sheet.indexOf("async function run"), sheet.indexOf("return ("));
    expect(run.indexOf("onGone(member.id)")).toBeLessThan(run.indexOf("} catch"));
    expect(run.slice(run.indexOf("} catch"))).not.toContain("onGone");
  });
});

describe("compteurs des profils", () => {
  it("libellés lus par les lecteurs d'écran, au singulier et au pluriel, dans les deux langues", () => {
    expect(fr.memberLists.openFollowers(0)).toBe("0 abonné, ouvrir la liste");
    expect(fr.memberLists.openFollowers(1)).toBe("1 abonné, ouvrir la liste");
    expect(fr.memberLists.openFollowers(12)).toBe("12 abonnés, ouvrir la liste");
    expect(fr.memberLists.openFollowing(1)).toBe("1 abonnement, ouvrir la liste");
    expect(fr.memberLists.openFollowing(12)).toBe("12 abonnements, ouvrir la liste");
    expect(en.memberLists.openFollowers(1)).toBe("1 follower, open the list");
    expect(en.memberLists.openFollowers(12)).toBe("12 followers, open the list");
    expect(en.memberLists.openFollowing(12)).toBe("12 following, open the list");
    // Le même accord que le compteur affiché.
    for (const n of [0, 1, 2, 12]) {
      expect(fr.memberLists.openFollowers(n).startsWith(fr.userProfile.followers(n))).toBe(true);
      expect(fr.memberLists.openFollowing(n).startsWith(fr.userProfile.following(n))).toBe(true);
      expect(en.memberLists.openFollowers(n).startsWith(en.userProfile.followers(n))).toBe(true);
    }
  });

  it("son propre profil : les deux compteurs sont des liens vers ses listes", () => {
    const screen = read("app/(app)/(tabs)/profile/index.tsx");
    expect(screen).toContain('router.push(memberListRoute("followers", profile.id))');
    expect(screen).toContain('router.push(memberListRoute("following", profile.id))');
    expect(screen).toContain("accessibilityLabel={t.memberLists.openFollowers(profile?.followersCount ?? 0)}");
    expect(screen).toContain("accessibilityLabel={t.memberLists.openFollowing(profile?.followingCount ?? 0)}");
    expect(screen.match(/accessibilityRole="link"/g)!.length).toBeGreaterThanOrEqual(2);
    // Le nombre de pièces du Vault et de publications restent du texte.
    expect(screen).toContain('<View style={styles.statItem}>\n          <Text style={styles.statNumber}>{vaultTotal}</Text>');
  });

  it("profil d'un autre : abonnés et abonnements ouvrent sa liste — sauf pour un compte privé dont on n'est pas un abonné accepté", () => {
    const screen = read("app/(app)/profil.tsx");
    expect(screen).toContain('router.push(memberListRoute("followers", profile.id))');
    expect(screen).toContain('router.push(memberListRoute("following", profile.id))');
    // Profil réduit : chaque compteur est un simple texte, sans lien.
    const counts = screen.slice(screen.indexOf("<View style={styles.counts}>"), screen.indexOf("<View style={styles.actions}>"));
    expect(counts.match(/\{isShell \? \(\s*<Text style=\{styles\.count\}>/g)).toHaveLength(2);
    expect(counts.match(/<Pressable/g)).toHaveLength(2);
    expect(counts.indexOf("isShell ? (")).toBeLessThan(counts.indexOf("<Pressable"));
    // Le profil réduit se décide comme avant : une demande en attente n'ouvre rien.
    expect(showsPrivateShell({ isMe: false, isFollowing: false, followState: "requested", isPrivate: true })).toBe(true);
  });
});

describe("chargement de la suite", () => {
  it("une page vide alors qu'il en reste : la suite part d'elle-même, trois pages vides de rang au plus", () => {
    expect(MAX_EMPTY_PAGES_IN_A_ROW).toBe(3);
    let streak = nextEmptyStreak(0, 0, true, false);
    expect([streak, loadsWithoutTap(streak)]).toEqual([1, true]);
    streak = nextEmptyStreak(streak, 0, true, false);
    expect([streak, loadsWithoutTap(streak)]).toEqual([2, true]);
    streak = nextEmptyStreak(streak, 0, true, false);
    // Trois pages vides : il faut toucher « Voir la suite ».
    expect([streak, loadsWithoutTap(streak)]).toEqual([3, false]);
    // Le toucher repart pour trois pages.
    streak = nextEmptyStreak(streak, 0, true, true);
    expect([streak, loadsWithoutTap(streak)]).toEqual([1, true]);
  });

  it("une page qui apporte quelqu'un, ou la dernière page, remet le compte à zéro", () => {
    expect(nextEmptyStreak(2, 4, true, false)).toBe(0);
    expect(nextEmptyStreak(2, 0, false, false)).toBe(0);
    expect(nextEmptyStreak(0, 30, true, false)).toBe(0);
    expect(loadsWithoutTap(0)).toBe(true);
  });

  it("l'écran : défilement, tirer pour rafraîchir, « Voir la suite », et jamais de nouvel essai automatique après une erreur", () => {
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("const autoLoad = cursor !== null && moreError === null && loadsWithoutTap(emptyStreak);");
    expect(screen).toContain("if (emptyStreak > 0 && autoLoad && !loadingMore) void loadMore(false);");
    expect(screen).toContain("if (pages.autoLoad) void pages.loadMore(false);");
    expect(screen).toContain("onLoadMore={() => void pages.loadMore(true)}");
    expect(screen).toContain("loadMoreLabel={t.memberLists.loadMore}");
    expect(screen).toContain("onRefresh={() => void pages.refresh()}");
    // La suite se décide sur le curseur seul, jamais sur le nombre de lignes reçues.
    expect(screen).toContain("hasMore: cursor !== null");
    const list = read("components/member-list.tsx");
    expect(list).toContain("<FlatList");
    expect(list).toContain("onEndReached={onEndReached}");
    expect(list).toContain("<RefreshControl");
    // Jamais de date dans une ligne.
    expect(list).not.toMatch(/createdAt|timeAgo|formatLongDate/);
  });

  it("chaque ligne : le bouton d'abonnement à trois états, sauf sur sa propre ligne ; les boutons font 44 points de haut", () => {
    const screen = read("app/(app)/membres.tsx");
    expect(screen).toContain("member.isMe ? null : (");
    expect(screen).toContain('onState(member.id, await followUser(member.id, "list"));');
    expect(screen).toContain("const button = followButton(state, t.peopleSearch.following);");
    expect(screen).toContain("accessibilityHint={button.hint}");
    expect(screen).toMatch(/action: \{ minHeight: 44,/);
    expect(read("lib/analytics-events.ts")).toContain('follow_added: { context: oneOf(["search", "profile", "list"]) }');
  });

  it("appels au serveur : les deux listes avec leur curseur, et le retrait", () => {
    const api = read("lib/api.ts");
    expect(api).toContain("authorizedFetch(`/api/users/${userId}/followers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : \"\"}`)");
    expect(api).toContain("authorizedFetch(`/api/users/${userId}/following${cursor ? `?cursor=${encodeURIComponent(cursor)}` : \"\"}`)");
    expect(api).toContain("authorizedFetch(`/api/followers/${userId}`, { method: \"DELETE\" })");
  });
});

describe("textes", () => {
  it("les phrases validées, en français et en anglais", () => {
    expect(fr.memberLists).toMatchObject({
      followersTitle: "Abonnés",
      followingTitle: "Abonnements",
      followersEmpty: "Personne ne vous suit pour l'instant.",
      followersEmptyOther: "Ce compte n'a pas encore d'abonnés.",
      followingEmpty: "Vous ne suivez encore personne.",
      followingEmptyOther: "Ce compte ne suit encore personne.",
      remove: "Retirer",
      removeNotePublic: "Votre compte est public : cette personne pourra se réabonner. Pour l'en empêcher, bloquez-la.",
      removed: "Abonné retiré.",
      loadMore: "Voir la suite",
      findPeople: "Trouver des profils",
    });
    expect(en.memberLists).toMatchObject({
      followersTitle: "Followers",
      followingTitle: "Following",
      followersEmpty: "No one follows you yet.",
      followersEmptyOther: "This account has no followers yet.",
      followingEmpty: "You are not following anyone yet.",
      followingEmptyOther: "This account is not following anyone yet.",
      remove: "Remove",
      removeNotePublic: "Your account is public: this person can follow you again. To prevent it, block them.",
      removed: "Follower removed.",
      loadMore: "Show more",
      findPeople: "Find people",
    });
    expect(Object.keys(en.memberLists).sort()).toEqual(Object.keys(fr.memberLists).sort());
  });

  it("politique de confidentialité : les listes et le retrait d'un abonné, dans « Qui peut voir quoi », dans les deux langues", () => {
    const section = (doc: typeof privacyPolicy, title: string) => doc.sections.find((s) => s.title.startsWith(title))!.blocks.flat().join("\n");
    expect(section(privacyPolicy, "Qui peut voir quoi")).toContain(
      "La liste de vos abonnés et celle de vos abonnements sont visibles par les membres qui peuvent voir votre profil (vos abonnés acceptés seulement, si votre compte est privé). Vous pouvez retirer un abonné ; il n'en est pas informé."
    );
    expect(section(privacyPolicyEn, "Who can see what")).toContain(
      "Your follower list and your following list are visible to members who can see your profile (only your approved followers if your account is private). You can remove a follower; they are not notified."
    );
  });
});

describe("bouton d'abonnement d'une ligne : l'état vit dans la liste", () => {
  const row = (id: string, followState: "none" | "requested" | "following") => ({ id, displayName: id, isFollowing: followState === "following", followState });

  it("la ligne touchée porte le nouvel état, les autres ne bougent pas", () => {
    const members = [row(ME, "none"), row(OTHER, "none")];
    const requested = withFollowState(members, OTHER, "requested");
    expect(requested[1]).toEqual({ id: OTHER, displayName: OTHER, isFollowing: false, followState: "requested" });
    expect(requested[0]).toBe(members[0]);
    // La liste d'origine n'est pas modifiée.
    expect(members[1].followState).toBe("none");

    const following = withFollowState(requested, OTHER, "following");
    expect(following[1]).toMatchObject({ isFollowing: true, followState: "following" });
    expect(withFollowState(following, OTHER, "none")[1]).toMatchObject({ isFollowing: false, followState: "none" });
  });

  it("un identifiant absent de la liste ne change rien", () => {
    const members = [row(ME, "following")];
    expect(withFollowState(members, OTHER, "none")).toEqual(members);
  });

  it("l'écran : le bouton lit la ligne (aucun état à lui) et y écrit le résultat", () => {
    const screen = read("app/(app)/membres.tsx");
    const button = screen.slice(screen.indexOf("function RowFollowButton"), screen.indexOf("function FollowList"));
    expect(button).toContain("const state = followStateOf(member);");
    expect(button).not.toMatch(/useState<FollowState>|setState\(/);
    expect(button).toContain('onState(member.id, await followUser(member.id, "list"));');
    expect(button).toContain('onState(member.id, "none");');
    expect(screen).toContain("<RowFollowButton member={member} onState={pages.setFollowState} onChanged={countsChanged} />");
    expect(screen).toContain("withFollowState(previous, id, followState)");
  });
});

describe("ligne de membre étroite : les boutons passent sous le nom", () => {
  it("375 pt et plus, texte normal : tout tient sur une ligne ; 320 pt ou texte agrandi : dessous", () => {
    // Largeur de la ligne : l'écran moins deux marges de 24. « Suivi(e) » + « Retirer » : environ 170.
    expect(actionsWrapUnderName(375 - 48, 170)).toBe(false);
    expect(actionsWrapUnderName(320 - 48, 170)).toBe(true);
    // Texte agrandi (x1,3) sur 375 pt.
    expect(actionsWrapUnderName(375 - 48, 215)).toBe(true);
    expect(MEMBER_NAME_MIN_WIDTH).toBeGreaterThanOrEqual(120);
  });

  it("la ligne : retour à la ligne permis, largeur gardée au nom, boutons à droite", () => {
    const list = read("components/member-list.tsx");
    const style = (name: string) => list.split("\n").find((line) => line.trimStart().startsWith(`${name}: {`)) ?? "";
    expect(style("row")).toContain('flexWrap: "wrap"');
    expect(style("person")).toContain("flex: 1, minWidth: MEMBER_NAME_MIN_WIDTH");
    expect(style("actions")).toContain('marginLeft: "auto"');
  });
});
