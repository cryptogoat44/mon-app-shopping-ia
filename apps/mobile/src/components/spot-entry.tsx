import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { VIDEO_AI } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { CameraIcon, VideoIcon } from "@/components/icons";
import { LinkNotice } from "@/components/link-notice";
import { QueryInput } from "@/components/spot-launch-views";
import { containsLink } from "@/lib/link-detection";
import type { LatestVideo } from "@/lib/latest-video";
import { formatClock, videoRejection } from "@/lib/video-timeline";
import { themedStyles } from "@/theme/themed-styles";

// Entrées du Spotter (lot 4 ter) : une vidéo ou une photo, d'égale importance,
// et sur l'app iPhone, la dernière vidéo de la galerie, prête à être analysée.

function Tile({ icon, label, onPress, busy, disabled }: { icon: ReactNode; label: string; onPress: () => void; busy: boolean; disabled: boolean }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ busy, disabled }}>
      {busy ? <ActivityIndicator color={color.vert} /> : icon}
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

/** Deux entrées égales, côte à côte : vidéo et photo. */
export function EntryTiles({
  videoLabel,
  onVideo,
  onPhoto,
  busy,
}: {
  videoLabel: string;
  onVideo: () => void;
  onPhoto: () => void;
  busy: "video" | "photo" | "latest" | null;
}) {
  return (
    <View style={styles.tiles}>
      <Tile icon={<VideoIcon size={24} tint={color.vert} />} label={videoLabel} onPress={onVideo} busy={busy === "video"} disabled={busy !== null} />
      <Tile icon={<CameraIcon size={24} tint={color.vert} />} label={t.spotter.addPhoto} onPress={onPhoto} busy={busy === "photo"} disabled={busy !== null} />
    </View>
  );
}

/** Dernière vidéo de la galerie (app iPhone) : il ne reste qu'à taper
 * quelques mots et « Lancer ». Trop longue : on le dit tout de suite. */
export function LatestVideoCard({
  video,
  query,
  onQuery,
  onLaunch,
  onAddVideo,
  busy,
}: {
  video: LatestVideo;
  query: string;
  onQuery: (value: string) => void;
  onLaunch: () => void;
  onAddVideo: () => void;
  busy: boolean;
}) {
  const duration = video.durationMs === null ? null : formatClock(video.durationMs);
  const tooLong = videoRejection({ durationMs: video.durationMs, sizeBytes: null }) === "too_long";
  const linkInQuery = containsLink(query);
  const valid = query.trim().length >= VIDEO_AI.queryMinLength && !linkInQuery;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Image
          source={{ uri: video.id }}
          style={styles.thumb}
          contentFit="cover"
          accessible
          accessibilityLabel={duration ? t.spotter.latestVideoLabel(duration) : t.spotter.latestVideo}
        />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {t.spotter.latestVideo}
          </Text>
          {duration ? <Text style={styles.cardMeta}>{duration}</Text> : null}
        </View>
      </View>
      {tooLong && video.durationMs !== null ? (
        <Text style={styles.cardNote}>{t.video.tooLong(formatClock(video.durationMs))}</Text>
      ) : (
        <>
          <QueryInput value={query} onChangeText={onQuery} onSubmit={() => valid && !busy && onLaunch()} testID="latest-query" style={styles.input} />
          {linkInQuery ? <LinkNotice style={styles.notice} onAddVideo={onAddVideo} /> : null}
          <Pressable
            style={[styles.primary, valid ? null : styles.primaryDisabled]}
            onPress={onLaunch}
            disabled={!valid || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid, busy }}
          >
            {busy ? <ActivityIndicator color={color.blanc} /> : null}
            <Text style={[styles.primaryLabel, valid ? null : styles.primaryLabelDisabled]}>{t.launch.launch}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  tiles: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  tile: {
    flex: 1,
    minHeight: 104,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
  },
  tileLabel: { color: color.encre, fontSize: font.secondary, fontWeight: "600", textAlign: "center" },
  card: { marginTop: space.lg, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  thumb: { width: 72, height: 96, borderRadius: radius.sm, backgroundColor: color.plinthe },
  cardText: { flex: 1 },
  cardTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  cardMeta: { fontSize: font.caption, color: color.acier, marginTop: 4, fontVariant: ["tabular-nums"] },
  cardNote: { fontSize: font.secondary, color: color.acier, marginTop: space.md, lineHeight: 21 },
  input: { marginTop: space.md },
  notice: { marginTop: space.md },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.md },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
}));
