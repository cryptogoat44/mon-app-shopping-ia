import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { FollowState, MemberPage, MemberRow } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ApiError, acceptFollowRequest, declineFollowRequest, fetchFollowRequests, fetchFollowers, fetchFollowing, followUser, unfollowUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { followActionFor, followButton, followStateOf } from "@/lib/follow-state";
import { loadErrorMessage } from "@/lib/load-error";
import {
  isOwnMemberList,
  loadsWithoutTap,
  memberListEmptyText,
  memberListTitle,
  nextEmptyStreak,
  parseMemberListParams,
  showsFindPeople,
  showsRemoveFollower,
  withFollowState,
  type FollowListKind,
} from "@/lib/member-lists";
import { useToast } from "@/lib/toast-context";
import { MemberList } from "@/components/member-list";
import { RemoveFollowerSheet } from "@/components/remove-follower-sheet";
import { themedStyles } from "@/theme/themed-styles";

// Écran « membres » (lot « vie sociale ») : une liste de membres, choisie par
// le paramètre `kind`.
//   - `kind=requests` : les demandes d'abonnement reçues, avec « Accepter »
//     et « Refuser » sur chaque ligne.
//   - `kind=followers` / `kind=following` (+ `id`, absent : soi-même) : les
//     abonnés et les abonnements d'un membre, avec le bouton d'abonnement sur
//     chaque ligne et, sur SES abonnés, « Retirer ».
// Les autres listes (« Aimé par »…) s'y ajouteront ; d'ici là, toute autre
// valeur ramène à l'onglet Activité.

/** Les pages d'une liste : première page, suite, erreurs. Le serveur filtre
 * après avoir lu une page : elle peut arriver vide alors qu'il en reste.
 * La suite se charge alors d'elle-même, trois pages vides de rang au plus
 * (lib/member-lists.ts) ; au-delà, il faut toucher « Voir la suite ». */
function useMemberPages(fetchPage: (cursor?: string) => Promise<MemberPage>, loadError: string) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [emptyStreak, setEmptyStreak] = useState(0);
  // Une réponse arrivée après un rechargement est ignorée.
  const generation = useRef(0);
  const shown = useRef(false);
  // Deux demandes de suite au même instant (défilement et page vide) n'en font qu'une.
  const fetchingMore = useRef(false);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    setMoreError(null);
    try {
      const page = await fetchPage();
      if (current !== generation.current) return;
      shown.current = true;
      setMembers(page.members);
      setCursor(page.nextCursor);
      setEmptyStreak(nextEmptyStreak(0, page.members.length, page.nextCursor !== null, false));
    } catch (e) {
      if (current !== generation.current) return;
      // Un rafraîchissement raté garde la liste déjà affichée.
      if (shown.current) setMoreError(loadErrorMessage(e, loadError));
      else setError(loadErrorMessage(e, loadError));
    }
  }, [fetchPage, loadError]);

  const loadMore = useCallback(
    async (byTap: boolean) => {
      if (!cursor || fetchingMore.current) return;
      const current = generation.current;
      fetchingMore.current = true;
      setLoadingMore(true);
      setMoreError(null);
      try {
        const page = await fetchPage(cursor);
        if (current !== generation.current) return;
        setMembers((previous) => {
          const known = new Set((previous ?? []).map((member) => member.id));
          return [...(previous ?? []), ...page.members.filter((member) => !known.has(member.id))];
        });
        setCursor(page.nextCursor);
        setEmptyStreak((previous) => nextEmptyStreak(previous, page.members.length, page.nextCursor !== null, byTap));
      } catch (e) {
        if (current === generation.current) setMoreError(loadErrorMessage(e, loadError));
      } finally {
        fetchingMore.current = false;
        setLoadingMore(false);
      }
    },
    [cursor, fetchPage, loadError]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const remove = useCallback((id: string) => setMembers((previous) => (previous ? previous.filter((member) => member.id !== id) : previous)), []);

  const setFollowState = useCallback((id: string, followState: FollowState) => setMembers((previous) => (previous ? withFollowState(previous, id, followState) : previous)), []);

  // La suite peut-elle partir sans qu'on la demande ? Jamais après une erreur.
  const autoLoad = cursor !== null && moreError === null && loadsWithoutTap(emptyStreak);
  // Une page vide alors qu'il en reste : la suivante part d'elle-même.
  useEffect(() => {
    if (emptyStreak > 0 && autoLoad && !loadingMore) void loadMore(false);
  }, [autoLoad, emptyStreak, loadMore, loadingMore]);

  return { members, error, moreError, loadingMore, refreshing, hasMore: cursor !== null, autoLoad, load, loadMore, refresh, remove, setFollowState };
}

