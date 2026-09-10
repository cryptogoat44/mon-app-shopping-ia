import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { addToVaultFromPiece, addToWishlist } from "@/api/client";
import { getLastSpotResult } from "@/api/spotSession";
import type { Piece, SpotResult } from "@/api/types";
import { ClockIcon, NotFoundIcon, VerifiedIcon } from "@/components/icons";

function formatPrice(piece: Piece): string | null {
  if (piece.priceFrom === null) return null;
  const currency = piece.currency === "EUR" ? "€" : (piece.currency ?? "");
  return `à partir de ${piece.priceFrom.toLocaleString("fr-FR")} ${currency}`.trim();
}

export default function ResultScreen() {
  const router = useRouter();
  const { type, value } = useLocalSearchParams<{ type: "link" | "photo"; value: string }>();
  const [result] = useState<SpotResult | null>(() => getLastSpotResult());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [kept, setKept] = useState(false);
  const [bought, setBought] = useState(false);

  const piece = result?.pieces[selectedIndex] ?? null;

  useEffect(() => {
    if (result?.status === "success") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [result?.status]);

  function handleRetry() {
    router.replace({ pathname: "/spot/analysis", params: { type, value } });
  }

  async function handleOpenMerchant() {
    if (!piece?.merchantUrl) return;
    await WebBrowser.openBrowserAsync(piece.merchantUrl);
  }

  async function handleKeep() {
    if (!piece || kept) return;
    setKept(true);
    await addToWishlist(piece).catch(() => setKept(false));
  }

  async function handleMarkBought() {
    if (!piece || bought) return;
    setBought(true);
    await addToVaultFromPiece(piece).catch(() => setBought(false));
  }

  async function handleShare() {
    if (!piece) return;
    await Share.share({ message: `${piece.name} — repéré avec Spotto` }).catch(() => {});
  }

  if (!result || result.status === "failed") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.back}>‹</Text>
          </Pressable>
        </View>
        <View style={styles.failContent}>
          <View style={styles.failFrame}>
            <NotFoundIcon size={44} />
          </View>
          <Text style={styles.failTitle}>{fr.result.failTitle}</Text>
          <Text style={styles.failTip}>{fr.result.failTip}</Text>
          <Pressable style={styles.retryCta} onPress={handleRetry}>
            <Text style={styles.retryLabel}>{fr.result.retry}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!piece) return null;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.frame}>
          <ClockIcon size={100} tint={color.encre} />
        </View>

        {result.pieces.length > 1 ? (
          <View style={styles.picker}>
            {result.pieces.map((p, index) => (
              <Pressable
                key={p.id}
                style={[styles.pk, index === selectedIndex ? styles.pkActive : null]}
                onPress={() => setSelectedIndex(index)}
              >
                <ClockIcon size={22} tint={color.encre} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {result.pieces.length > 1 ? (
          <Text style={styles.hint}>
            {result.pieces.length} {fr.result.multiplePiecesHint}
          </Text>
        ) : null}

        <View style={styles.match}>
          <VerifiedIcon size={13} />
          <Text style={styles.matchLabel}>{piece.confidence === "exact" ? fr.result.exactMatch : fr.result.similarPiece}</Text>
        </View>
        <Text style={styles.name}>{piece.name}</Text>
        {piece.reference || piece.material ? (
          <Text style={styles.ref}>{[piece.reference, piece.material].filter(Boolean).join(" · ")}</Text>
        ) : null}
        {formatPrice(piece) ? <Text style={styles.price}>{formatPrice(piece)}</Text> : null}

        {piece.merchantUrl ? (
          <Pressable style={styles.cta} onPress={handleOpenMerchant}>
            <Text style={styles.ctaLabel}>{fr.result.viewAt(piece.merchantName ?? "")}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.disclosure}>{fr.result.affiliateDisclosure}</Text>

        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={handleKeep} disabled={kept}>
            <Text style={styles.actionLabel}>{kept ? "Gardée ✓" : fr.result.keep}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={handleMarkBought} disabled={bought}>
            <Text style={styles.actionLabel}>{bought ? "Ajoutée ✓" : fr.result.markAsBought}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={handleShare}>
            <Text style={styles.actionLabel}>{fr.result.share}</Text>
          </Pressable>
        </View>

        {result.similarPieces.length > 0 ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>{fr.result.similarPieces}</Text>
            <View style={styles.similarRow}>
              {result.similarPieces.map((p) => (
                <View key={p.id} style={styles.similarItem}>
                  <View style={styles.similarThumb}>
                    <ClockIcon size={28} tint={color.encre} />
                  </View>
                  <Text style={styles.similarName} numberOfLines={1}>
                    {p.name}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  frame: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginBottom: space.md },
  picker: { flexDirection: "row", gap: 9, marginBottom: 6 },
  pk: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center" },
  pkActive: { borderWidth: 1.5, borderColor: color.encre },
  hint: { fontSize: font.caption, color: color.acier, marginBottom: space.lg },
  match: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  matchLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600" },
  name: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 28 },
  ref: { fontSize: font.secondary, color: color.acier, marginTop: 4 },
  price: { fontSize: font.caption, color: color.acier, marginTop: 10 },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  disclosure: { textAlign: "center", fontSize: 11.5, color: color.acier, marginTop: 10, textDecorationLine: "underline" },
  actions: { flexDirection: "row", justifyContent: "space-around", marginTop: space.lg },
  action: { paddingVertical: 6, paddingHorizontal: 4 },
  actionLabel: { fontSize: 11.5, color: color.acier },
  divider: { height: 1, backgroundColor: color.filet, marginTop: space.xl, marginBottom: space.lg },
  sectionTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.md },
  similarRow: { flexDirection: "row", gap: space.md },
  similarItem: { flex: 1 },
  similarThumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  similarName: { fontSize: font.caption, color: color.acier, marginTop: 7 },
  failContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -40 },
  failFrame: { width: 120, height: 120, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center", marginBottom: space.lg },
  failTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center", marginBottom: 10 },
  failTip: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.xl },
  retryCta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: 34 },
  retryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
