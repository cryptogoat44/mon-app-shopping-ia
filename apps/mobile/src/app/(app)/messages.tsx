import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { ConversationSummary, ConversationsPage } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchConversations, fetchMessagesStatus } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { usePolling } from "@/lib/use-polling";
import { ConversationRow } from "@/components/conversation-row";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { Skeleton } from "@/components/skeleton";
import { themedStyles } from "@/theme/themed-styles";

// Messages (lot messages), ouvert depuis l'Activité : les invitations reçues
// (des membres qui ne sont pas vos amis), puis les conversations, des plus
// récentes aux plus anciennes. Relu toutes les 5 s environ tant que l'écran
// est ouvert (pas de temps réel).
export default function MessagesScreen() {
  const router = useRouter();
  const [page, setPage] = useState<ConversationsPage | null>(null);
  const [older, setOlder] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastSeen = useRef("");
  const loadedOlder = useRef(false);

  const load = useCallback(async (): Promise<"new" | "same"> => {
    try {
      const data = await fetchConversations();
      const seen = JSON.stringify(data);
      const changed = seen !== lastSeen.current;
      lastSeen.current = seen;
      setPage(data);
      if (!loadedOlder.current) setNextCursor(data.nextCursor);
      setError(null);
      if (changed) fetchMessagesStatus().catch(() => {});
      return changed ? "new" : "same";
    } catch (e) {
      setError(loadErrorMessage(e, t.messages.loadError));
      throw e;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load])
  );
  usePolling(load);

  async function handleRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const data = await fetchConversations(nextCursor);
      loadedOlder.current = true;
      setOlder((current) => [...current, ...data.conversations]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setMoreError(loadErrorMessage(e, t.messages.loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  const open = (summary: ConversationSummary) => router.push({ pathname: "/conversation", params: { id: summary.id } });
  const recentIds = new Set(page?.conversations.map((summary) => summary.id));
  const conversations = [...(page?.conversations ?? []), ...older.filter((summary) => !recentIds.has(summary.id))];
  const isEmpty = page !== null && conversations.length === 0 && page.invitations.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/activite"))}
          hitSlop={12}
          style={styles.navBack}
          accessibilityRole="button"
          accessibilityLabel={t.messages.back}
        >
          <Text style={styles.backLabel}>‹ {t.messages.back}</Text>
        </Pressable>
      </View>
      {page === null && error ? (
        <LoadFailure message={error} onRetry={() => void load().catch(() => {})} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
        >
          <Text style={styles.title} accessibilityRole="header">
            {t.messages.title}
          </Text>
          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
          {page === null ? (
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton style={styles.skeletonAvatar} />
                <Skeleton style={{ width: "60%", height: 13 }} />
              </View>
            ))
          ) : isEmpty ? (
            <Text style={styles.empty}>{t.messages.empty}</Text>
          ) : (
            <>
              {page.invitations.length > 0 ? (
                <View style={styles.section} testID="invitations">
                  <Text style={styles.sectionTitle} accessibilityRole="header">
                    {t.messages.invitations}
                  </Text>
                  <Text style={styles.hint}>{t.messages.invitationsHint}</Text>
                  {page.invitations.map((summary) => (
                    <ConversationRow key={summary.id} summary={summary} onPress={() => open(summary)} />
                  ))}
                </View>
              ) : null}
              {conversations.length > 0 ? (
                <View style={styles.section}>
                  {page.invitations.length > 0 ? (
                    <Text style={styles.sectionTitle} accessibilityRole="header">
                      {t.messages.conversations}
                    </Text>
                  ) : null}
                  {conversations.map((summary) => (
                    <ConversationRow key={summary.id} summary={summary} onPress={() => open(summary)} />
                  ))}
                </View>
              ) : null}
              {moreError ? <ErrorMessage style={styles.error}>{moreError}</ErrorMessage> : null}
              {nextCursor ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void loadMore()}
                  disabled={loadingMore}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
                >
                  <Text style={styles.secondaryLabel}>{t.messages.loadMore}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.md },
  error: { fontSize: font.secondary, marginBottom: space.md },
  empty: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginTop: space.lg },
  section: { marginBottom: space.lg },
  sectionTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre, marginBottom: space.xs },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginBottom: space.xs },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm },
  skeletonAvatar: { width: 44, height: 44, borderRadius: radius.full },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
