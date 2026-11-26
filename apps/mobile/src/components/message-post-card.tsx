import { Pressable, Text, View } from "react-native";
import type { MessagePostCard as PostCard } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { Avatar } from "@/components/avatar";
import { ImageUnavailable } from "@/components/image-unavailable";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Publication envoyée dans un message (lot « messages, plus de confort »).
// Le serveur la relit pour vous à chaque affichage : si vous n'avez pas (ou
// plus) le droit de la voir, si elle a été supprimée ou masquée, ou si vous
// l'avez signalée, il ne transmet rien d'elle et la carte dit seulement
// « Publication indisponible ». Sinon : son auteur, sa miniature, le début
// de sa légende ; la toucher ouvre la publication.
export function MessagePostCard({ card, onOpen }: { card: PostCard; onOpen: (postId: string) => void }) {
  if (!card.available) {
    return (
      <View style={[styles.card, styles.unavailable]} testID="carte-publication-indisponible">
        <Text style={styles.unavailableText}>{t.messageActions.postUnavailable}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpen(card.id)}
      style={styles.card}
      testID="carte-publication"
      accessibilityRole="link"
      accessibilityLabel={t.messageActions.openPost(card.author.displayName)}
    >
      <View style={styles.author}>
        <Avatar uri={card.author.avatarUrl} userId={card.author.id} displayName={card.author.displayName} username={card.author.username} size={24} />
        <Text style={styles.authorName} numberOfLines={1}>
          {card.author.displayName}
        </Text>
      </View>
      <View style={styles.image}>
        {card.thumbUrl ? <SpotImage hdUri={null} fallbackUri={card.thumbUrl} style={styles.fill} fit="cover" size="small" /> : <ImageUnavailable variant="thumb" />}
      </View>
      {card.caption ? (
        <Text style={styles.caption} numberOfLines={2}>
          {card.caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  card: { width: 220, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.filet, overflow: "hidden" },
  unavailable: { paddingHorizontal: space.sm, paddingVertical: space.md, alignItems: "center" },
  unavailableText: { fontSize: font.secondary, color: color.acier, fontStyle: "italic" },
  author: { flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.xs },
  authorName: { flex: 1, fontSize: font.caption, fontWeight: "600", color: color.encre },
  image: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.pieceGrid, borderCurve: "continuous", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  caption: { padding: space.sm, fontSize: font.secondary, color: color.encre, lineHeight: 19 },
}));
