import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { Image } from "expo-image";
import { SEARCH_QUERY_MAX_LENGTH } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { VideoIcon } from "@/components/icons";
import { LinkNotice } from "@/components/link-notice";
import type { FramePreview } from "@/lib/video-timeline";
import { themedStyles } from "@/theme/themed-styles";

// Vues de l'écran unique du Spotter (lot 4 ter) : l'aperçu, la question
// « Que cherchez-vous ? » et « Lancer », l'accord au premier usage, les replis.

export type Action = { label: string; onPress: () => void; busy?: boolean };

/** Bouton principal puis boutons secondaires (zones tactiles de 52 pt). */
export function ActionButtons({ primary, secondary = [] }: { primary?: Action; secondary?: Action[] }) {
  return (
    <>
      {primary ? (
        <Pressable style={styles.primary} onPress={primary.onPress} disabled={primary.busy} accessibilityRole="button">
          {primary.busy ? <ActivityIndicator color={color.blanc} /> : null}
          <Text style={styles.primaryLabel}>{primary.label}</Text>
        </Pressable>
      ) : null}
      {secondary.map((action) => (
        <Pressable key={action.label} style={styles.secondary} onPress={action.onPress} disabled={action.busy} accessibilityRole="button">
          {action.busy ? <ActivityIndicator color={color.encre} /> : null}
          <Text style={styles.secondaryLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </>
  );
}

/** Aperçu de la vidéo (une image de son milieu, et sa durée) ou de la photo. */
export function LaunchPreview({ source, failed, duration, height }: { source: FramePreview | null; failed: boolean; duration: string | null; height: number }) {
  return (
    <View
      style={[styles.preview, { height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={duration ? t.launch.videoPreview(duration) : t.launch.photoPreview}
    >
      {/* Toujours en place, même vide : sur iPhone, une image arrivée en même temps que
          le composant pouvait s'afficher agrandie et rognée (constaté au lot 4). */}
      <Image source={source} style={[styles.fill, source ? null : styles.hidden]} contentFit="contain" />
      {source ? null : <View style={styles.overlay}>{failed ? <VideoIcon size={28} tint={color.acier} /> : <ActivityIndicator color={color.acier} />}</View>}
      {duration ? (
        <View style={styles.badge}>
          <VideoIcon size={14} tint={color.surImage} />
          <Text style={styles.badgeLabel}>{duration}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Le champ « Que cherchez-vous ? » : exemples précis en gris. Au focus, un
 * soulignement vert remplace le cadre du navigateur : le repère reste visible
 * au clavier (contraste AA), sans encadrer le texte. */
export function QueryInput({
  value,
  onChangeText,
  onSubmit,
  autoFocus = false,
  testID,
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  testID: string;
  style?: StyleProp<TextStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[styles.input, focused ? styles.inputFocused : null, style]}
      value={value}
      onChangeText={onChangeText}
      placeholder={t.launch.placeholder}
      placeholderTextColor={color.acier}
      maxLength={SEARCH_QUERY_MAX_LENGTH}
      autoFocus={autoFocus}
      returnKeyType="search"
      onSubmitEditing={onSubmit}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={t.launch.title}
      testID={testID}
    />
  );
}

export interface AskProps {
  query: string;
  onQuery: (value: string) => void;
  onLaunch: () => void;
  launchLabel: string;
  canLaunch: boolean;
  /** Analyse automatique refusée : on le dit, et on propose de l'activer. */
  declined: boolean;
  onEnableAi: () => void;
  /** Un lien a été collé dans le champ : il ne permet pas de lire la vidéo. */
  linkInQuery: boolean;
  onAddVideo: () => void;
  addingVideo: boolean;
  message: string | null;
  privacy: string | null;
}

/** La question, prête à la saisie dès l'ouverture, et « Lancer ». */
export function AskView(p: AskProps) {
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.launch.title}
      </Text>
      <QueryInput value={p.query} onChangeText={p.onQuery} onSubmit={() => p.canLaunch && p.onLaunch()} autoFocus testID="spot-query" />
      {p.linkInQuery ? <LinkNotice style={styles.notice} onAddVideo={p.onAddVideo} busy={p.addingVideo} /> : null}
      {p.message ? <ErrorMessage style={styles.message}>{p.message}</ErrorMessage> : null}
      <Pressable
        style={[styles.primary, p.canLaunch ? null : styles.primaryDisabled]}
        onPress={p.onLaunch}
        disabled={!p.canLaunch}
        accessibilityRole="button"
        accessibilityState={{ disabled: !p.canLaunch }}
      >
        <Text style={[styles.primaryLabel, p.canLaunch ? null : styles.primaryLabelDisabled]}>{p.launchLabel}</Text>
      </Pressable>
      {p.declined ? (
        <>
          <Text style={styles.note}>{t.launch.declinedNote}</Text>
          <Pressable onPress={p.onEnableAi} style={styles.discreet} accessibilityRole="button">
            <Text style={styles.discreetLabel}>{t.launch.enableAi}</Text>
          </Pressable>
        </>
      ) : null}
      {p.privacy ? <Text style={styles.note}>{p.privacy}</Text> : null}
    </>
  );
}

/** Accord au premier usage : « Accepter » en bouton principal ; le refus
 * reste libre et ne bloque rien — un lien discret ouvre le curseur, sans IA
 * et sans envoi d'image. */
export function ConsentView({
  saving,
  error,
  onAccept,
  onChooseMyself,
  onPolicy,
}: {
  saving: boolean;
  error: string | null;
  onAccept: () => void;
  onChooseMyself: () => void;
  onPolicy: () => void;
}) {
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoAuto.consentTitle}
      </Text>
      {t.videoAuto.consentBody.map((paragraph) => (
        <Text key={paragraph} style={styles.body}>
          {paragraph}
        </Text>
      ))}
      <Pressable onPress={onPolicy} style={styles.link} accessibilityRole="link">
        <Text style={styles.linkLabel}>{t.videoAuto.consentPolicy}</Text>
      </Pressable>
      {error ? <ErrorMessage style={styles.message}>{error}</ErrorMessage> : null}
      <ActionButtons primary={{ label: t.videoAuto.accept, onPress: onAccept, busy: saving }} />
      <Pressable onPress={onChooseMyself} disabled={saving} style={styles.discreet} accessibilityRole="button">
        <Text style={styles.discreetLabel}>{t.videoAuto.chooseMyself}</Text>
      </Pressable>
    </>
  );
}

/** Repli : un titre, une explication, des actions. Une panne est annoncée
 * comme une erreur ; « pièce non repérée », un vrai résultat, ne l'est pas. */
export function FallbackView({ title, text, failure, actions }: { title: string; text: string; failure: boolean; actions: Action[] }) {
  const [primary, ...secondary] = actions;
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {failure ? <ErrorMessage style={styles.message}>{text}</ErrorMessage> : <Text style={styles.body}>{text}</Text>}
      <ActionButtons primary={primary} secondary={secondary} />
    </>
  );
}

const styles = themedStyles(() => ({
  preview: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  hidden: { opacity: 0 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    left: space.sm,
    bottom: space.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: color.voileImage,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    height: 26,
  },
  badgeLabel: { color: color.surImage, fontSize: font.caption, fontWeight: "600", fontVariant: ["tabular-nums"] },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29, marginTop: space.lg },
  body: { fontSize: font.secondary, color: color.encre, marginTop: space.md, lineHeight: 21 },
  // Contour « plein » de largeur nulle : remplace le cadre du navigateur (« auto », qui ignore la largeur).
  input: { minHeight: 48, marginTop: space.xs, borderBottomWidth: 1, borderBottomColor: color.filet, fontSize: font.body, color: color.encre, outlineStyle: "solid", outlineWidth: 0 },
  inputFocused: { borderBottomWidth: 2, borderBottomColor: color.vert },
  notice: { marginTop: space.md },
  link: { minHeight: 44, justifyContent: "center", marginTop: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  discreet: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.xs },
  discreetLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline" },
  message: { fontSize: font.secondary, marginTop: space.md, lineHeight: 21 },
  note: { fontSize: font.caption, color: color.acier, marginTop: space.md, lineHeight: 18, textAlign: "center" },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
