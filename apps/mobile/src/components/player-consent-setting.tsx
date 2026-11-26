// Réglages (lot « lecteur intégré », app iPhone) : l'accord donné avant de
// lire une vidéo dans le lecteur officiel de TikTok ou d'Instagram, qui peut
// déposer ses propres traceurs, se retire ici (contre-expertise n° 5). Rien ne
// s'affiche sur le site, ni tant que le lecteur est coupé. Sans accord : rien
// non plus avec l'écran d'accord d'avant ; avec le bouton Lecture qui vaut
// accord (retours du build 3), le titre et la règle, sans bouton.
import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { isPlayerAvailable, readPlayerConsent, withdrawPlayerConsent } from "@/lib/player-access";
import { PLAYER_CONSENT_BY_PLAY_BUTTON, PLAYER_CONSENT_GATE } from "@/lib/spot-flags";
import { themedStyles } from "@/theme/themed-styles";

export function PlayerConsentSetting() {
  // « loading » : rien tant que l'accord n'est pas lu (pas de phrase « sans accord » qui clignote).
  const [state, setState] = useState<"loading" | "none" | "given" | "withdrawn">("loading");
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

  // Le bouton Lecture vaut accord : la phrase sous le lecteur renvoie ici (« Modifiable dans Réglages »),
  // la section s'affiche donc aussi sans accord, avec la règle seulement.
  const playIsConsent = PLAYER_CONSENT_GATE && PLAYER_CONSENT_BY_PLAY_BUTTON;
  if (!isPlayerAvailable() || state === "loading" || (state === "none" && !playIsConsent)) return null;
  const body =
    state === "given" ? t.player.settings.on : state === "none" ? t.player.settings.none : PLAYER_CONSENT_BY_PLAY_BUTTON ? t.player.settings.withdrawnPlay : t.player.settings.withdrawn;
  return (
    <>
      <Text style={styles.title}>{t.player.settings.title}</Text>
      <Text style={styles.body}>{body}</Text>
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
  linkLabel: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
