import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { POLICY_UPDATE_NOTICE } from "@monapp/shared-types";
import { fetchConsentStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { parseSeenNotices, seenNoticesKey, shouldShowNotice } from "@/lib/policy-notice";
import { fr } from "@/i18n/fr";
import { color, font, radius, space } from "@/theme/tokens";

// Court message d'information après une mise à jour de la politique qui ne
// demande pas de nouvelle acceptation (2026-09-29 : serveur en Europe).
// Montré une seule fois par compte et par appareil. Une lecture impossible
// (réseau, stockage) n'affiche simplement rien : l'information reste
// disponible dans la politique elle-même, et sera proposée au lancement
// suivant.
export function PolicyUpdateNotice() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [statuses, raw] = await Promise.all([fetchConsentStatus(), AsyncStorage.getItem(seenNoticesKey(userId))]);
        if (!cancelled && shouldShowNotice(statuses, parseSeenNotices(raw), POLICY_UPDATE_NOTICE)) setVisible(true);
      } catch {
        // Voir plus haut : rien à afficher cette fois-ci.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (visible && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(fr.legal.updateNotice);
  }, [visible]);

  async function markSeen() {
    setVisible(false);
    if (!userId) return;
    try {
      const key = seenNoticesKey(userId);
      const seen = parseSeenNotices(await AsyncStorage.getItem(key));
      await AsyncStorage.setItem(key, JSON.stringify([...new Set([...seen, POLICY_UPDATE_NOTICE.id])]));
    } catch {
      // Stockage indisponible : l'information pourra réapparaître une fois.
    }
  }

  if (!visible) return null;
  return (
    // Conteneur pleine largeur (positionné) + carte centrée dedans : un
    // élément positionné ignore « alignSelf », d'où le calage à gauche sur
    // écran large (corrigé au lot 2).
    <View style={[styles.wrapper, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.text}>{fr.legal.updateNotice}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="link"
            hitSlop={12}
            style={styles.action}
            onPress={() => {
              markSeen();
              router.push("/confidentialite");
            }}
          >
            <Text style={styles.link}>{fr.legal.updateNoticeRead}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={fr.legal.updateNoticeDismissLabel} hitSlop={12} style={styles.action} onPress={markSeen}>
            <Text style={styles.dismiss}>{fr.legal.updateNoticeDismiss}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// En bas, au-dessus de la barre d'onglets : en haut, le bandeau masquerait
// le bouton « Retour » des écrans tant qu'il n'est pas fermé.
const TAB_BAR_CLEARANCE = 72;

const styles = StyleSheet.create({
  wrapper: { position: "absolute", left: space.md, right: space.md, alignItems: "center", zIndex: 10 },
  banner: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: color.blanc,
    borderColor: color.filet,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    shadowColor: color.encre,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  text: { fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.lg, marginTop: space.sm },
  action: { minHeight: 44, justifyContent: "center" },
  link: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  dismiss: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
});
