import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { ModerationPage, ModerationStatus } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchModerationQueue } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { SegmentedChoice } from "@/components/segmented-choice";
import { Skeleton } from "@/components/skeleton";
import { LoadFailure } from "@/components/load-failure";
import { ErrorMessage } from "@/components/error-message";
import { ModerationItemCard } from "@/components/moderation-item";
import { themedStyles } from "@/theme/themed-styles";

// Modération (lot 5, section 5.B) : réservée aux administrateurs — l'entrée
// des Réglages ne s'affiche que pour eux, et le serveur revérifie le rôle à
// chaque appel (404 pour tout autre compte). Signalements regroupés par
// contenu, « À traiter » et « Traités ».

const STATUSES: readonly ModerationStatus[] = ["open", "handled"];

function useModerationQueue(status: ModerationStatus) {
  const [queue, setQueue] = useState<ModerationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Une réponse arrivée après un changement d'onglet est ignorée.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    setMoreError(null);
    try {
      const page = await fetchModerationQueue(status);
      if (current === generation.current) setQueue(page);
    } catch (e) {
      if (current === generation.current) setError(loadErrorMessage(e, t.moderationQueue.loadError));
    }
  }, [status]);

  const loadMore = useCallback(async () => {
    if (!queue?.nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchModerationQueue(status, queue.nextCursor);
      if (current === generation.current) setQueue({ items: [...queue.items, ...page.items], nextCursor: page.nextCursor });
    } catch (e) {
      if (current === generation.current) setMoreError(loadErrorMessage(e, t.moderationQueue.loadError));
    } finally {
      setLoadingMore(false);
    }
  }, [queue, status, loadingMore]);

  useEffect(() => {
    setQueue(null);
  }, [status]);

  return { queue, error, moreError, loadingMore, reload, loadMore };
}

function QueueSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <Skeleton style={{ width: "45%", height: 14, marginBottom: space.sm }} />
          <Skeleton style={{ width: "80%", height: 12, marginBottom: space.xs }} />
          <Skeleton style={{ width: "60%", height: 12 }} />
        </View>
      ))}
    </>
  );
}

export default function ModerationScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ModerationStatus>("open");
  const { queue, error, moreError, loadingMore, reload, loadMore } = useModerationQueue(status);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const items = queue?.items ?? [];
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">{t.moderationQueue.title}</Text>
        <View style={styles.tabs}>
          <SegmentedChoice
            label={t.moderationQueue.tabs}
            options={STATUSES.map((value) => ({ value, label: value === "open" ? t.moderationQueue.open : t.moderationQueue.handled }))}
            value={status}
            onChange={setStatus}
          />
        </View>

        {error && !queue ? (
          <LoadFailure message={error} onRetry={() => void reload()} />
        ) : !queue ? (
          <QueueSkeleton />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{status === "open" ? t.moderationQueue.emptyOpen : t.moderationQueue.emptyHandled}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void reload()} accessibilityRole="button" accessibilityLabel={t.moderationQueue.refresh}>
              <Text style={styles.secondaryLabel}>{t.moderationQueue.refresh}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {error ? <ErrorMessage style={styles.inlineError}>{error}</ErrorMessage> : null}
            {items.map((item) => (
              <ModerationItemCard key={`${item.targetType}:${item.targetId}`} item={item} status={status} onChanged={() => void reload()} />
            ))}
            {moreError ? <ErrorMessage style={styles.inlineError}>{moreError}</ErrorMessage> : null}
            {queue.nextCursor ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void loadMore()}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel={t.moderationQueue.loadMore}
                accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
              >
                <Text style={styles.secondaryLabel}>{t.moderationQueue.loadMore}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 560, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.md },
  tabs: { marginBottom: space.lg },
  skeletonCard: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  empty: { alignItems: "center", paddingVertical: space.xl, gap: space.md },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center" },
  inlineError: { fontSize: font.secondary, marginBottom: space.md },
  secondaryButton: {
    minHeight: 44,
    minWidth: 44,
    alignSelf: "center",
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
