import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ProductSearch } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { runTextSearch } from "@/lib/api";
import { capacityMonthTip } from "@/lib/spot-capacity";
import { textSearchFailure, type TextSearchFailure } from "@/lib/spot-result";
import { ErrorMessage } from "@/components/error-message";
import { QueryInput } from "@/components/spot-launch-views";
import { themedStyles } from "@/theme/themed-styles";

// Voie B (lot c) : « Que cherchez-vous ? » sous les résultats, ou après
// « rien trouvé », quand le serveur le propose (suggestText). Une recherche
// avec les mots de la personne, une seule fois par recherche : elle marche
// aussi depuis l'historique, sans l'image. Les mots ne sont pas gardés par
// le serveur et ne vont jamais dans les statistiques.

type PromptState =
  | { kind: "idle"; failure: TextSearchFailure | null }
  | { kind: "running" }
  /** Déjà lancée (une phrase le dit), recherche non admissible, ou terminée. */
  | { kind: "closed"; alreadyUsed: boolean };

/** Plafond des recherches ou trop de recherches d'un coup : les textes de
 * l'écran Résultat (lot 4 quater), lus à l'affichage. */
function limitCopy(failure: Extract<TextSearchFailure, { kind: "limit" }>): [string, string] {
  switch (failure.reason) {
    case "capacity_day":
      return [t.result.capacityDayTitle, t.result.capacityDayTip];
    case "capacity_month":
      return [t.result.capacityMonthTitle, capacityMonthTip(failure.resumesOn, getActiveLocale())];
    case "capacity_user":
      return [t.result.capacityUserTitle, t.result.capacityUserTip];
    case "rate_limited":
      return [t.result.rateLimitedTitle, t.result.rateLimitedTip];
  }
}

export function TextSearchPrompt({
  searchId,
  initialWords,
  onDone,
  withIntro = true,
}: {
  searchId: string;
  /** Mots tapés sous la photo au lancement, quand le brouillon est encore en mémoire. */
  initialWords?: string | null;
  /** Recherche renvoyée par le serveur : l'écran remplace son résultat sur place. */
  onDone: (search: ProductSearch) => void;
  /** « Pas tout à fait ça ? » sous des propositions ; après « rien trouvé »,
   * la question « Que cherchez-vous ? » sert seule de titre. */
  withIntro?: boolean;
}) {
  const [words, setWords] = useState(initialWords ?? "");
  const [state, setState] = useState<PromptState>({ kind: "idle", failure: null });
  const controller = useRef<AbortController | null>(null);

  // Écran quitté pendant la recherche : la requête est abandonnée.
  useEffect(() => () => controller.current?.abort(), []);

  const canSearch = words.trim().length > 0 && state.kind === "idle";

  async function search() {
    if (!canSearch) return;
    const current = new AbortController();
    controller.current = current;
    setState({ kind: "running" });
    try {
      const found = await runTextSearch(searchId, words.trim(), current.signal);
      if (current.signal.aborted) return;
      setState({ kind: "closed", alreadyUsed: false });
      onDone(found);
    } catch (error) {
      // « Annuler » : l'invitation est déjà revenue à son état de départ.
      if (current.signal.aborted) return;
      const failure = textSearchFailure(error);
      if (failure.kind === "already_used" || failure.kind === "hidden") setState({ kind: "closed", alreadyUsed: failure.kind === "already_used" });
      else setState({ kind: "idle", failure });
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }

  /** « Annuler » abandonne vraiment la requête ; il ne promet rien sur la
   * recherche, qui peut déjà être engagée côté serveur. */
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setState({ kind: "idle", failure: null });
  }

  if (state.kind === "closed") {
    return state.alreadyUsed ? <Text style={styles.closed}>{t.result.textSearchAlreadyUsed}</Text> : null;
  }

  const failure = state.kind === "idle" ? state.failure : null;
  const limit = failure?.kind === "limit" ? limitCopy(failure) : null;

  return (
    <View style={styles.box}>
      {withIntro ? (
        <>
          <Text style={styles.intro} accessibilityRole="header">
            {t.result.textSearchIntro}
          </Text>
          <Text style={styles.label}>{t.launch.title}</Text>
        </>
      ) : (
        <Text style={styles.intro} accessibilityRole="header">
          {t.launch.title}
        </Text>
      )}
      <QueryInput value={words} onChangeText={setWords} onSubmit={search} testID="text-search-words" label={t.launch.title} placeholder={t.launch.placeholder} />
      <Text style={styles.note}>{t.result.textSearchNote}</Text>
      {limit ? (
        <>
          <ErrorMessage style={styles.message}>{limit[0]}</ErrorMessage>
          <Text style={styles.tip}>{limit[1]}</Text>
        </>
      ) : failure?.kind === "technical" ? (
        <ErrorMessage style={styles.message}>{t.result.textSearchError}</ErrorMessage>
      ) : null}
      {state.kind === "running" ? (
        <View style={styles.running} accessibilityLiveRegion="polite">
          <ActivityIndicator color={color.acier} />
          <Text style={styles.runningLabel}>{t.result.textSearchRunning}</Text>
          <Pressable onPress={cancel} hitSlop={10} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelLabel}>{t.common.cancel}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.button} onPress={search} disabled={!canSearch} accessibilityRole="button" accessibilityState={{ disabled: !canSearch }}>
          <Text style={[styles.buttonLabel, canSearch ? null : styles.buttonLabelDisabled]}>{t.result.textSearchButton}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { backgroundColor: color.surface, borderColor: color.filet, borderWidth: 1, borderRadius: radius.sm, padding: space.md, marginTop: space.xl },
  intro: { fontSize: font.body, fontWeight: "600", color: color.encre },
  label: { fontSize: font.secondary, color: color.encre, fontWeight: "600", marginTop: space.md },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.sm },
  closed: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.xl },
  message: { fontSize: font.secondary, lineHeight: 21, marginTop: space.md },
  tip: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.xs },
  button: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: space.md },
  buttonLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  buttonLabelDisabled: { color: color.acier },
  running: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  runningLabel: { flex: 1, fontSize: font.secondary, color: color.acier },
  cancel: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  cancelLabel: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
}));
