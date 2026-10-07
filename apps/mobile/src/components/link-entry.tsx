import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ClipboardIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { detectLink, type LinkDetection } from "@/lib/link-detection";
import { beginFromLink, prepareErrorMessage } from "@/lib/spot-flow";
import { themedStyles } from "@/theme/themed-styles";

// Champ de lien du Spotter (Lot S) : analyse de l'image de couverture.
// DÉSACTIVÉ au lot 4 ter (voir lib/spot-flags.ts) ; gardé pour pouvoir le rétablir.

function DetectionCard({ detection }: { detection: LinkDetection }) {
  if (detection.kind === "supported") {
    return (
      <View style={styles.detected} accessibilityLiveRegion="polite">
        <View style={styles.platformChip}>
          <Text style={styles.platformChipLabel}>{t.spotter.platformName[detection.platform]}</Text>
        </View>
        <Text style={styles.detectedLabel}>{t.spotter.detected[detection.platform]}</Text>
      </View>
    );
  }
  if (detection.kind === "unsupported") return <ErrorMessage style={styles.feedback}>{t.spotter.unsupportedLink}</ErrorMessage>;
  if (detection.kind === "not_a_link") return <ErrorMessage style={styles.feedback}>{t.spotter.notALink}</ErrorMessage>;
  if (detection.kind === "not_a_video") return <ErrorMessage style={styles.feedback}>{t.spotter.notAVideo[detection.platform]}</ErrorMessage>;
  return null;
}

export function LinkEntry() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detection = detectLink(link);
  const canContinue = detection.kind === "supported" && !busy;

  async function handlePaste() {
    setMessage(null);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || detectLink(text).kind === "not_a_link") {
        setMessage(t.spotter.pasteEmpty);
        return;
      }
      setLink(text.trim());
    } catch {
      // Web : le navigateur a refusé la lecture du presse-papiers.
      setMessage(t.spotter.pasteDenied);
    }
  }

  async function handleContinue() {
    if (detection.kind !== "supported") return;
    setMessage(null);
    setBusy(true);
    try {
      const draft = await beginFromLink(detection.url, detection.platform);
      router.push({ pathname: "/spot/apercu", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      setMessage(prepareErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text style={styles.label}>{t.spotter.linkLabel}</Text>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={link}
          onChangeText={(text) => {
            setLink(text);
            setMessage(null);
          }}
          placeholder={t.spotter.linkPlaceholder}
          placeholderTextColor={color.acier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleContinue}
          accessibilityLabel={t.spotter.linkLabel}
        />
        <Pressable onPress={handlePaste} hitSlop={10} style={styles.pasteButton} accessibilityRole="button">
          <ClipboardIcon size={16} tint={color.vert} />
          <Text style={styles.pasteLabel}>{t.spotter.paste}</Text>
        </Pressable>
      </View>
      <DetectionCard detection={detection} />
      {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}
      <Pressable style={[styles.primary, !canContinue ? styles.primaryDisabled : null]} onPress={handleContinue} disabled={!canContinue} accessibilityRole="button">
        {busy ? <ActivityIndicator color={color.blanc} /> : null}
        <Text style={[styles.primaryLabel, !canContinue ? styles.primaryLabelDisabled : null]}>{busy ? t.spotter.preparing : t.spotter.continue}</Text>
      </Pressable>
    </>
  );
}

const styles = themedStyles(() => ({
  label: { fontSize: font.caption, color: color.acier, marginTop: space.xl },
  field: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.filet, gap: space.sm },
  input: { flex: 1, fontSize: font.body, color: color.encre, paddingVertical: 12 },
  pasteButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
  pasteLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  detected: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  platformChip: { backgroundColor: color.encre, borderRadius: radius.full, paddingHorizontal: 11, height: 26, justifyContent: "center" },
  platformChipLabel: { color: color.blanc, fontSize: font.caption, fontWeight: "600" },
  detectedLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  feedback: { fontSize: font.caption, marginTop: space.sm, lineHeight: 18 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  primaryLabelDisabled: { color: color.surInactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
