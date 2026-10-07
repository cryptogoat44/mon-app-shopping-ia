import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { getRecentSearches } from "@/api/client";
import type { Piece } from "@/api/types";
import { ClockIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { LinkEntry } from "@/components/link-entry";
import { LinkNotice } from "@/components/link-notice";
import { EntryTiles, LatestVideoCard } from "@/components/spot-entry";
import { SpotImage } from "@/components/spot-image";
import { importPhotoForSpotter } from "@/lib/image-import";
import { findLatestVideo, latestVideoAllowed, latestVideoUri, type LatestVideo } from "@/lib/latest-video";
import { beginFromPhoto } from "@/lib/spot-flow";
import { LINK_COVER_ENABLED } from "@/lib/spot-flags";
import { adoptSpotVideo, videoImportMessage } from "@/lib/spot-video";
import { useVideoImport } from "@/lib/use-video-import";
import { themedStyles } from "@/theme/themed-styles";

/** Dernière vidéo de la galerie (app iPhone), relue à chaque retour sur
 * Spotter. L'accès aux photos n'est demandé qu'une fois, par le système. */
function useLatestVideo() {
  const [latest, setLatest] = useState<LatestVideo | null>(null);
  const load = useCallback(async () => {
    try {
      setLatest((await latestVideoAllowed()) ? await findLatestVideo() : null);
    } catch {
      // Galerie illisible : les entrées habituelles restent proposées.
      setLatest(null);
    }
  }, []);
  return { latest, load };
}

function RecentRow({ recent }: { recent: { searchId: string; piece: Piece }[] }) {
  const router = useRouter();
  if (recent.length === 0) return null;
  return (
    <View style={styles.recentSection}>
      <Text style={styles.recentTitle} accessibilityRole="header">
        {t.spotter.recentlySpotted}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
        {recent.map(({ searchId, piece }) => (
          <Pressable
            key={searchId}
            style={styles.recentItem}
            onPress={() => router.push({ pathname: "/spot/result", params: { searchId } })}
            accessibilityRole="button"
            accessibilityLabel={piece.name}
          >
            <View style={styles.recentThumb}>
              {piece.imageUrl ? <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} fit="cover" /> : <ClockIcon size={26} tint={color.acier} />}
            </View>
            <Text style={styles.recentName} numberOfLines={1}>
              {piece.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Lien collé ou partagé : aide discrète — comment ajouter la vidéo (enregistrement de l'écran). */
function LinkHelp({ onAddVideo, importing }: { onAddVideo: () => void; importing: boolean }) {
  const [open, setOpen] = useState(false);
  if (LINK_COVER_ENABLED) return <LinkEntry />;
  return (
    <>
      <Pressable onPress={() => setOpen((value) => !value)} style={styles.linkQuestion} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.linkQuestionLabel}>{t.spotter.linkQuestion}</Text>
      </Pressable>
      {open ? <LinkNotice onAddVideo={onAddVideo} busy={importing} /> : null}
    </>
  );
}

/** Entrées du Spotter : vidéo (sélecteur), photo, dernière vidéo de la galerie. */
function useSpotterEntries() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"photo" | "latest" | null>(null);
  const [query, setQuery] = useState("");
  const { importing, importVideo } = useVideoImport(setMessage);

  async function addPhoto() {
    setMessage(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "unavailable") return setMessage(t.common.photoUnavailable);
    if (picked.kind !== "picked") return;
    beginFromPhoto(picked.uri, { width: picked.width, height: picked.height });
    router.push({ pathname: "/spot/lancer", params: { source: "photo" } });
  }

  /** « Lancer » sur la dernière vidéo : elle s'ouvre (téléchargée depuis
   * iCloud si besoin), puis l'analyse démarre aussitôt. */
  async function launchLatest(latest: LatestVideo) {
    setMessage(null);
    setBusy("latest");
    try {
      const result = await adoptSpotVideo(await latestVideoUri(latest.id), null, "latest");
      if (result.kind !== "ready") return setMessage(videoImportMessage(result));
      router.push({ pathname: "/spot/lancer", params: { source: "video", query: query.trim(), auto: "1" } });
      // Recherche partie : au retour, le champ est prêt pour une autre vidéo.
      setQuery("");
    } catch {
      setMessage(t.video.unavailable);
    } finally {
      setBusy(null);
    }
  }

  return {
    message,
    query,
    onQuery: (value: string) => {
      setQuery(value);
      setMessage(null);
    },
    busy: importing ? ("video" as const) : busy,
    importing,
    addVideo: () => void importVideo(),
    addPhoto: () => void addPhoto(),
    launchLatest: (latest: LatestVideo) => void launchLatest(latest),
  };
}

// Spotter (lot 4 ter) : un seul point d'entrée, « Ajouter une vidéo », et la
// photo à égalité ; sur l'app iPhone, la dernière vidéo de la galerie est
// proposée d'emblée — il ne reste qu'à taper quelques mots et « Lancer ».
export default function SpotterScreen() {
  const [recent, setRecent] = useState<{ searchId: string; piece: Piece }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const entries = useSpotterEntries();
  const latestVideo = useLatestVideo();
  const { latest } = latestVideo;

  const loadRecent = useCallback(() => getRecentSearches().then(setRecent).catch(() => {}), []);
  useFocusEffect(
    useCallback(() => {
      loadRecent();
      void latestVideo.load();
    }, [loadRecent, latestVideo.load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadRecent(), latestVideo.load()]);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
      >
        <Text style={styles.title} accessibilityRole="header">
          {t.spotter.title}
        </Text>
        <Text style={styles.lead}>{t.spotter.lead}</Text>
        {latest ? (
          <LatestVideoCard
            video={latest}
            query={entries.query}
            onQuery={entries.onQuery}
            onLaunch={() => entries.launchLatest(latest)}
            onAddVideo={entries.addVideo}
            busy={entries.busy === "latest"}
          />
        ) : null}
        {entries.message ? <ErrorMessage style={styles.feedback}>{entries.message}</ErrorMessage> : null}
        <EntryTiles videoLabel={latest ? t.spotter.otherVideo : t.spotter.addVideo} onVideo={entries.addVideo} onPhoto={entries.addPhoto} busy={entries.busy} />
        <LinkHelp onAddVideo={entries.addVideo} importing={entries.importing} />
        <RecentRow recent={recent} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  lead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  feedback: { fontSize: font.caption, marginTop: space.sm, lineHeight: 18 },
  linkQuestion: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  linkQuestionLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline", textAlign: "center" },
  recentSection: { marginTop: space.xxl - space.xs },
  recentTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.md },
  recentRow: { gap: space.md },
  recentItem: { width: 104 },
  recentThumb: { width: 104, height: 104, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  recentName: { fontSize: font.caption, color: color.acier, marginTop: 7, lineHeight: 16 },
}));
