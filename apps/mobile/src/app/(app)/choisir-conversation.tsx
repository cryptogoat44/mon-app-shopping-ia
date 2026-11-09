import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { ConversationSummary } from "@monapp/shared-types";
import { color, font, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchConversations } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { ConversationRow } from "@/components/conversation-row";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// « Envoyer dans une conversation » (lot messages), depuis une envie : le
// choix d'une conversation ouverte ; l'envie y est jointe, la personne peut
// ajouter un mot avant d'envoyer (écran de la conversation).
export default function ChooseConversationScreen() {
  const { wishId } = useLocalSearchParams<{ wishId?: string }>();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchConversations()
        .then((page) => {
          setConversations(page.conversations.filter((summary) => summary.state === "open"));
          setError(null);
        })
        .catch((e) => setError(loadErrorMessage(e, t.messages.loadError)));
    }, [])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else if (wishId) router.replace({ pathname: "/envie", params: { id: wishId } });
    else router.replace("/profile");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.messages.back}>
          <Text style={styles.backLabel}>‹ {t.messages.back}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.messages.chooseTitle}
        </Text>
        <Text style={styles.hint}>{t.messages.chooseHint}</Text>
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        {conversations === null && !error ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
        {conversations?.length === 0 ? <Text style={styles.empty}>{t.messages.chooseEmpty}</Text> : null}
        {conversations?.map((summary) => (
          <ConversationRow
            key={summary.id}
            summary={summary}
            label={t.messages.chooseLabel(summary.other.displayName)}
            onPress={() => router.replace({ pathname: "/conversation", params: { id: summary.id, ...(wishId ? { wishId } : {}) } })}
          />
        ))}
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
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.xs },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginBottom: space.md },
  error: { fontSize: font.secondary, marginBottom: space.md },
  loader: { marginTop: space.md },
  empty: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginTop: space.md },
}));
