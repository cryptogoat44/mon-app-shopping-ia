// « Pièces déjà repérées dans cette vidéo » (mission « liens vidéo ») : la
// mémoire collective, telle que le serveur la rend (triée par confirmations,
// puis apparitions, puis récence — jamais par commission), sans jamais dire
// qui a trouvé quoi. Chaque carte : image, nom, prix, boutique, « Voir chez
// <boutique> » (bouton marchand habituel, mention « Lien affilié » comprise)
// et « C'est bien cette pièce ».
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { VideoProduct } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { confirmVideoProduct } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { ErrorMessage } from "@/components/error-message";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

function ProductCard({ product, videoUrl }: { product: VideoProduct; videoUrl: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">(product.confirmedByMe ? "done" : "idle");
  const price = product.priceMin !== null ? formatPrice(product.priceMin, product.currency, getActiveLocale()) : null;
  const details = [product.brand, price, product.merchantName].filter(Boolean).join(" · ");

  async function confirm() {
    setState("sending");
    try {
      await confirmVideoProduct({ url: videoUrl, productKey: product.productKey });
      setState("done");
    } catch {
      setState("failed");
    }
  }

  const done = state === "done";
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.thumb}>
          <SpotImage fallbackUri={product.imageUrl} style={styles.fill} fit="cover" size="small" accessibilityLabel={product.productName} />
        </View>
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={2}>
            {product.productName}
          </Text>
          {details ? <Text style={styles.details}>{details}</Text> : null}
        </View>
      </View>
      <MerchantLinkButton url={product.merchantUrl} merchantName={product.merchantName} matchId={null} context="result" isAffiliate={product.isAffiliate} />
      <Pressable
        style={[styles.confirm, done ? styles.confirmDone : null]}
        onPress={() => void confirm()}
        disabled={done || state === "sending"}
        accessibilityRole="button"
        accessibilityState={{ disabled: done || state === "sending" }}
      >
        <Text style={[styles.confirmLabel, done ? styles.confirmDoneLabel : null]}>{done ? t.videoLink.thanks : t.videoLink.confirm}</Text>
      </Pressable>
      {state === "failed" ? <ErrorMessage style={styles.error}>{t.videoLink.confirmFailed}</ErrorMessage> : null}
    </View>
  );
}

/** La liste, ou rien. `showEmpty` : vidéo encore inconnue, une phrase discrète invite à la spotter la première. */
export function VideoProducts({ products, videoUrl, showEmpty }: { products: readonly VideoProduct[]; videoUrl: string; showEmpty: boolean }) {
  if (products.length === 0) return showEmpty ? <Text style={styles.empty}>{t.videoLink.firstToSpot}</Text> : null;
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLink.productsTitle}
      </Text>
      {products.map((product) => (
        <ProductCard key={product.productKey} product={product} videoUrl={videoUrl} />
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { gap: space.md, alignSelf: "stretch", marginTop: space.lg },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  card: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", gap: space.md, alignItems: "center" },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  text: { flex: 1, gap: 4 },
  name: { fontSize: font.secondary, color: color.encre, fontWeight: "600", lineHeight: 19 },
  details: { fontSize: font.caption, color: color.acier, lineHeight: 17 },
  confirm: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  confirmDone: { opacity: 0.7 },
  confirmLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
  confirmDoneLabel: { color: color.acier, textDecorationLine: "none" },
  error: { fontSize: font.caption, lineHeight: 18 },
  empty: { fontSize: font.caption, color: color.acier, lineHeight: 18, textAlign: "center", marginTop: space.lg, alignSelf: "stretch" },
}));
