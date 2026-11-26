import { useEffect, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { VIDEO_AI } from "@monapp/shared-types";
import { color, font, getActiveScheme, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { CameraIcon, ChevronIcon, TakePhotoIcon, VideoIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { LinkNotice } from "@/components/link-notice";
import { QueryInput } from "@/components/spot-launch-views";
import { containsLink } from "@/lib/link-detection";
import type { LatestVideo, LatestVideoChoice } from "@/lib/latest-video-state";
import { formatClock, videoRejection } from "@/lib/video-timeline";
import { themedStyles } from "@/theme/themed-styles";

// Entrées du Spotter (lot 4 ter) : une vidéo ou une photo, d'égale importance,
// et sur l'app iPhone, en option, la dernière vidéo de la galerie, prête à
// être analysée (lib/latest-video-state.ts).

/** Lot « fidélité aux maquettes » : libellé visible court (`label`), phrase
 * entière lue par VoiceOver (`accessibilityLabel`), qui COMMENCE par le
 * libellé visible (Commande vocale d'iOS agit sur le nom lu : « Toucher
 * Photo ») : « Vidéo, Ajouter une vidéo », « Photo, Ajouter une photo »,
 * « Appareil photo, Prendre une photo ». */
function Tile({
  icon,
  label,
  accessibilityLabel,
  onPress,
  busy,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <Pressable style={styles.tile} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ busy, disabled }}>
      {busy ? <ActivityIndicator color={color.vert} /> : icon}
      {/* Aucune limite de lignes : au grand texte, le libellé passe à la ligne et la tuile grandit (minHeight). */}
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

/** Entrées égales, côte à côte : vidéo et photo ; sur l'app iPhone, aussi
 * l'appareil photo, à côté de l'import (lot « app iPhone prête »).
 * `videoLabel` : la phrase lue de la tuile vidéo (« Ajouter une vidéo » ou
 * « Choisir une autre vidéo ») ; le libellé visible est « Vidéo ». */
export function EntryTiles({
  videoLabel,
  onVideo,
  onPhoto,
  onCamera,
  busy,
}: {
  videoLabel: string;
  onVideo: () => void;
  onPhoto: () => void;
  /** Absent : pas d'appareil photo proposé (site). */
  onCamera?: () => void;
  busy: "video" | "photo" | "camera" | "latest" | null;
}) {
  return (
    <View style={styles.tiles}>
      <Tile
        icon={<VideoIcon size={24} tint={color.vert} />}
        label={t.spotter.tileVideo}
        accessibilityLabel={`${t.spotter.tileVideo}, ${videoLabel}`}
        onPress={onVideo}
        busy={busy === "video"}
        disabled={busy !== null}
      />
      <Tile
        icon={<CameraIcon size={24} tint={color.vert} />}
        label={t.spotter.tilePhoto}
        accessibilityLabel={`${t.spotter.tilePhoto}, ${t.spotter.addPhoto}`}
        onPress={onPhoto}
        busy={busy === "photo"}
        disabled={busy !== null}
      />
      {onCamera ? (
        <Tile
          icon={<TakePhotoIcon size={24} tint={color.vert} />}
          label={t.spotter.tileCamera}
          accessibilityLabel={`${t.spotter.tileCamera}, ${t.cameraCapture.takePhoto}`}
          onPress={onCamera}
          busy={busy === "camera"}
          disabled={busy !== null}
        />
      ) : null}
    </View>
  );
}

/** Dernière vidéo de la galerie (app iPhone) : il ne reste qu'à taper
 * quelques mots et « Lancer ». Trop longue : on le dit tout de suite.
 * Retours du build 2 : la ligne (vignette, « Votre dernière vidéo · 0:27 »)
 * déplie le champ des mots et « Rechercher ».
 * Retours du build 3, point 3 (« pouvoir la réduire au lieu de la
 * supprimer ») : plus de croix. Le chevron réduit la carte en une ligne fine
 * (petite vignette, titre, « Rouvrir » souligné) ; toucher la ligne la rouvre.
 * La forme est retenue sur l'appareil, par compte ; éteindre la proposition
 * (et la lecture de la galerie) ne se fait plus que dans Réglages. */
export function LatestVideoCard({
  video,
  query,
  onQuery,
  onLaunch,
  onAddVideo,
  busy,
  expanded,
  onToggle,
  reduced,
  onReduce,
  onReveal,
}: {
  video: LatestVideo;
  query: string;
  onQuery: (value: string) => void;
  onLaunch: () => void;
  onAddVideo: () => void;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Repliée en une ligne fine (préférence retenue sur l'appareil). */
  reduced: boolean;
  onReduce: () => void;
  onReveal: () => void;
}) {
  const duration = video.durationMs === null ? null : formatClock(video.durationMs);
  const tooLong = videoRejection({ durationMs: video.durationMs, sizeBytes: null }) === "too_long";
  const linkInQuery = containsLink(query);
  const valid = query.trim().length >= VIDEO_AI.queryMinLength && !linkInQuery;
  const title = duration ? `${t.spotter.latestVideo} · ${duration}` : t.spotter.latestVideo;
  // Trop longue : rien à déplier, la phrase qui le dit tient lieu de geste.
  const canExpand = !(tooLong && video.durationMs !== null);
  const open = expanded && canExpand;
  if (reduced) {
    // Une seule ligne, toute touchable ; « Rouvrir », son seul geste visible, est
    // aussi dans son nom (Commande vocale : « Toucher Rouvrir »).
    return (
      <Pressable
        style={styles.slim}
        onPress={onReveal}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${t.spotter.latestVideoShow}`}
        accessibilityHint={t.spotter.latestVideoReveal}
        accessibilityState={{ expanded: false }}
      >
        <Image source={{ uri: video.id }} style={styles.slimThumb} contentFit="cover" accessible={false} />
        <Text style={styles.slimLabel} numberOfLines={1}>
          <Text style={styles.slimTitle}>{t.spotter.latestVideo}</Text>
          {duration ? <Text style={styles.slimDuration}>{` · ${duration}`}</Text> : null}
        </Text>
        <Text style={styles.slimLink}>{t.spotter.latestVideoShow}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable
          style={styles.cardRow}
          onPress={onToggle}
          disabled={!canExpand}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={canExpand ? t.spotter.latestVideoExpand : undefined}
          accessibilityState={{ expanded: open, disabled: !canExpand }}
        >
          <Image source={{ uri: video.id }} style={styles.thumb} contentFit="cover" accessible={false} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {title}
            </Text>
            {canExpand && !open ? <Text style={styles.cardMeta}>{t.spotter.latestVideoExpand} ›</Text> : null}
          </View>
        </Pressable>
        <Pressable onPress={onReduce} style={styles.reduce} accessibilityRole="button" accessibilityLabel={t.spotter.latestVideoReduce}>
          <ChevronIcon direction="up" size={18} tint={color.acier} />
        </Pressable>
      </View>
      {!canExpand && video.durationMs !== null ? <Text style={styles.cardNote}>{t.video.tooLong(formatClock(video.durationMs))}</Text> : null}
      {open ? (
        <>
          <QueryInput value={query} onChangeText={onQuery} onSubmit={() => valid && !busy && onLaunch()} testID="latest-query" style={styles.input} />
          {linkInQuery ? <LinkNotice style={styles.notice} onAddVideo={onAddVideo} link={query} /> : null}
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
      ) : null}
    </View>
  );
}

/** Question posée une fois (app iPhone). Deux réponses de même poids :
 * « Non merci » ne change rien d'autre, le sélecteur reste le parcours par défaut. */
export function LatestVideoQuestion({ onAnswer, saving, failed }: { onAnswer: (choice: LatestVideoChoice) => void; saving: boolean; failed: boolean }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {t.spotter.latestVideoAsk}
      </Text>
      <Text style={styles.askBody}>{t.spotter.latestVideoAskBody}</Text>
      {failed ? <ErrorMessage style={styles.notice}>{t.spotter.latestVideoChoiceFailed}</ErrorMessage> : null}
      <View style={styles.answers}>
        <Pressable style={styles.answer} onPress={() => onAnswer("yes")} disabled={saving} accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}>
          {saving ? <ActivityIndicator color={color.vert} /> : null}
          <Text style={styles.answerLabel}>{t.spotter.latestVideoYes}</Text>
        </Pressable>
        <Pressable style={styles.answer} onPress={() => onAnswer("no")} disabled={saving} accessibilityRole="button" accessibilityState={{ disabled: saving }}>
          <Text style={styles.answerLabel}>{t.spotter.latestVideoNo}</Text>
        </Pressable>
      </View>
      <Text style={styles.askNote}>{t.spotter.latestVideoAskNote}</Text>
    </View>
  );
}

/** Juste après un « oui » sans accès complet (ou sans vidéo) : on dit pourquoi rien n'apparaît. */
export function LatestVideoNote({ message }: { message: string }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return (
    <Text style={styles.cardNote} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = themedStyles(() => ({
  tiles: { flexDirection: "row", gap: space.sm, marginTop: 12 },
  // Tuiles pleines de la maquette « Écrin » (lot « fidélité aux maquettes ») : minHeight, jamais height (grand texte).
  tile: {
    flex: 1,
    minHeight: 76,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: color.surface,
    borderWidth: getActiveScheme() === "light" ? 1 : 0,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: 12,
    paddingHorizontal: space.xs,
  },
  tileLabel: { fontSize: font.caption, lineHeight: 16, fontWeight: "500", color: color.encre, textAlign: "center" },
  card: { marginTop: space.lg, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64 },
  thumb: { width: 48, height: 64, borderRadius: radius.pieceThumb, borderCurve: "continuous", backgroundColor: color.plinthe, overflow: "hidden" },
  reduce: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // Carte repliée (retours du build 3, point 3 ; maquette « Écrin » 1-accueil) : une ligne fine de 44 pt.
  slim: {
    marginTop: space.sm,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingLeft: space.xs + 2,
    paddingRight: 12,
    paddingVertical: space.xs,
  },
  slimThumb: { width: 32, height: 32, borderRadius: radius.pieceThumb, borderCurve: "continuous", backgroundColor: color.plinthe, overflow: "hidden" },
  slimLabel: { flex: 1, fontSize: font.secondary, color: color.encre, fontVariant: ["tabular-nums"] },
  // Deux textes : « Votre dernière vidéo » en 500, puis « · 0:27 » en acier (jamais de « @pseudo » : une vidéo de la galerie n'a pas d'auteur).
  slimTitle: { fontWeight: "500" },
  slimDuration: { color: color.acier },
  slimLink: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "400" },
  cardText: { flex: 1 },
  cardTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, lineHeight: serifLineHeight.body, color: color.encre },
  cardMeta: { fontSize: font.caption, color: color.acier, marginTop: 4, fontVariant: ["tabular-nums"] },
  cardNote: { fontSize: font.secondary, color: color.acier, marginTop: space.md, lineHeight: 21 },
  input: { marginTop: space.md },
  notice: { marginTop: space.md },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.md },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  askBody: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 21 },
  answers: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  answer: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.sm,
  },
  answerLabel: { color: color.encre, fontSize: font.secondary, fontWeight: "600", textAlign: "center" },
  askNote: { fontSize: font.caption, color: color.acier, marginTop: space.sm, lineHeight: 18 },
}));
