import { useState } from "react";
import { Pressable, Text } from "react-native";
import { linkDisplay } from "@/lib/bio-link";
import { ExternalLinkSheet } from "@/components/external-link-sheet";
import { LinkIcon } from "@/components/icons";
import { color, font, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// Le lien en bio d'un profil (lot « vie sociale », migration 0049) : sous la
// bio, une icône et le nom du site en clair (« exemple.com », suivi de « /… »
// quand le lien mène plus loin). Le toucher n'ouvre rien : il montre d'abord
// « Vous allez quitter Spotto » avec l'adresse complète. Pas de lien (ou un
// lien que la règle refuserait) : rien n'est affiché.

interface ProfileLinkProps {
  url: string | null | undefined;
  /** Centré (profil d'un autre membre) ou aligné à gauche (son propre profil). */
  align?: "center" | "start";
}

export function ProfileLink({ url, align = "center" }: ProfileLinkProps) {
  const [open, setOpen] = useState(false);
  const shown = linkDisplay(url);
  if (!shown) return null;
  return (
    <>
      <Pressable
        style={[styles.row, align === "start" ? styles.start : null]}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8 }}
        accessibilityRole="link"
        accessibilityLabel={t.profilePins.linkA11y(shown.host)}
        testID="lien-profil"
      >
        <LinkIcon size={14} tint={color.vert} />
        <Text style={styles.label} numberOfLines={1}>
          {shown.label}
        </Text>
      </Pressable>
      <ExternalLinkSheet url={open ? shown.href : null} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: space.xs, minHeight: 28, marginTop: space.xs, maxWidth: "100%" },
  start: { alignSelf: "flex-start" },
  label: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600", flexShrink: 1 },
}));
