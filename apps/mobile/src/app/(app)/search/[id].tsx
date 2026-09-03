import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ProductMatch, ProductSearch } from "@monapp/shared-types";
import { PrimaryButton } from "@/components/form";
import { ApiError, fetchSearch, trackProductMatchClick, uploadSearchScreenshot } from "@/lib/api";
import { theme } from "@/lib/theme";

function formatPrice(match: ProductMatch): string | null {
  if (match.priceMin === null) return null;
  const currency = match.currency === "EUR" ? "€" : (match.currency ?? "");
  return `${match.priceMin.toFixed(2)} ${currency}`.trim();
}

function MatchCard({ match, onError }: { match: ProductMatch; onError: (message: string) => void }) {
  const price = formatPrice(match);
  const [opening, setOpening] = useState(false);

  async function handleOpen() {
    setOpening(true);
    try {
      const { url } = await trackProductMatchClick(match.id);
      await Linking.openURL(url);
    } catch {
      onError("Impossible d'ouvrir ce lien, réessayez.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={styles.card}>
      <Image source={{ uri: match.imageUrl }} style={styles.cardImage} contentFit="cover" />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {match.productName}
        </Text>
        <View style={styles.cardMetaRow}>
          {match.merchantName ? <Text style={styles.cardMeta}>{match.merchantName}</Text> : null}
          {price ? <Text style={styles.cardPrice}>{price}</Text> : null}
        </View>
        <Pressable onPress={handleOpen} disabled={opening} hitSlop={4}>
          <Text style={styles.cardLink}>{opening ? "Ouverture…" : "Voir chez le marchand →"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function SearchResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [search, setSearch] = useState<ProductSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSearch(id);
      setSearch(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger cette recherche.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePickScreenshot() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Autorisez l'accès à vos photos pour importer une capture d'écran.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    setError(null);
    try {
      const updated = await uploadSearchScreenshot(id, result.assets[0].uri);
      setSearch(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "L'envoi de l'image a échoué.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const needsFallback = !loading && (!search || search.status === "failed" || search.status === "pending");
  const hasMatches = (search?.matches.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={styles.backLabel}>← Nouvelle recherche</Text>
        </Pressable>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {hasMatches ? (
          <>
            <Text style={styles.title}>Produits identifiés</Text>
            <View style={styles.disclosure}>
              <Text style={styles.disclosureText}>
                Certains liens ci-dessous sont des liens affiliés : nous pouvons percevoir une commission si vous
                achetez via ces liens, sans coût supplémentaire pour vous.
              </Text>
            </View>
            {search!.matches.map((match) => (
              <MatchCard key={match.id} match={match} onError={setError} />
            ))}
          </>
        ) : null}

        {needsFallback ? (
          <View style={styles.fallback}>
            <Text style={styles.title}>
              {hasMatches ? "Pas le bon produit ?" : "Résultat automatique insuffisant"}
            </Text>
            <Text style={styles.subtitle}>
              Importez une capture d'écran du moment précis de la vidéo qui vous intéresse — c'est le repli le plus
              fiable, indépendant de l'aléa de la miniature.
            </Text>
            <PrimaryButton
              label={uploading ? "Analyse de l'image…" : "Importer une capture d'écran"}
              onPress={handlePickScreenshot}
              disabled={uploading}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: theme.space.lg, paddingBottom: theme.space.xl },
  back: { marginBottom: theme.space.lg },
  backLabel: { color: theme.color.accentInk, fontSize: theme.font.small },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink, marginBottom: theme.space.sm },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.md },
  errorBanner: {
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.small },
  disclosure: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  disclosureText: { fontSize: theme.font.small, color: theme.color.muted, lineHeight: 18 },
  fallback: { marginTop: theme.space.md },
  card: {
    flexDirection: "row",
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.lg,
    marginBottom: theme.space.sm,
    overflow: "hidden",
  },
  cardImage: { width: 96, height: 96, backgroundColor: theme.color.line },
  cardBody: { flex: 1, padding: theme.space.sm, justifyContent: "center" },
  cardTitle: { fontSize: theme.font.body, fontWeight: "600", color: theme.color.ink, marginBottom: theme.space.xs },
  cardMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: theme.space.xs },
  cardMeta: { fontSize: theme.font.small, color: theme.color.muted },
  cardPrice: { fontSize: theme.font.small, color: theme.color.ink, fontWeight: "600" },
  cardLink: { fontSize: theme.font.small, color: theme.color.accentInk },
});
