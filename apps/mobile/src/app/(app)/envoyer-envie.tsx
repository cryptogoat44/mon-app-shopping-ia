import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { PublicProfile } from "@monapp/shared-types";
import { ApiError, searchUsers, sendPiece } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { useToast } from "@/lib/toast-context";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { PersonIcon, SearchIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";
import { t } from "@/i18n";

// Envoyer une envie à une personne sur Spotto (lot 5, 5.C) : un geste
// volontaire, vers une personne choisie. Le serveur applique son réglage
// « Qui peut m'envoyer des pièces », les blocages et la limite de débit ; un
// refus est expliqué sans dire pourquoi la personne refuse.
export default function SendPieceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function goBack() {
    if (router.canGoBack()) router.back();
    else if (id) router.replace({ pathname: "/envie", params: { id } });
    else router.replace("/profile");
  }

  function handleSearch(text: string) {
    setQuery(text);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      try {
        const data = await searchUsers(text.trim());
        if (thisRequestId === requestIdRef.current) setResults(data);
      } catch (e) {
        if (thisRequestId === requestIdRef.current) setError(loadErrorMessage(e, t.sendPiece.searchError));
      } finally {
        if (thisRequestId === requestIdRef.current) setLoading(false);
      }
    }, 350);
  }

  async function handleSend(person: PublicProfile) {
    if (!id || sendingTo) return;
    setSendingTo(person.id);
    setError(null);
    try {
      await sendPiece(id, person.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.sendPiece.sent(person.displayName));
      goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : loadErrorMessage(e, t.sendPiece.sendError));
      setSendingTo(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navBack} accessibilityRole="button" accessibilityLabel={t.sendPiece.back}>
          <Text style={styles.backLabel}>‹ {t.sendPiece.back}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">{t.sendPiece.title}</Text>
        <Text style={styles.hint}>{t.sendPiece.hint}</Text>

        <View style={styles.searchBar}>
          <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
          <TextInput
            style={styles.searchInput}
            placeholder={t.sendPiece.searchLabel}
            placeholderTextColor={color.acier}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            accessibilityLabel={t.sendPiece.searchLabel}
          />
        </View>

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        {loading ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
        {!loading && results?.length === 0 ? <Text style={styles.empty}>{t.sendPiece.empty}</Text> : null}

        {results?.map((person) => {
          const busy = sendingTo === person.id;
          return (
            <View key={person.id} style={styles.row}>
              <View style={styles.avatar}>
                {person.avatarUrl ? (
                  <Image source={{ uri: person.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
                ) : (
                  <PersonIcon size={20} tint={color.acier} />
                )}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.displayName}>{person.displayName}</Text>
                <Text style={styles.username}>@{person.username}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.sendPiece.sendTo(person.displayName)}
                accessibilityState={{ disabled: sendingTo !== null, busy }}
                onPress={() => handleSend(person)}
                disabled={sendingTo !== null}
                style={[styles.sendButton, sendingTo !== null && !busy ? styles.sendButtonDisabled : null]}
              >
                <Text style={styles.sendLabel}>{busy ? t.sendPiece.sending : t.sendPiece.send}</Text>
              </Pressable>
            </View>
          );
        })}
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: color.plinthe,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginBottom: space.lg,
  },
  searchInput: { flex: 1, fontSize: font.body, color: color.encre, padding: 0 },
  error: { fontSize: font.secondary, marginBottom: space.md },
  loader: { marginTop: space.md },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.filet },
  avatar: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  rowText: { flex: 1 },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  sendButton: { backgroundColor: color.vert, borderRadius: radius.full, paddingHorizontal: space.md, minHeight: 36, minWidth: 44, justifyContent: "center" },
  sendButtonDisabled: { backgroundColor: color.inactif },
  sendLabel: { fontSize: font.caption, fontWeight: "600", color: color.blanc },
}));
