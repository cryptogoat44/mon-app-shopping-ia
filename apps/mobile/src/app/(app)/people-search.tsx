import { useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { PublicProfile } from "@monapp/shared-types";
import { FormError, FormField } from "@/components/form";
import { ApiError, followUser, searchUsers, unfollowUser } from "@/lib/api";
import { theme } from "@/lib/theme";

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
      <View style={styles.avatar} />
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

  async function handleSearch(text: string) {
    setQuery(text);
    if (!text.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchUsers(text.trim());
      setResults(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La recherche a échoué.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={styles.backLabel}>← Fil</Text>
        </Pressable>

        <Text style={styles.title}>Rechercher des profils</Text>

        <FormError message={error} />

        <FormField
          label="Nom d'utilisateur"
          placeholder="ex. camille_l"
          value={query}
          onChangeText={handleSearch}
        />

        {loading ? <ActivityIndicator color={theme.color.accent} style={styles.loader} /> : null}

        {results?.length === 0 ? <Text style={styles.empty}>Aucun profil trouvé.</Text> : null}

        {results?.map((person) => (
          <PersonRow key={person.id} person={person} onToggle={() => {}} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { padding: theme.space.lg, paddingBottom: theme.space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  back: { marginBottom: theme.space.lg },
  backLabel: { color: theme.color.accentInk, fontSize: theme.font.small },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.lg },
  loader: { marginTop: theme.space.md },
  empty: { fontSize: theme.font.body, color: theme.color.muted, textAlign: "center", marginTop: theme.space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.line,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.line },
  rowText: { flex: 1 },
  displayName: { fontSize: theme.font.body, fontWeight: "600", color: theme.color.ink },
  username: { fontSize: theme.font.small, color: theme.color.muted },
  followButton: {
    borderWidth: 1,
    borderColor: theme.color.ink,
    borderRadius: 100,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
  },
  followingButton: { backgroundColor: theme.color.ink },
  followButtonLabel: { fontSize: theme.font.small, fontWeight: "600", color: theme.color.ink },
  followingButtonLabel: { color: theme.color.ground },
});
