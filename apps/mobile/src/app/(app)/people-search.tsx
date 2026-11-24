import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { FollowState, PublicProfile } from "@monapp/shared-types";
import { ApiError, followUser, searchUsers, unfollowUser } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";
import { MoreIcon, SearchIcon } from "@/components/icons";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { useToast } from "@/lib/toast-context";
import { followActionFor, followButton, followStateOf } from "@/lib/follow-state";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";
import { t } from "@/i18n";
import { Avatar } from "@/components/avatar";
import { AccountSuggestions } from "@/components/account-suggestions";
import { profileSearchQuery } from "@/lib/people-search-query";

function PersonRow({
  person,
  onToggle,
  onOpenMenu,
  onOpenProfile,
}: {
  person: PublicProfile;
  onToggle: (id: string) => void;
  onOpenMenu: () => void;
  onOpenProfile: () => void;
}) {
  // Suivre, Demandé (compte privé : demande en attente) ou Suivi(e).
  const [state, setState] = useState<FollowState>(followStateOf(person));
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function handleToggle() {
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (followActionFor(state) === "follow") {
        // Compte privé : le serveur répond « demandé ».
        setState(await followUser(person.id, "search"));
      } else {
        // Ne plus suivre, ou annuler la demande.
        await unfollowUser(person.id);
        setState("none");
      }
      onToggle(person.id);
    } catch (e) {
      // Silencieux pour la plupart des erreurs (l'état local ne change pas,
      // l'utilisateur peut simplement retoucher le bouton) — sauf une
      // limite de débit dépassée, qui mérite un message clair plutôt
      // qu'un bouton qui semble ne rien faire.
      if (e instanceof ApiError && e.status === 429) {
        showToast(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const button = followButton(state, t.peopleSearch.following);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onOpenProfile}
        style={styles.personLink}
        accessibilityRole="link"
        accessibilityLabel={t.common.viewProfile(person.displayName)}
      >
        <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={40} />
        <View style={styles.rowText}>
          <Text style={styles.displayName}>{person.displayName}</Text>
          <Text style={styles.username}>@{person.username}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={button.label}
        accessibilityHint={button.hint}
        onPress={handleToggle}
        disabled={busy}
        style={[styles.followButton, state === "following" ? styles.followingButton : null]}
      >
        <Text style={[styles.followButtonLabel, state === "following" ? styles.followingButtonLabel : null]}>{button.label}</Text>
      </Pressable>
      <Pressable onPress={onOpenMenu} hitSlop={11} style={styles.moreButton} accessibilityRole="button" accessibilityLabel={t.common.moreOptions}>
        <MoreIcon size={18} tint={color.acier} />
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
  const [menuUserId, setMenuUserId] = useState<string | null>(null);
  // Comptes bloqués depuis cet écran : retirés aussi des comptes à découvrir.
  const [blockedIds, setBlockedIds] = useState<string[]>([]);

  function handleBlocked(blockedId: string) {
    setResults((prev) => (prev ? prev.filter((p) => p.id !== blockedId) : prev));
    setBlockedIds((prev) => [...prev, blockedId]);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSearch(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // « @marie » cherche « marie » : un pseudo ne contient pas d'@.
    const q = profileSearchQuery(text);

    if (!q) {
      // Le champ est vide (ou ne contient qu'un « @ ») : on oublie la recherche en cours.
      requestIdRef.current++;
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      const thisRequestId = ++requestIdRef.current;
      try {
        const data = await searchUsers(q);
        // Ignore les réponses obsolètes si l'utilisateur a retapé entre-temps.
        if (thisRequestId === requestIdRef.current) {
          setResults(data);
        }
      } catch (e) {
        if (thisRequestId === requestIdRef.current) {
          setError(e instanceof ApiError ? e.message : t.peopleSearch.error);
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
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        {/* Retours du build 2 : l'écran dit ce qu'il fait. */}
        <Text style={styles.navTitle} accessibilityRole="header" numberOfLines={1}>
          {t.peopleSearch.title}
        </Text>
      </View>
      {/* Le clavier est ouvert à l'arrivée : un toucher sur « Suivre » ou un profil agit tout de suite. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.searchBar}>
          <SearchIcon size={18} tint={color.acier} strokeWidth={1.6} />
          <TextInput
            style={styles.searchInput}
            placeholder={t.peopleSearch.placeholder}
            placeholderTextColor={color.acier}
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            // On arrive ici en touchant un champ (la pastille du Fil) : le clavier s'ouvre tout de suite.
            autoFocus
            returnKeyType="search"
            accessibilityLabel={t.peopleSearch.label}
          />
        </View>

        {/* Lot « découverte » : tant que le champ est vide, des comptes à découvrir. */}
        {profileSearchQuery(query) === "" ? (
          <View style={styles.suggestions}>
            <AccountSuggestions hiddenIds={blockedIds} />
          </View>
        ) : null}

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        {loading ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}

        {results?.length === 0 ? <Text style={styles.empty}>{t.peopleSearch.empty}</Text> : null}

        {results?.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            onToggle={() => {}}
            onOpenMenu={() => setMenuUserId(person.id)}
            onOpenProfile={() => router.push({ pathname: "/profil", params: { id: person.id } })}
          />
        ))}
      </ScrollView>

      <ReportBlockMenu
        visible={menuUserId !== null}
        onClose={() => setMenuUserId(null)}
        userId={menuUserId ?? ""}
        onBlocked={handleBlocked}
      />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { minHeight: 47, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 12 },
  navTitle: { flexShrink: 1, fontSize: font.body, fontWeight: "600", color: color.encre },
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
  // La rangée défile jusqu'aux bords de l'écran (elle a ses propres marges).
  suggestions: { marginHorizontal: -space.lg },
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
  rowText: { flex: 1 },
  personLink: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
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
  moreButton: { marginLeft: space.sm, padding: 2 },
}));
