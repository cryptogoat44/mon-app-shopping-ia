import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { ProductSearch } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchSearch, runTextSearch } from "@/lib/api";
import { capacityMessages } from "@/lib/use-search-limits";
import { recoverTextSearch, settledTextSearch, textSearchFailure, type TextSearchFailure } from "@/lib/spot-result";
import { ErrorMessage } from "@/components/error-message";
import { textSearchStatusNote } from "@/components/result-complement";
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
  /** Terminée, déjà lancée ou plus proposée : l'écran a pris la suite. */
  | { kind: "closed" };

/** Plafond des recherches ou trop de recherches d'un coup : les textes de
 * l'écran Résultat (lot 4 quater, précisés au lot limites annoncées), lus à l'affichage. */
function limitCopy(failure: Extract<TextSearchFailure, { kind: "limit" }>): [string, string] {
  switch (failure.reason) {
    case "capacity_day":
    case "capacity_month":
    case "capacity_user":
      return capacityMessages(failure.reason, failure.resumesOn);
    case "rate_limited":
      return [t.result.rateLimitedTitle, t.result.rateLimitedTip];
  }
}

/** VoiceOver ignore les zones annoncées (accessibilityLiveRegion : Android
 * seulement) : l'attente et l'issue de la recherche par les mots sont dites
 * explicitement (audit Lot Q, A11Y-03). L'attente, sur iPhone seulement
 * (Android lit sa zone annoncée) ; l'issue, sans zone annoncée, sur les deux,
 * comme les confirmations (lib/toast-context.tsx). En file d'attente sur
 * iPhone : dite après ce que VoiceOver est en train de lire (l'élément où il
 * se pose quand la case disparaît), sans le couper. Les échecs affichés par
 * ErrorMessage s'annoncent déjà. */
function announce(message: string | null, platforms: "ios" | "native") {
  if (!message || Platform.OS === "web" || (platforms === "ios" && Platform.OS !== "ios")) return;
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

export function TextSearchPrompt({
  searchId,
  initialWords,
  onDone,
  onClosed,
  withIntro = true,
}: {
  searchId: string;
  /** Mots tapés sous la photo au lancement, quand le brouillon est encore en mémoire. */
  initialWords?: string | null;
  /** Recherche renvoyée (ou relue) par le serveur avec l'issue des mots :
   * l'écran remplace son résultat sur place. */
  onDone: (search: ProductSearch) => void;
  /** Plus proposée par le serveur : l'écran retire l'invitation, et dit
   * « déjà lancée » quand `alreadyUsed` (TextSearchAlreadyUsed). */
  onClosed: (alreadyUsed: boolean) => void;
  /** « Pas tout à fait ça ? » sous des propositions ; après « rien trouvé »,
   * la question « Que cherchez-vous ? » sert seule de titre. */
  withIntro?: boolean;
}) {
  const [words, setWords] = useState(initialWords ?? "");
  const [state, setState] = useState<PromptState>({ kind: "idle", failure: null });
  // La requête en cours : la recherche, sa relecture, ou la relecture qui suit « Annuler ».
  const controller = useRef<AbortController | null>(null);

  // Écran quitté pendant la recherche : la requête est abandonnée.
  useEffect(() => () => controller.current?.abort(), []);

  const canSearch = words.trim().length > 0 && state.kind === "idle";

  function finish(search: ProductSearch) {
    setState({ kind: "closed" });
    onDone(search);
    // L'issue, y compris relue après « Annuler » : la section des mots, sinon la phrase de l'écran.
    announce(search.matches.some((match) => match.origin === "words") ? t.result.complementTitleWords : textSearchStatusNote(search.complement?.textStatus), "native");
  }

  function close(alreadyUsed: boolean) {
    setState({ kind: "closed" });
    onClosed(alreadyUsed);
    if (alreadyUsed) announce(t.result.textSearchAlreadyUsed, "native");
  }

  async function search() {
    if (!canSearch) return;
    // Une relecture après « Annuler » s'efface devant le nouvel essai, qui relira au besoin.
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ kind: "running" });
    announce(t.result.textSearchRunning, "ios");
    try {
      const found = await runTextSearch(searchId, words.trim(), current.signal);
      if (current.signal.aborted) return;
      finish(found);
    } catch (error) {
      // « Annuler » : l'invitation est déjà revenue à son état de départ.
      if (current.signal.aborted) return;
      // 409 « déjà lancée », réponse perdue ou panne : la recherche est relue
      // avant de dire « déjà lancée » ou de proposer un nouvel essai.
      const next = await recoverTextSearch(textSearchFailure(error), () => fetchSearch(searchId, current.signal));
      if (current.signal.aborted) return;
      if (next.kind === "done") finish(next.search);
      else if (next.kind === "closed") close(next.alreadyUsed);
      else setState({ kind: "idle", failure: next.failure });
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }

  /** « Annuler » abandonne vraiment la requête ; il ne promet rien sur la
   * recherche, que le serveur a pu engager et mener au bout : elle est
   * relue, et ses propositions remplacent le résultat si elles sont là. */
  function cancel() {
    controller.current?.abort();
    const check = new AbortController();
    controller.current = check;
    setState({ kind: "idle", failure: null });
    void settledTextSearch(() => fetchSearch(searchId, check.signal)).then((settled) => {
      if (controller.current === check) controller.current = null;
      if (settled && !check.signal.aborted) finish(settled);
    });
  }

  if (state.kind === "closed") return null;

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
      ) : failure?.kind === "invalid_words" ? (
        <ErrorMessage style={styles.message}>{t.result.textSearchInvalidWords}</ErrorMessage>
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

/** « Déjà lancée » : à la place de l'invitation, quand le serveur a refusé
 * une seconde recherche avec les mots et que leurs propositions ne sont pas
 * encore là (elles le seront au rechargement, et dans l'historique). */
export function TextSearchAlreadyUsed() {
  return <Text style={styles.closed}>{t.result.textSearchAlreadyUsed}</Text>;
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
