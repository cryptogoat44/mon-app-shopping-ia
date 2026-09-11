import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { PublicProfile } from "@monapp/shared-types";
import { ApiError, followUser, searchUsers, unfollowUser } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";
import { PersonIcon, SearchIcon } from "@/components/icons";

function PersonRow({ person, onToggle }: { person: PublicProfile; onToggle: (id: string) => void }) {
  const [following, setFollowing] = useState(person.isFollowing);
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      if (following) {
        await unfollowUser(person.id);
      } else {
        await followUser(person.id);
      }
      setFollowing((f) => !f);
      onToggle(person.id);
    } catch {
      // silencieux : l'état local ne change pas, l'utilisateur peut réessayer
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <PersonIcon size={20} tint={color.acier} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.displayName}>{person.displayName}</Text>
        <Text style={styles.username}>@{person.username}</Text>
      </View>
      <Pressable onPress={handleToggle} disabled={busy} style={[styles.followButton, following ? styles.followingButton : null]}>
        <Text style={[styles.followButtonLabel, following ? styles.followingButtonLabel : null]}>
          {following ? "Suivi(e)" : "Suivre"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function PeopleSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSearch(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!text.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      try {
        const data = await searchUsers(text.trim());
        // Ignore les réponses obsolètes si l'utilisateur a retapé entre-temps.
        if (thisRequestId === requestIdRef.current) {
          setResults(data);
        }
      } catch (e) {
        if (thisRequestId === requestIdRef.current) {
          setError(e instanceof ApiError ? e.message : "La recherche a échoué.");
        }
      } finally {
        if (thisRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, 350);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/feed"))} hitSlop={8}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchBar}>
          <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher"
            placeholderTextColor={color.acier}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}

        {results?.length === 0 ? <Text style={styles.empty}>Aucun profil trouvé.</Text> : null}

        {results?.map((person) => (
          <PersonRow key={person.id} person={person} onToggle={() => {}} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
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
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  loader: { marginTop: space.md },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
  },
  avatar: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  followButton: {
    borderWidth: 1,
    borderColor: color.encre,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  followingButton: { backgroundColor: color.encre },
  followButtonLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  followingButtonLabel: { color: color.blanc },
});
