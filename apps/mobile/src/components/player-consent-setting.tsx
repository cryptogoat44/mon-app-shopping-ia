// Réglages (lot « lecteur intégré », app iPhone) : l'accord donné avant de
// lire une vidéo dans le lecteur officiel de TikTok ou d'Instagram, qui peut
// déposer ses propres traceurs, se retire ici (contre-expertise n° 5). Rien ne
// s'affiche sur le site, ni tant que le lecteur est coupé, ni sans accord.
import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { isPlayerAvailable, readPlayerConsent, withdrawPlayerConsent } from "@/lib/player-capture";
import { themedStyles } from "@/theme/themed-styles";

export function PlayerConsentSetting() {
  const [state, setState] = useState<"none" | "given" | "withdrawn">("none");
  useFocusEffect(
    useCallback(() => {
      if (!isPlayerAvailable()) return;
      void readPlayerConsent().then((consent) => setState((current) => (consent.tiktok || consent.instagram ? "given" : current === "withdrawn" ? current : "none")));
    }, [])
  );

  async function withdraw() {
    await withdrawPlayerConsent();
    setState("withdrawn");
  }

  if (!isPlayerAvailable() || state === "none") return null;
  return (
    <>
      <Text style={styles.title}>{t.player.settings.title}</Text>
      <Text style={styles.body}>{state === "given" ? t.player.settings.on : t.player.settings.withdrawn}</Text>
      {state === "given" ? (
        <Pressable onPress={() => void withdraw()} accessibilityRole="button" style={styles.link}>
          <Text style={styles.linkLabel}>{t.player.settings.withdraw}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  title: { fontSize: font.secondary, color: color.encre, fontWeight: "600", minHeight: 44, textAlignVertical: "center", paddingTop: space.sm },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
