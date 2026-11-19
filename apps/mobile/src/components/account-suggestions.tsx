import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { FollowState, MemberRow } from "@monapp/shared-types";
import { ApiError, fetchSuggestions, followUser, unfollowUser } from "@/lib/api";
import { followActionFor, followButton, followStateOf } from "@/lib/follow-state";
import { useToast } from "@/lib/toast-context";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { Avatar } from "@/components/avatar";
import { themedStyles } from "@/theme/themed-styles";

// « Comptes à découvrir » (lot « découverte ») : une rangée qui défile de
// côté, en haut de « Pour vous », dans le fil « Abonnements » vide et dans la
// recherche de profils tant que le champ est vide. Le serveur choisit seul qui
// y figure (10 comptes au plus : d'abord ceux que suivent vos abonnements, puis
// les comptes publics les plus actifs ; jamais un compte privé, bloqué,
// suspendu, déjà suivi ou qui a refusé d'être proposé). Une phrase dit d'où
// viennent les suggestions. Serveur d'avant ce lot ou sans la migration 0050
// (404), ou lecture impossible : la rangée ne s'affiche pas, l'écran reste
// utilisable.

function SuggestionCard({ member, onOpenProfile }: { member: MemberRow; onOpenProfile: () => void }) {
  // Suivre, Demandé (compte privé) ou Suivi(e) : les trois états du compte privé.
  const [state, setState] = useState<FollowState>(followStateOf(member));
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function handleToggle() {
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (followActionFor(state) === "follow") setState(await followUser(member.id, "suggestion"));
      else {
        await unfollowUser(member.id);
        setState("none");
      }
    } catch (e) {
      // Une limite dépassée le dit ; le reste laisse le bouton tel quel, à retoucher.
      if (e instanceof ApiError && e.status === 429) showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  const button = followButton(state, t.peopleSearch.following);
  return (
    <View style={styles.card}>
      <Pressable onPress={onOpenProfile} style={styles.person} accessibilityRole="button" accessibilityLabel={t.common.viewProfile(member.displayName)}>
        <Avatar uri={member.avatarUrl} userId={member.id} displayName={member.displayName} username={member.username} size={56} />
        <Text style={styles.displayName} numberOfLines={1}>
          {member.displayName}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          @{member.username}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={button.label}
        accessibilityHint={button.hint}
        onPress={handleToggle}
        disabled={busy}
        style={[styles.followButton, button.primary ? styles.followPrimary : null]}
      >
        <Text style={[styles.followLabel, button.primary ? styles.followPrimaryLabel : null]} numberOfLines={1}>
          {button.label}
        </Text>
      </Pressable>
    </View>
  );
}

export function AccountSuggestions({ hiddenIds = [] }: { hiddenIds?: readonly string[] }) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSuggestions()
      .then((response) => {
        if (!cancelled) setMembers(response.members);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable || members === null) return null;
  const shown = members.filter((member) => !hiddenIds.includes(member.id));
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        {t.forYou.suggestionsTitle}
      </Text>
      <Text style={styles.how}>{t.forYou.suggestionsHow}</Text>
      {shown.length === 0 ? (
        <Text style={styles.empty}>{t.forYou.suggestionsEmpty}</Text>
      ) : (
        <FlatList
          horizontal
          data={shown}
          keyExtractor={(member) => member.id}
          accessibilityRole="list"
          accessibilityLabel={t.forYou.suggestionsTitle}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          renderItem={({ item: member }) => <SuggestionCard member={member} onOpenProfile={() => router.push({ pathname: "/profil", params: { id: member.id } })} />}
        />
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { paddingVertical: space.md, gap: space.xs },
  title: { fontSize: font.secondary, fontWeight: "600", color: color.encre, paddingHorizontal: space.lg },
  how: { fontSize: font.caption, color: color.acier, lineHeight: 18, paddingHorizontal: space.lg },
  empty: { fontSize: font.secondary, color: color.acier, paddingHorizontal: space.lg, marginTop: space.xs },
  row: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  card: {
    width: 148,
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
  },
  person: { alignItems: "center", gap: 4, minHeight: 44, alignSelf: "stretch" },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre, textAlign: "center" },
  username: { fontSize: font.caption, color: color.acier, textAlign: "center" },
  followButton: {
    alignSelf: "stretch",
    minHeight: 44,
    paddingHorizontal: space.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.encre,
    alignItems: "center",
    justifyContent: "center",
  },
  followPrimary: { backgroundColor: color.encre },
  followLabel: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  followPrimaryLabel: { color: color.blanc },
}));
