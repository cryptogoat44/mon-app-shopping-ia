import { Pressable, Text, View } from "react-native";
import type { WishAlertNews } from "@monapp/shared-types";
import { getActiveLocale, t } from "@/i18n";
import { newsLine } from "@/lib/wish-alert-news";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Lot « alertes visibles » : le bandeau « 2 nouveautés » en tête de vos
// Envies. Chaque ligne dit le prix vu, son jour et sa boutique ; la toucher
// ouvre l'Envie. Texte libre de passer à la ligne (petits écrans, grand
// texte) ; « Masquer » le retire tout de suite. Rien sans nouveauté.
export function WishAlertNewsBanner({ items, onOpen, onHide }: { items: readonly WishAlertNews[]; onOpen: (item: WishAlertNews) => void; onHide: () => void }) {
  if (items.length === 0) return null;
  const locale = getActiveLocale();
  return (
    <View style={styles.wrap}>
      <View style={styles.box} testID="bandeau-nouveautes">
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {t.wishAlerts.newsTitle(items.length)}
          </Text>
          <Pressable onPress={onHide} hitSlop={10} style={styles.hide} accessibilityRole="button" accessibilityLabel={t.wishAlerts.newsHideLabel} testID="masquer-nouveautes">
            <Text style={styles.hideLabel}>{t.wishAlerts.newsHide}</Text>
          </Pressable>
        </View>
        <Text style={styles.source}>{t.wishAlerts.newsSource}</Text>
        {items.map((item) => {
          const line = newsLine(item, locale);
          return (
            <Pressable
              key={item.id}
              onPress={() => onOpen(item)}
              style={styles.line}
              accessibilityRole="link"
              accessibilityLabel={line}
              accessibilityHint={t.wishAlerts.newsOpenHint}
              testID="ligne-nouveaute"
            >
              <Text style={styles.lineText}>{line}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  wrap: { maxWidth: 640, alignSelf: "center", width: "100%", paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs },
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, backgroundColor: color.plinthe },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, fontWeight: "600", color: color.encre },
  hide: { minHeight: 44, justifyContent: "center" },
  hideLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600" },
  source: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginBottom: space.xs },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.filet },
  lineText: { flex: 1, flexShrink: 1, fontSize: font.caption, color: color.encre, lineHeight: 18 },
  chevron: { fontSize: 20, color: color.acier },
}));
