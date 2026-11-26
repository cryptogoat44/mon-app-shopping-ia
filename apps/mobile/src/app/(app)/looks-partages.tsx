import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { SharedLookSummary } from "@monapp/shared-types";
import { color, font, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { getActiveLocale, t } from "@/i18n";
import { ApiError } from "@/lib/api-error";
import { formatLongDate } from "@/lib/format";
import { listLooks, stopLook } from "@/lib/look-pages";
import { useToast } from "@/lib/toast-context";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// « Pages look partagées » (lot « page look », Réglages → Vos données) :
// chaque page active, avec le nom de la pièce, ses dates, « Copier le lien »
// et « Arrêter le partage » (confirmé : le lien ne marchera plus pour personne).

function LookRow({ look, onStopped }: { look: SharedLookSummary; onStopped: (id: string) => void }) {
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = getActiveLocale();

  async function copy() {
    await Clipboard.setStringAsync(look.url).catch(() => undefined);
    showToast(t.look.linkCopied);
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await stopLook(look.id);
      onStopped(look.id);
    } catch (e) {
      // Déjà arrêtée ou expirée : elle disparaît de la liste.
      if (e instanceof ApiError && e.status === 404) onStopped(look.id);
      else setError(e instanceof ApiError ? e.message : t.common.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.name}>{look.title}</Text>
      <Text style={styles.dates}>{t.look.createdExpires(formatLongDate(look.createdAt, locale), formatLongDate(look.expiresAt, locale))}</Text>
      {confirming ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.confirm}>{t.look.stopConfirm}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={stop} disabled={busy} accessibilityState={{ busy }} hitSlop={10}>
              <Text style={styles.danger}>{t.look.stop}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} disabled={busy} hitSlop={10}>
              <Text style={styles.link}>{t.look.cancel}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={copy} hitSlop={10}>
            <Text style={styles.link}>{t.look.copyLink}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} hitSlop={10}>
            <Text style={styles.danger}>{t.look.stop}</Text>
          </Pressable>
        </View>
      )}
      {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
    </View>
  );
}

export default function SharedLooksScreen() {
  const router = useRouter();
  const [looks, setLooks] = useState<SharedLookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listLooks()
        .then((data) => {
          setLooks(data.looks);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : t.common.genericError));
    }, [])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.look.settingsEntry}
        </Text>
        {looks === null && !error ? (
          [0, 1].map((i) => <Skeleton key={i} style={styles.skeleton} />)
        ) : error ? (
          <ErrorMessage style={styles.error}>{error}</ErrorMessage>
        ) : looks?.length === 0 ? (
          <Text style={styles.empty}>{t.look.empty}</Text>
        ) : (
          looks?.map((look) => <LookRow key={look.id} look={look} onStopped={(id) => setLooks((prev) => (prev ? prev.filter((item) => item.id !== id) : prev))} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  back: { fontSize: 26, color: color.encre },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre, marginBottom: space.md },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 560, alignSelf: "center", width: "100%" },
  skeleton: { height: 64, marginBottom: space.sm },
  error: { fontSize: font.secondary, color: color.acier, marginTop: space.sm },
  empty: { fontSize: font.secondary, color: color.acier, marginTop: space.lg },
  row: { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.filet, gap: space.xs },
  name: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  dates: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  confirm: { fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: space.xs },
  link: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  danger: { fontSize: font.secondary, color: color.encre, fontWeight: "600", textDecorationLine: "underline" },
}));
