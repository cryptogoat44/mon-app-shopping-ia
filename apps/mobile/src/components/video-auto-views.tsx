import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SEARCH_QUERY_MAX_LENGTH, VIDEO_AI } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { StepRow } from "@/components/step-row";
import { themedStyles } from "@/theme/themed-styles";
import type { AutoFailure, AutoStep } from "@/lib/video-auto";

// Vues de l'écran « analyse automatique » (lot 4, temps 1 bis) : la
// description, le consentement au premier usage, l'attente, les replis.

type Action = { label: string; onPress: () => void; busy?: boolean };

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
          <Text style={styles.secondaryLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </>
  );
}

export function AskView({
  query,
  onQuery,
  onFind,
  onChooseMyself,
}: {
  query: string;
  onQuery: (value: string) => void;
  onFind: () => void;
  onChooseMyself: () => void;
}) {
  const ready = query.trim().length >= VIDEO_AI.queryMinLength;
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoAuto.title}
      </Text>
      <Text style={styles.caption}>{t.videoAuto.caption}</Text>
      <Text style={styles.label}>{t.videoAuto.queryLabel}</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={onQuery}
        placeholder={t.videoAuto.placeholder}
        placeholderTextColor={color.acier}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        returnKeyType="search"
        onSubmitEditing={() => ready && onFind()}
        accessibilityLabel={t.videoAuto.queryLabel}
        testID="video-auto-query"
      />
      <Pressable
        style={[styles.primary, ready ? null : styles.primaryDisabled]}
        onPress={onFind}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
      >
        <Text style={[styles.primaryLabel, ready ? null : styles.primaryLabelDisabled]}>{t.videoAuto.find}</Text>
      </Pressable>
      <ActionButtons secondary={[{ label: t.videoAuto.chooseMyself, onPress: onChooseMyself }]} />
      <Text style={styles.note}>{t.videoAuto.privacyNote}</Text>
    </>
  );
}

export function ConsentView({
  saving,
  error,
  onAccept,
  onDecline,
  onPolicy,
}: {
  saving: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
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
      <ActionButtons
        primary={{ label: t.videoAuto.accept, onPress: onAccept, busy: saving }}
        secondary={[{ label: t.videoAuto.decline, onPress: onDecline, busy: saving }]}
      />
    </>
  );
}

export function WorkingView({ step, query, onCancel }: { step: AutoStep; query: string; onCancel: () => void }) {
  return (
    <>
      <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
        {t.videoAuto.workingTitle}
      </Text>
      <Text style={styles.caption}>{t.common.quoted(query.trim())}</Text>
      <View style={styles.steps}>
        <StepRow tone="day" label={t.videoAuto.stepFrames} state={step === "frames" ? "now" : "done"} />
        <StepRow tone="day" label={t.videoAuto.stepAi} state={step === "ai" ? "now" : "next"} />
        <StepRow tone="day" label={t.videoAuto.stepIdentify} state="next" />
      </View>
      <ActionButtons secondary={[{ label: t.videoAuto.cancel, onPress: onCancel }]} />
      <Text style={styles.note}>{t.videoAuto.privacyNote}</Text>
    </>
  );
}

/** Repli : un titre, une explication, des actions (le curseur toujours
 * proposé). Une panne est annoncée comme une erreur ; « pièce non repérée »,
 * un vrai résultat, ne l'est pas. */
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

export function CheckingView() {
  return (
    <View style={styles.checking} accessibilityLabel={t.videoAuto.checking}>
      <ActivityIndicator color={color.encre} />
      <Text style={styles.caption}>{t.videoAuto.checking}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  caption: { fontSize: font.caption, color: color.acier, marginTop: 6, lineHeight: 18 },
  body: { fontSize: font.secondary, color: color.encre, marginTop: space.md, lineHeight: 21 },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.lg },
  input: {
    minHeight: 48,
    marginTop: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
    fontSize: font.body,
    color: color.encre,
  },
  link: { minHeight: 44, justifyContent: "center", marginTop: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  message: { fontSize: font.secondary, marginTop: space.md, lineHeight: 21 },
  steps: { marginTop: space.md, gap: 4 },
  note: { fontSize: font.caption, color: color.acier, marginTop: space.md, lineHeight: 18, textAlign: "center" },
  checking: { alignItems: "center", gap: space.sm, marginTop: space.xxl },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));

/** États de l'écran « analyse automatique ». */
export type AutoPhase =
  | { kind: "checking" }
  | { kind: "check_failed" }
  | { kind: "ask" }
  | { kind: "consent" }
  | { kind: "working"; step: AutoStep }
  | { kind: "not_found" }
  | { kind: "failed"; reason: Exclude<AutoFailure, "consent"> }
  | { kind: "prepare_failed"; message: string };

export interface PhaseActions {
  query: string;
  onQuery: (value: string) => void;
  saving: boolean;
  consentError: string | null;
  find: () => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  policy: () => void;
  chooseMyself: () => void;
  retryCheck: () => void;
  retryAnalysis: () => void;
  retryPrepare: () => void;
  editQuery: () => void;
}

/** Pannes après lesquelles réessayer a un sens (une limite atteinte, non). */
const RETRYABLE: readonly AutoFailure[] = ["unavailable", "network", "video"];

/** La vue de chaque état ; le curseur manuel est toujours proposé en repli. */
export function PhaseView({ phase, actions: a }: { phase: AutoPhase; actions: PhaseActions }) {
  const manual = { label: t.videoAuto.chooseMyself, onPress: a.chooseMyself };
  const retry = (onPress: () => void) => ({ label: t.videoAuto.retry, onPress });
  switch (phase.kind) {
    case "checking":
      return <CheckingView />;
    case "check_failed":
      return <FallbackView failure title={t.videoAuto.failedTitle} text={t.videoAuto.checkFailed} actions={[retry(a.retryCheck), manual]} />;
    case "ask":
      return <AskView query={a.query} onQuery={a.onQuery} onFind={a.find} onChooseMyself={a.chooseMyself} />;
    case "consent":
      return <ConsentView saving={a.saving} error={a.consentError} onAccept={a.accept} onDecline={a.decline} onPolicy={a.policy} />;
    case "working":
      return <WorkingView step={phase.step} query={a.query} onCancel={a.cancel} />;
    case "not_found":
      return (
        <FallbackView
          failure={false}
          title={t.videoAuto.notFoundTitle}
          text={t.videoAuto.notFound}
          actions={[{ label: t.videoAuto.editQuery, onPress: a.editQuery }, manual]}
        />
      );
    case "failed":
      return (
        <FallbackView
          failure
          title={t.videoAuto.failedTitle}
          text={t.videoAuto.failure[phase.reason]}
          actions={RETRYABLE.includes(phase.reason) ? [retry(a.retryAnalysis), manual] : [manual]}
        />
      );
    case "prepare_failed":
      return <FallbackView failure title={t.videoAuto.failedTitle} text={phase.message} actions={[retry(a.retryPrepare), manual]} />;
  }
}
