import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { Piece } from "@/api/types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { VerifiedIcon } from "@/components/icons";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// Boutiques douteuses (lot « recherche confiance ») : la mention d'une offre,
// décidée par le serveur (apps/backend/src/lib/shopTrust.ts) — « Boutique
// officielle de la marque », « Boutique connue », ou « Prix inhabituellement bas », un constat, jamais une
// accusation. Discrète, sous la proposition ; touchée, une feuille d'une
// phrase dit ce que fait Spotto. Zone à part, jamais dans celle qui met la
// carte en grand (VoiceOver la lit juste après la carte). Sans mention
// (ancien serveur, offre ordinaire) : rien.

export function OfferMarkNote({ piece }: { piece: Pick<Piece, "offerMark"> }) {
  const [open, setOpen] = useState(false);
  const mark = piece.offerMark;
  if (!mark) return null;
  const label = t.result.offerMark[mark];
  const known = mark === "known_shop" || mark === "official_shop";
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // 32 points + 12 : la zone tactile minimale (44), sans mordre sur le lien de la boutique.
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        style={styles.note}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t.result.offerMark.hint}
        testID="mention-offre"
      >
        {known ? <VerifiedIcon size={12} tint={color.vert} /> : null}
        <Text style={known ? [styles.label, styles.known] : styles.label}>
          {label} <Text style={styles.more}>ⓘ</Text>
        </Text>
      </Pressable>
      {open ? <OfferMarkSheet title={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** La feuille d'une phrase : la mention touchée, ce que fait Spotto, « J'ai compris ». */
function OfferMarkSheet({ title, onClose }: { title: string; onClose: () => void }) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>{t.result.offerMark.explanation}</Text>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" testID="mention-offre-fermer">
          <Text style={styles.closeLabel}>{t.result.offerMark.close}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  note: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 32 },
  label: { fontSize: 12, color: color.acier, flexShrink: 1 },
  known: { color: color.vert, fontWeight: "600" },
  more: { fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm, textAlign: "center" },
  close: { marginTop: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  closeLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc },
}));
