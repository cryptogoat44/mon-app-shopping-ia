// « Entourez la pièce » (mission « liens vidéo ») : la recherche est associée
// à une vidéo TikTok ou Instagram (lecteur, ou lien en attente) ; une croix
// l'en détache (le spot ne sera pas noté, le lien en attente est oublié).
// Dessous, une phrase dit ce que l'association fait (revue de sécurité) : les
// pièces trouvées seront ajoutées, sans le nom de la personne, aux pièces
// repérées de cette vidéo, que d'autres membres peuvent voir.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { LinkIcon } from "@/components/icons";
import { detachVideoFromDraft, draftVideo } from "@/lib/video-context";
import { themedStyles } from "@/theme/themed-styles";

export function VideoContextLabel() {
  const [video, setVideo] = useState(draftVideo);
  if (!video) return null;
  const name = t.spotter.platformName[video.platform];
  const label = video.creatorHandle ? t.videoLink.attached(video.creatorHandle) : t.videoLink.attachedPlatform(name);
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <LinkIcon size={14} tint={color.acier} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Pressable
          onPress={() => {
            setVideo(null);
            void detachVideoFromDraft();
          }}
          hitSlop={12}
          style={styles.cross}
          accessibilityRole="button"
          accessibilityLabel={t.videoLink.detach}
        >
          <Text style={styles.crossLabel}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>{t.videoLink.sharedAnonymously}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  block: { marginBottom: space.md, gap: space.xs },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.full,
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: 36,
    maxWidth: "100%",
  },
  label: { fontSize: font.caption, color: color.encre, flexShrink: 1 },
  cross: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
  crossLabel: { fontSize: 20, color: color.acier, lineHeight: 22 },
}));
