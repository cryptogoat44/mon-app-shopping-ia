import { Text, View } from "react-native";
import { color, font, radius } from "@/theme/tokens";
import { CheckIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

/** Une étape d'une attente (faite, en cours, à venir). « night » : sur le fond
 * sombre de l'identification ; « day » : sur le fond clair des autres écrans. */
export function StepRow({ label, state, tone }: { label: string; state: "done" | "now" | "next"; tone: "night" | "day" }) {
  const night = tone === "night";
  return (
    <View style={styles.stepRow} accessibilityState={{ busy: state === "now" }}>
      <View
        style={[
          styles.dot,
          state === "done" ? styles.dotDone : state === "now" ? (night ? styles.dotNowNight : styles.dotNowDay) : night ? styles.dotNextNight : styles.dotNextDay,
        ]}
      >
        {state === "done" ? (
          <CheckIcon size={11} tint={color.blanc} />
        ) : state === "now" ? (
          <View style={[styles.dotInner, night ? styles.dotInnerNight : styles.dotInnerDay]} />
        ) : null}
      </View>
      <Text style={[styles.stepLabel, night ? styles.labelNight : styles.labelDay, state === "next" ? (night ? styles.nextNight : styles.nextDay) : null]}>
        {label}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 32 },
  dot: { width: 20, height: 20, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: color.vert },
  dotNowNight: { borderWidth: 1.5, borderColor: color.surNuit },
  dotNowDay: { borderWidth: 1.5, borderColor: color.encre },
  dotNextNight: { borderWidth: 1.5, borderColor: color.nuitFilet },
  dotNextDay: { borderWidth: 1.5, borderColor: color.filet },
  dotInner: { width: 8, height: 8, borderRadius: radius.full },
  dotInnerNight: { backgroundColor: color.surNuit },
  dotInnerDay: { backgroundColor: color.encre },
  stepLabel: { fontSize: font.secondary },
  labelNight: { color: color.surNuit },
  labelDay: { color: color.encre },
  nextNight: { color: color.brume },
  nextDay: { color: color.acier },
}));