function RequestActions({ member, onDone }: { member: MemberRow; onDone: (id: string) => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (accept) await acceptFollowRequest(member.id);
      else await declineFollowRequest(member.id);
      onDone(member.id);
    } catch (e) {
      // Demande annulée entre-temps : elle n'existe plus, la ligne part.
      if (e instanceof ApiError && e.status === 404 && e.body.error === "request_not_found") onDone(member.id);
      else showToast(e instanceof ApiError ? e.message : t.privateAccount.requestActionError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable
        style={[styles.action, styles.accept, busy ? styles.busy : null]}
        onPress={() => void answer(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t.privateAccount.acceptLabel(member.displayName)}
        accessibilityState={{ disabled: busy }}
      >
        <Text style={[styles.actionLabel, styles.acceptLabel]}>{t.privateAccount.accept}</Text>
      </Pressable>
      <Pressable
        style={[styles.action, busy ? styles.busy : null]}
        onPress={() => void answer(false)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t.privateAccount.declineLabel(member.displayName)}
        accessibilityState={{ disabled: busy }}
      >
        <Text style={styles.actionLabel}>{t.privateAccount.decline}</Text>
      </Pressable>
    </>
  );
}

function RequestsList() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const pages = useMemberPages(fetchFollowRequests, t.privateAccount.requestsLoadError);
  const { load, remove } = pages;

  useEffect(() => {
    void load();
  }, [load]);

  const handled = useCallback(
    (id: string) => {
      remove(id);
      // Le nombre de demandes de l'onglet Activité suit.
      void refreshProfile().catch(() => {});
    },
    [remove, refreshProfile]
  );

  return (
    <MemberList
      members={pages.members}
      error={pages.error}
      onRetry={() => void load()}
      emptyText={t.privateAccount.requestsEmpty}
      hasMore={pages.hasMore}
      loadingMore={pages.loadingMore}
      moreError={pages.moreError}
      onLoadMore={() => void pages.loadMore(true)}
      loadMoreLabel={t.privateAccount.requestsMore}
      onOpenProfile={(member) => router.push({ pathname: "/profil", params: { id: member.id } })}
      renderActions={(member) => <RequestActions member={member} onDone={handled} />}
      refreshing={pages.refreshing}
      onRefresh={() => void pages.refresh()}
    />
  );
}

/** Le bouton d'abonnement d'une ligne : Suivre, Demandé (compte privé) ou Suivi(e).
 * Il n'a pas d'état à lui : il se dessine d'après la ligne de la liste, et y
 * écrit le nouvel état (`onState`). Sinon, après un rafraîchissement ou un
 * long défilement, il montrerait un état périmé — et « annuler la demande »
 * supprimerait un abonnement accepté entre-temps. */
function RowFollowButton({ member, onState, onChanged }: { member: MemberRow; onState: (id: string, followState: FollowState) => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const state = followStateOf(member);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (followActionFor(state) === "follow") {
        // Compte privé : le serveur répond « demandé ».
        onState(member.id, await followUser(member.id, "list"));
      } else {
        // Ne plus suivre, ou annuler la demande.
        await unfollowUser(member.id);
        onState(member.id, "none");
      }
      onChanged();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.userProfile.followError);
    } finally {
      setBusy(false);
    }
  }

  const button = followButton(state, t.peopleSearch.following);
  return (
    <Pressable
      style={[styles.action, button.primary ? styles.accept : null, busy ? styles.busy : null]}
      onPress={() => void toggle()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      accessibilityHint={button.hint}
      accessibilityState={{ disabled: busy }}
    >
      <Text style={[styles.actionLabel, button.primary ? styles.acceptLabel : null]}>{button.label}</Text>
    </Pressable>
  );
}

