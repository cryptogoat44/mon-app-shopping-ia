import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { ConversationSummary, PublicProfile } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchConversations, searchUsers } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { ConversationRow } from "@/components/conversation-row";
import { ErrorMessage } from "@/components/error-message";
import { SearchIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

// « Envoyer dans une conversation » (lot messages), depuis une envie
// (`wishId`), ou « Envoyer à un ami » depuis l'écran Résultat (`matchId`, une
// proposition d'une de vos recherches) : le choix d'une conversation ouverte,
// ou d'une autre personne (recherche par nom) pour une nouvelle conversation.
// La carte y est jointe, la personne peut ajouter un mot avant d'envoyer
// (écran de la conversation, qui applique les règles d'invitation).
export default function ChooseConversationScreen() {
  const { wishId, matchId } = useLocalSearchParams<{ wishId?: string; matchId?: string }>();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = usePeopleSearch();
  // La carte suit la personne choisie jusqu'à l'écran de la conversation (une seule à la fois).
  const attached = wishId ? { wishId } : matchId ? { matchId } : {};

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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          {t.messages.chooseTitle}
        </Text>
        <Text style={styles.hint}>{matchId ? t.messages.chooseHintPiece : t.messages.chooseHint}</Text>
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        {conversations === null && !error ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
        {conversations?.length === 0 ? <Text style={styles.empty}>{t.messages.chooseEmpty}</Text> : null}
        {conversations?.map((summary) => (
          <ConversationRow
            key={summary.id}
            summary={summary}
            label={t.messages.chooseLabel(summary.other.displayName)}
            onPress={() => router.replace({ pathname: "/conversation", params: { id: summary.id, ...attached } })}
          />
        ))}

        {/* Une nouvelle conversation : la personne est cherchée par son nom ; l'écran de la
            conversation dit si le premier message sera une invitation, ou s'il n'est pas possible. */}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t.messages.chooseSomeoneElse}
        </Text>
        <View style={styles.searchBar}>
          <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
          <TextInput
            style={styles.searchInput}
            placeholder={t.messages.chooseSearchLabel}
            placeholderTextColor={color.acier}
            value={people.query}
            onChangeText={people.search}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t.messages.chooseSearchLabel}
          />
        </View>
        {people.error ? <ErrorMessage style={styles.error}>{people.error}</ErrorMessage> : null}
        {people.loading ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
        {!people.loading && people.results?.length === 0 ? <Text style={styles.empty}>{t.messages.chooseSearchEmpty}</Text> : null}
        {people.results?.map((person) => (
          <Pressable
            key={person.id}
            style={styles.person}
            onPress={() => router.replace({ pathname: "/conversation", params: { userId: person.id, ...attached } })}
            accessibilityRole="button"
            accessibilityLabel={t.messages.chooseLabel(person.displayName)}
          >
            <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={40} />
            <View style={styles.personText}>
              <Text style={styles.displayName} numberOfLines={1}>
                {person.displayName}
              </Text>
              <Text style={styles.username} numberOfLines={1}>
                @{person.username}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Recherche d'une personne par son nom, 350 ms après la dernière frappe ;
 * seule la réponse de la dernière recherche est gardée. */
function usePeopleSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  function search(text: string) {
    setQuery(text);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const thisRequestId = ++requestIdRef.current;
    if (!text.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchUsers(text.trim())
        .then((found) => {
          if (thisRequestId === requestIdRef.current) setResults(found);
        })
        .catch((e) => {
          if (thisRequestId === requestIdRef.current) setError(loadErrorMessage(e, t.messages.chooseSearchError));
        })
        .finally(() => {
          if (thisRequestId === requestIdRef.current) setLoading(false);
        });
    }, 350);
  }

  return { query, results, loading, error, search };
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
  sectionTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginTop: space.xl, marginBottom: space.sm },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginBottom: space.sm,
  },
  searchInput: { flex: 1, fontSize: font.body, color: color.encre, padding: 0 },
  person: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 56, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  personText: { flex: 1, minWidth: 0 },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
}));
