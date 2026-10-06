import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { prepareErrorMessage } from "@/lib/spot-flow";
import { getSpotVideo } from "@/lib/spot-video";
import { useVideoImport } from "@/lib/use-video-import";
import { lastTriedMoment, prepareMoment, remainingMoments } from "@/lib/video-auto";
import { VideoIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

/** Sous un résultat (lot 4, temps 1 bis). Vidéo encore ouverte : essayer un
 * autre des moments proposés par l'IA (chaque essai est un clic, donc une
 * identification consentie) ou choisir l'image soi-même. Recherche par un
 * lien : la pièce n'est peut-être pas sur la couverture — ajouter la vidéo.
 * `afterFailure` : sous une recherche sans résultat ou qui n'a pas abouti,
 * aucune pièce n'est affichée — le titre ne parle donc pas de « bonne pièce ». */
export function VideoAlternatives({
  sourceUrl,
  query,
  onMessage,
  afterFailure = false,
}: {
  sourceUrl: string | null;
  query: string;
  onMessage: (message: string | null) => void;
  afterFailure?: boolean;
}) {
  const router = useRouter();
  const video = getSpotVideo();
  const remaining = remainingMoments(video);
  const [preparing, setPreparing] = useState(false);
  const { importing, importVideo } = useVideoImport(onMessage);

  async function tryAnother() {
    const rank = remaining[0];
    if (!video || rank === undefined) return;
    onMessage(null);
    setPreparing(true);
    try {
      const draft = await prepareMoment(video, rank);
      router.replace({ pathname: "/spot/analysis", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      onMessage(prepareErrorMessage(error));
    } finally {
      setPreparing(false);
    }
  }

  function chooseMyself() {
    const start = lastTriedMoment(video);
    router.push({ pathname: "/spot/video", params: start === null ? {} : { start: String(start) } });
  }

  if (video) {
    return (
      <View style={styles.block}>
        <Text style={styles.title} accessibilityRole="header">
          {afterFailure ? t.videoAuto.otherMomentsTitle : t.videoAuto.otherTitle}
        </Text>
        {remaining.length > 0 ? (
          <Pressable style={styles.secondary} onPress={() => void tryAnother()} disabled={preparing} accessibilityRole="button">
            {preparing ? <ActivityIndicator color={color.encre} /> : null}
            <Text style={styles.secondaryLabel}>{t.videoAuto.tryAnother(remaining.length)}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={() => chooseMyself()} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{t.videoAuto.chooseMyself}</Text>
        </Pressable>
      </View>
    );
  }

  if (!sourceUrl) return null;
  return (
    <View style={styles.block}>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoAuto.addVideoTitle}
      </Text>
      <Pressable style={styles.secondary} onPress={() => void importVideo(query.trim() || undefined)} disabled={importing} accessibilityRole="button">
        {importing ? <ActivityIndicator color={color.encre} /> : <VideoIcon size={18} tint={color.encre} />}
        <Text style={styles.secondaryLabel}>{t.videoAuto.addVideo}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  block: { marginTop: space.xl, borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  secondary: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 52,
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
  },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
