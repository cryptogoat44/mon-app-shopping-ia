import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { getRecentSearches } from "@/api/client";
import { clearLastSpotResult } from "@/api/spotSession";
import { ErrorMessage } from "@/components/error-message";
import { RecentSearchRow, type RecentSearch } from "@/components/recent-searches";
import { RECENT_SEARCHES_LIMIT, reopenParams } from "@/lib/recent-searches";
import { themedStyles } from "@/theme/themed-styles";

// « Tout voir » (lot « Retrouver ses pièces ») : les 20 dernières recherches
// réussies en liste, avec leur jour, pour retrouver la semaine suivante une
// pièce vue sans la garder — sans repayer une recherche. Une simple liste
// verticale : elle se fait défiler partout, à la souris sur le site comme au
// doigt sur iPhone, ce que la rangée de l'accueil ne permet pas sur le site.
export default function RecentSearchesScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<RecentSearch[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getRecentSearches(RECENT_SEARCHES_LIMIT)
      .then(setEntries)
      .catch(() => setFailed(true));
  }, []);

  // Relue à chaque retour sur l'écran : une recherche faite entre-temps apparaît en tête.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  function open(entry: RecentSearch) {
    // Comme depuis l'accueil : toujours relue sur le serveur (gratuit), jamais
    // la copie en mémoire du dernier lancement ; la proposition de la ligne en grand.
    clearLastSpotResult();
    router.push({ pathname: "/spot/result", params: reopenParams(entry) });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.result.backToSpotter}>
          <Text style={styles.backLabel}>‹ {t.spotter.title}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.spotter.recentlySpotted}
        </Text>
        <Text style={styles.lead}>{t.retrouverPieces.recentLead}</Text>

        {entries === null ? (
          failed ? (
            <View style={styles.centered}>
              <ErrorMessage style={styles.message}>{t.retrouverPieces.recentLoadError}</ErrorMessage>
              <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                <Text style={styles.retryLabel}>{t.common.retry}</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={color.encre} style={styles.loading} />
          )
        ) : entries.length === 0 ? (
          <Text style={styles.empty}>{t.retrouverPieces.recentEmpty}</Text>
        ) : (
          <>
            <View style={styles.list}>
              {entries.map((entry) => (
                <RecentSearchRow key={entry.searchId} entry={entry} onOpen={() => open(entry)} />
              ))}
            </View>
            {entries.length >= RECENT_SEARCHES_LIMIT ? <Text style={styles.note}>{t.retrouverPieces.recentLimitNote(RECENT_SEARCHES_LIMIT)}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginTop: space.sm },
  lead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  loading: { marginTop: space.xl },
  centered: { alignItems: "center", marginTop: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", lineHeight: 21 },
  retry: { marginTop: space.sm, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  empty: { fontSize: font.secondary, color: color.acier, marginTop: space.xl, lineHeight: 21 },
  list: { marginTop: space.md },
  note: { fontSize: font.caption, color: color.acier, marginTop: space.lg, lineHeight: 18 },
}));
