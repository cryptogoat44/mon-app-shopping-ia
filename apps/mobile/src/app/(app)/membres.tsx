import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import type { MemberPage, MemberRow } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ApiError, acceptFollowRequest, declineFollowRequest, fetchFollowRequests } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { parseMemberListKind } from "@/lib/follow-state";
import { loadErrorMessage } from "@/lib/load-error";
import { useToast } from "@/lib/toast-context";
import { MemberList } from "@/components/member-list";
import { themedStyles } from "@/theme/themed-styles";

// Écran « membres » (lot « vie sociale ») : une liste de membres, choisie par
// le paramètre `kind`. Dans ce lot : `kind=requests`, les demandes
// d'abonnement reçues, avec « Accepter » et « Refuser » sur chaque ligne. Les
// autres listes (abonnés, abonnements, « Aimé par »…) s'y ajouteront ; d'ici
// là, toute autre valeur ramène à l'onglet Activité.

/** Les pages d'une liste : première page, suite, erreurs. */
function useMemberPages(fetchPage: (cursor?: string) => Promise<MemberPage>, loadError: string) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Une réponse arrivée après un rechargement est ignorée.
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    setMoreError(null);
    try {
      const page = await fetchPage();
      if (current !== generation.current) return;
      setMembers(page.members);
      setCursor(page.nextCursor);
    } catch (e) {
      if (current === generation.current) setError(loadErrorMessage(e, loadError));
    }
  }, [fetchPage, loadError]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const current = generation.current;
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
    } catch (e) {
      if (current === generation.current) setMoreError(loadErrorMessage(e, loadError));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, fetchPage, loadError, loadingMore]);

  const remove = useCallback((id: string) => setMembers((previous) => (previous ? previous.filter((member) => member.id !== id) : previous)), []);

  return { members, error, moreError, loadingMore, hasMore: cursor !== null, load, loadMore, remove };
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
      onLoadMore={() => void pages.loadMore()}
      loadMoreLabel={t.privateAccount.requestsMore}
      onOpenProfile={(member) => router.push({ pathname: "/profil", params: { id: member.id } })}
      renderActions={(member) => <RequestActions member={member} onDone={handled} />}
    />
  );
}

export default function MembersScreen() {
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  if (parseMemberListKind(kind) !== "requests") return <Redirect href="/activite" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/activite"))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {t.privateAccount.requestsTitle}
        </Text>
        <View style={styles.navSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <RequestsList />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  back: { fontSize: 26, color: color.encre },
  navSpacer: { width: 26 },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  action: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  accept: { backgroundColor: color.vert, borderColor: color.vert },
  actionLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  acceptLabel: { color: color.blanc },
  busy: { opacity: 0.6 },
}));
