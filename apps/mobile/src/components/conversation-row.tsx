import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type { ConversationSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { timeAgo } from "@/lib/format";
import { conversationPreview } from "@/lib/conversations";
import { PersonIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// Une conversation dans la liste des messages (lot messages) : l'autre
// membre, le dernier message, sa date et une pastille quand il n'est pas lu.
export function ConversationRow({ summary, onPress, label }: { summary: ConversationSummary; onPress: () => void; label?: string }) {
  const preview = conversationPreview(summary);
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label ?? t.messages.rowLabel(summary.other.displayName, preview, summary.unread)}
      testID={`conversation-${summary.id}`}
    >
      <View style={styles.avatar}>
        {summary.other.avatarUrl ? (
          <Image source={{ uri: summary.other.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <PersonIcon size={20} tint={color.acier} />
        )}
      </View>
      <View style={styles.text}>
        <View style={styles.topLine}>
          <Text style={[styles.name, summary.unread ? styles.nameUnread : null]} numberOfLines={1}>
            {summary.other.displayName}
          </Text>
          <Text style={styles.time}>{timeAgo(summary.lastMessageAt, getActiveLocale())}</Text>
        </View>
        <Text style={[styles.preview, summary.unread ? styles.previewUnread : null]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {summary.unread ? <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no" /> : null}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, minHeight: 60 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 2 },
  topLine: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  name: { flex: 1, fontSize: font.secondary, fontWeight: "500", color: color.encre },
  nameUnread: { fontWeight: "700" },
  time: { fontSize: font.caption, color: color.acier },
  preview: { fontSize: font.secondary, color: color.acier },
  previewUnread: { color: color.encre, fontWeight: "600" },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: color.vert },
}));
