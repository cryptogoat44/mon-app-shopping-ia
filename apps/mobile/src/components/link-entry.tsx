import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { color, font, getActiveScheme, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ClipboardIcon, LinkIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { detectLink, type LinkDetection } from "@/lib/link-detection";
import { linkRefusal, linkStep } from "@/lib/link-step";
import { useLinkEntry } from "@/lib/use-link-entry";
import { themedStyles } from "@/theme/themed-styles";

// Champ de lien du Spotter (mission « liens vidéo »), sur l'app iPhone comme
// sur le site : un lien TikTok ou Instagram ouvre l'écran « vidéo partagée ».
// Le bouton passe par la même fonction qu'un lien partagé (lib/use-link-entry.ts).
// Retours du build 2 : le champ est toujours affiché sur l'accueil (plus de
// question à déplier). Vide, il tient sur une ligne (libellé, champ, « Coller ») :
// la pastille et « Ouvrir la vidéo » n'apparaissent qu'une fois le champ rempli.
// « Coller » sur un lien de vidéo TikTok ou Instagram l'ouvre tout de suite
// (un geste) ; un lien tapé garde le bouton et la touche « Aller ». Sur l'app,
// plus de ligne d'aide qui promettrait le lecteur : selon le serveur, l'écran
// suivant montre le lecteur, la recherche automatique ou la capture d'écran.
// Le presse-papiers n'est lu qu'au toucher de « Coller », jamais de lui-même.

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
  const refusal = linkRefusal(detection);
  return refusal ? <ErrorMessage style={styles.feedback}>{refusal}</ErrorMessage> : null;
}

/** `onHelp` : le lien ne peut pas être lu — le Spotter montre l'aide « capture d'écran d'abord ». */
export function LinkEntry({ onHelp }: { onHelp: () => void }) {
  const label = t.player.linkLabel;
  const openLink = useLinkEntry();
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Posé dès le toucher (avant la lecture du presse-papiers) : un double toucher n'ouvre la vidéo qu'une fois.
  const opening = useRef(false);
  const detection = detectLink(link);
  const canContinue = detection.kind === "supported" && !busy;

  async function handlePaste() {
    if (opening.current || busy) return;
    opening.current = true;
    try {
      setMessage(null);
      let text: string;
      try {
        text = await Clipboard.getStringAsync();
      } catch {
        // Web : le navigateur a refusé la lecture du presse-papiers.
        setMessage(t.spotter.pasteDenied);
        return;
      }
      if (!text || detectLink(text).kind === "not_a_link") {
        setMessage(t.spotter.pasteEmpty);
        return;
      }
      const pasted = text.trim();
      setLink(pasted);
      // Lien de vidéo TikTok ou Instagram reconnu : la vidéo s'ouvre tout de suite (décision du fondateur).
      if (linkStep(pasted).kind === "video") await openPasted(pasted);
    } finally {
      opening.current = false;
    }
  }

  /** La croix du champ : vide le lien collé ou tapé (et le message qui l'accompagnait). */
  function handleClear() {
    setLink("");
    setMessage(null);
  }

  /** Le lien, par le même chemin qu'un lien partagé : la vidéo, l'aide, ou le refus sous le champ. */
  async function openPasted(text: string) {
    setMessage(null);
    setBusy(true);
    try {
      const outcome = await openLink(text, "paste");
      if (outcome.kind === "refused") setMessage(outcome.message);
      if (outcome.kind === "help") onHelp();
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue() {
    if (detection.kind !== "supported" || opening.current || busy) return;
    opening.current = true;
    try {
      await openPasted(link);
    } finally {
      opening.current = false;
    }
  }

  return (
    <>
      {/* Lot « fidélité aux maquettes » : un bloc plein ; le libellé devient le texte d'attente et reste le nom lu (VoiceOver, aria-label du site). */}
      <View style={styles.field}>
        <View accessible={false}>
          <LinkIcon size={18} tint={color.acier} />
        </View>
        <TextInput
          style={styles.input}
          value={link}
          onChangeText={(text) => {
            setLink(text);
            setMessage(null);
          }}
          placeholder={label}
          placeholderTextColor={color.acier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleContinue}
          accessibilityLabel={label}
        />
        {link.length > 0 ? (
          <Pressable onPress={handleClear} hitSlop={10} style={styles.clearButton} accessibilityRole="button" accessibilityLabel={t.spotter.clearLink}>
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={handlePaste} style={styles.pasteButton} accessibilityRole="button">
          <ClipboardIcon size={15} tint={color.encre} />
          <Text style={styles.pasteLabel}>{t.spotter.paste}</Text>
        </Pressable>
      </View>
      {Platform.OS === "web" ? <Text style={styles.hint}>{t.player.linkHintWeb}</Text> : null}
      {link.length > 0 ? <DetectionCard detection={detection} /> : null}
      {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}
      {link.length > 0 ? (
        <Pressable
          style={[styles.primary, !canContinue ? styles.primaryDisabled : null]}
          onPress={handleContinue}
          disabled={!canContinue}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue, busy }}
        >
          {busy ? <ActivityIndicator color={color.blanc} /> : null}
          <Text style={[styles.primaryLabel, !canContinue ? styles.primaryLabelDisabled : null]}>
            {busy ? t.spotter.preparing : t.player.open}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  hint: { fontSize: font.caption, lineHeight: 18, color: color.acier, marginTop: space.sm },
  field: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: color.surface,
    // Thème clair seulement : un filet (même façon que la tuile de pièce).
    borderWidth: getActiveScheme() === "light" ? 1 : 0,
    borderColor: color.filet,
    paddingLeft: 14,
    paddingRight: 6,
    gap: 10,
    marginTop: space.md,
  },
  // 16 sur le site : Safari sur iPhone zoome toute la page quand un champ de moins de 16 px prend le curseur.
  input: { flex: 1, minWidth: 0, fontSize: Platform.OS === "web" ? 16 : font.secondary, color: color.encre, paddingVertical: 12 },
  clearButton: { minWidth: 32, minHeight: 44, alignItems: "center", justifyContent: "center" },
  clearLabel: { fontSize: 22, lineHeight: 24, color: color.acier },
  // Un bouton encadré (plus un lien) : la maquette dit 40 de haut, on garde la cible de 44, qui tient dans 52.
  pasteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: color.porcelaine,
    borderWidth: 1,
    borderColor: color.filet,
  },
  pasteLabel: { fontSize: font.secondary, fontWeight: "500", color: color.encre },
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
