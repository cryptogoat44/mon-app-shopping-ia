import { useState } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { color, getActiveScheme, radius } from "@/theme/tokens";
import { avatarColors, avatarInitials } from "@/lib/avatar-look";
import { PersonIcon } from "@/components/icons";

// Photo de profil, partout où une personne apparaît (profil, fil,
// commentaires, messages, conversations, collections, modération…). Sans
// photo, ou si elle ne se charge pas : ses initiales sur sa couleur (lot
// « profil et icône des réglages », lib/avatar-look.ts).
interface AvatarProps {
  uri: string | null | undefined;
  userId: string;
  displayName?: string | null;
  username?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
  /** Nom lu par VoiceOver. Sans lui, l'avatar est décoratif : le nom est écrit à côté. */
  accessibilityLabel?: string;
}

export function Avatar({ uri, userId, displayName, username, size, style, accessibilityLabel }: AvatarProps) {
  // Adresse qui n'a pas pu se charger : les initiales prennent le relais.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const frame: ViewStyle = { width: size, height: size, borderRadius: radius.full, overflow: "hidden", alignItems: "center", justifyContent: "center" };
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

  if (uri && failedUri !== uri) {
    return (
      <View style={[frame, { backgroundColor: color.plinthe }, style]} {...a11y}>
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" onError={() => setFailedUri(uri)} />
      </View>
    );
  }

  const initials = avatarInitials(displayName, username);
  const colors = avatarColors(userId, getActiveScheme());
  return (
    <View style={[frame, { backgroundColor: colors.background }, style]} {...a11y} testID="avatar-initiales">
      {initials ? (
        <Text
          style={{ color: colors.text, fontSize: Math.max(10, Math.round(size * 0.4)), fontWeight: "600", letterSpacing: 0.3 }}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {initials}
        </Text>
      ) : (
        <PersonIcon size={Math.round(size * 0.55)} tint={colors.text} />
      )}
    </View>
  );
}
