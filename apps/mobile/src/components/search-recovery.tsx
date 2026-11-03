import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { FallbackView, type Action } from "@/components/spot-launch-views";
import { unsettledAction, type UnsettledState } from "@/lib/spot-recovery";
import { themedStyles } from "@/theme/themed-styles";

/** VoiceOver ignore les zones annoncées (Android seulement) : le changement
 * d'état est dit explicitement, à la suite de ce qu'il est en train de lire. */
function useAnnounce(message: string) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }, [message]);
}

function copyOf(state: UnsettledState): [string, string] {
  switch (state) {
    case "not_started":
      return [t.searchRecovery.notStartedTitle, t.searchRecovery.notStartedText];
    case "unreachable":
      return [t.searchRecovery.unreachableTitle, t.searchRecovery.unreachableText];
    case "still_running":
      return [t.searchRecovery.runningTitle, t.searchRecovery.stillRunningText];
  }
}

/** Recherche coupée dont l'issue reste inconnue (lib/spot-recovery.ts) : où
 * elle en est, puis « Relancer » (jamais partie : la même recherche, d'un
 * geste) ou « Vérifier à nouveau » (relecture gratuite), et `back`. Ton
 * calme, pas d'erreur en rouge : rien n'est perdu. */
export function SearchRecoveryView({ state, onRelaunch, onCheck, back }: { state: UnsettledState; onRelaunch: () => void; onCheck: () => void; back: Action }) {
  const [title, text] = copyOf(state);
  useAnnounce(`${title} ${text}`);
  const primary: Action =
    unsettledAction(state) === "relaunch" ? { label: t.searchRecovery.relaunch, onPress: onRelaunch } : { label: t.searchRecovery.checkAgain, onPress: onCheck };
  return (
    <View accessibilityLiveRegion="polite">
      <FallbackView title={title} text={text} failure={false} actions={[primary, back]} />
    </View>
  );
}

/** Après « Annuler » (photo) : la recherche a pu continuer côté serveur ;
 * relancée sans rien changer, elle est relue au lieu d'être repayée. */
export function CancelledNote() {
  useAnnounce(t.searchRecovery.cancelled);
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{t.searchRecovery.cancelled}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { backgroundColor: color.surface, borderColor: color.filet, borderWidth: 1, borderRadius: radius.sm, padding: space.md, marginTop: space.md },
  text: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
}));
