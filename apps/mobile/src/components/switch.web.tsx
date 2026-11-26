import { useEffect, useRef } from "react";
import { Animated, Pressable, View, type ColorValue, type SwitchProps } from "react-native";
import { color } from "@/theme/tokens";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// Interrupteur du site (lot « fidélité aux maquettes », partie B) : la forme
// d'un interrupteur d'iPhone (piste de 51 × 31, curseur rond de 25), au lieu
// de la piste fine de react-native-web. Mêmes propriétés que le `Switch` de
// React Native, et mêmes couleurs : celles que donne `couleursInterrupteur`
// (piste allumée en accent, éteinte en filet ; curseur `blanc` du thème
// allumé, blanc éteint). Annoncé comme un interrupteur (rôle, aria-checked) ;
// une zone de 44 points ; le curseur glisse en 150 ms, sans animation si
// « Réduire les animations » est demandé.
const TRACK = { width: 51, height: 31 };
const THUMB = 25;
// Un filet de 1 pt fait le tour de la piste (allumée : de sa couleur ; éteinte : visible sur la carte) : le
// curseur, placé à l'intérieur du filet, est à 3 pt du bord extérieur (2 + 1), allumé comme éteint.
const BORDER = 1;
const OFF_LEFT = 2;
const ON_LEFT = TRACK.width - 2 * BORDER - THUMB - OFF_LEFT;

type WebSwitchProps = Pick<
  SwitchProps,
  "value" | "onValueChange" | "disabled" | "accessibilityLabel" | "accessibilityHint" | "testID" | "trackColor" | "thumbColor"
>;

export function Switch({ value = false, onValueChange, disabled = false, accessibilityLabel, accessibilityHint, testID, trackColor, thumbColor }: WebSwitchProps) {
  const reduceMotion = useReduceMotion();
  const left = useRef(new Animated.Value(value ? ON_LEFT : OFF_LEFT)).current;
  useEffect(() => {
    const to = value ? ON_LEFT : OFF_LEFT;
    if (reduceMotion) left.setValue(to);
    else Animated.timing(left, { toValue: to, duration: 150, useNativeDriver: false }).start();
  }, [value, reduceMotion, left]);
  const track: ColorValue = (value ? trackColor?.true : trackColor?.false) ?? (value ? color.vert : color.filet);
  return (
    <Pressable
      onPress={() => onValueChange?.(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[styles.zone, disabled ? styles.disabled : null]}
    >
      <View style={[styles.track, { backgroundColor: track, borderColor: value ? track : color.nuitFilet }]}>
        <Animated.View style={[styles.thumb, { left, backgroundColor: thumbColor ?? color.surImage }]} />
      </View>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  zone: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  disabled: { opacity: 0.5 },
  track: { width: TRACK.width, height: TRACK.height, borderRadius: 16, borderWidth: BORDER },
  thumb: { position: "absolute", top: 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
}));