/** Les abonnés ou les abonnements de `ownerId`. `own` : la liste du membre connecté. */
function FollowList({ kind, ownerId, own }: { kind: FollowListKind; ownerId: string; own: boolean }) {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const fetchPage = useCallback((cursor?: string) => (kind === "followers" ? fetchFollowers(ownerId, cursor) : fetchFollowing(ownerId, cursor)), [kind, ownerId]);
  const pages = useMemberPages(fetchPage, t.memberLists.loadError);
  const { load, remove } = pages;
  const [removing, setRemoving] = useState<MemberRow | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Les compteurs de son propre profil suivent (abonné retiré, abonnement ajouté ou retiré).
  const countsChanged = useCallback(() => void refreshProfile().catch(() => {}), [refreshProfile]);

  const gone = useCallback(
    (id: string) => {
      remove(id);
      countsChanged();
    },
    [countsChanged, remove]
  );

  return (
    <>
      <MemberList
        members={pages.members}
        error={pages.error}
        onRetry={() => void load()}
        emptyText={memberListEmptyText(kind, own)}
        emptyAction={
          showsFindPeople(kind, own) ? (
            <Pressable style={styles.findPeople} onPress={() => router.push("/people-search")} accessibilityRole="link">
              <Text style={styles.findPeopleLabel}>{t.memberLists.findPeople}</Text>
            </Pressable>
          ) : null
        }
        hasMore={pages.hasMore}
        loadingMore={pages.loadingMore}
        moreError={pages.moreError}
        onLoadMore={() => void pages.loadMore(true)}
        loadMoreLabel={t.memberLists.loadMore}
        onEndReached={() => {
          if (pages.autoLoad) void pages.loadMore(false);
        }}
        refreshing={pages.refreshing}
        onRefresh={() => void pages.refresh()}
        onOpenProfile={(member) => router.push({ pathname: "/profil", params: { id: member.id } })}
        renderActions={(member) =>
          member.isMe ? null : (
            <>
              <RowFollowButton member={member} onState={pages.setFollowState} onChanged={countsChanged} />
              {showsRemoveFollower(kind, own, member) ? (
                <Pressable style={styles.action} onPress={() => setRemoving(member)} accessibilityRole="button" accessibilityLabel={t.memberLists.removeLabel(member.displayName)}>
                  <Text style={styles.actionLabel}>{t.memberLists.remove}</Text>
                </Pressable>
              ) : null}
            </>
          )
        }
      />
      {/* Compte public (ou serveur d'avant le compte privé) : la personne pourra se réabonner. */}
      <RemoveFollowerSheet member={removing} publicAccount={profile?.isPrivate !== true} onClose={() => setRemoving(null)} onGone={gone} />
    </>
  );
}

export default function MembersScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const target = parseMemberListParams(params);
  if (!target) return <Redirect href="/activite" />;
  const own = isOwnMemberList(target, profile?.id);
  const ownerId = target.kind === "requests" ? null : (target.userId ?? profile?.id ?? null);

  function goBack() {
    if (router.canGoBack()) router.back();
    else if (target?.kind === "requests") router.replace("/activite");
    else if (own || !ownerId) router.replace("/profile");
    else router.replace({ pathname: "/profil", params: { id: ownerId } });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {memberListTitle(target.kind)}
        </Text>
        <View style={styles.navSpacer} />
      </View>
      <View style={styles.body}>
        {target.kind === "requests" ? <RequestsList /> : ownerId ? <FollowList key={`${target.kind}-${ownerId}`} kind={target.kind} ownerId={ownerId} own={own} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  back: { fontSize: 26, color: color.encre },
  navSpacer: { width: 26 },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  body: { flex: 1 },
  action: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  accept: { backgroundColor: color.vert, borderColor: color.vert },
  actionLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  acceptLabel: { color: color.blanc },
  busy: { opacity: 0.6 },
  findPeople: { alignSelf: "center", minHeight: 44, marginTop: space.sm, paddingHorizontal: space.lg, justifyContent: "center" },
  findPeopleLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
