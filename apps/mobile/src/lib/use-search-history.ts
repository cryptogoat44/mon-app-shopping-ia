import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { t } from "@/i18n";
import { getHistoryPage, HistorySearchUnavailableError } from "@/api/client";
import type { Piece } from "@/api/types";
import { HISTORY_SEARCH_DELAY_MS, historyCursor, mergeHistoryPage, normalizeHistoryQuery } from "@/lib/recent-searches";

/** Une ligne de l'historique : la recherche, sa date et la pièce montrée. */
export interface HistoryEntry {
  searchId: string;
  createdAt: string;
  piece: Piece;
}

/** `loading` : première page en cours ; `more` : la suite ; `failed` :
 * première page en échec ; `moreFailed` : la suite en échec ; `unavailable` :
 * le serveur ne sait pas encore chercher dans l'historique. */
export type HistoryStatus = "idle" | "loading" | "more" | "failed" | "moreFailed" | "unavailable";

/** « Récemment spottées » sur l'accueil de Spotter (retours du build 2, lot
 * « historique ») : tout l'historique, par pages de 20 en descendant, et une
 * recherche dans l'historique (2 caractères au moins, 350 ms après la
 * dernière frappe ; seule la réponse de la dernière demande est gardée).
 * `empty` : l'historique complet est vide (connu seulement une fois sa
 * première page lue) — le champ de recherche reste alors caché. Les mots
 * tapés ne sont gardés nulle part : ni sur le téléphone, ni dans les statistiques. */
export function useSearchHistory() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<HistoryStatus>("idle");
  const [ended, setEnded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [empty, setEmpty] = useState<boolean | null>(null);
  // Chaque demande porte un numéro : une réponse arrivée après une autre demande est ignorée.
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const stateRef = useRef({ entries, ended, status, query });
  stateRef.current = { entries, ended, status, query };
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  /** Première page du mode en cours (tout l'historique, ou la recherche). */
  const load = useCallback(async (q: string | null = stateRef.current.query) => {
    const request = ++requestRef.current;
    busyRef.current = true;
    // Les lignes déjà là restent pendant une relecture du même mode (retour sur Spotter, tirer pour actualiser).
    setStatus("loading");
    try {
      const page = await getHistoryPage({ q });
      if (request !== requestRef.current) return;
      const previous = stateRef.current;
      if (previous.query === q && previous.entries.length > 0 && page.length > 0) {
        // Relecture du même mode (retour sur Spotter après avoir rouvert une pièce, tirer pour
        // actualiser) : les nouvelles recherches en tête, la suite déjà chargée gardée — la
        // personne ne perd pas sa place dans la liste.
        const fresh = new Set(page.map((entry) => entry.searchId));
        setEntries([...page, ...previous.entries.filter((entry) => !fresh.has(entry.searchId))]);
      } else {
        setEntries(page);
        setEnded(false);
      }
      setStatus("idle");
      if (q === null) {
        setLoaded(true);
        setEmpty(page.length === 0);
      } else if (previous.query !== q || previous.entries.length === 0) {
        // VoiceOver : la liste change sans rien dire sinon.
        if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(page.length === 0 ? t.retrouverPieces.historyNoMatch(q) : t.retrouverPieces.historyResultsShown);
      }
    } catch (error) {
      if (request !== requestRef.current) return;
      if (error instanceof HistorySearchUnavailableError) {
        setEntries([]);
        setStatus("unavailable");
        return;
      }
      // Relecture en échec avec des lignes déjà affichées : on les garde, sans message (comme avant).
      setStatus(stateRef.current.entries.length > 0 && stateRef.current.query === q ? "idle" : "failed");
    } finally {
      if (request === requestRef.current) busyRef.current = false;
    }
  }, []);

  /** La page suivante (bas de la liste). Une seule demande à la fois ; rien
   * après la fin, après un échec (« Réessayer ») ni sans curseur. */
  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    const before = historyCursor(current.entries);
    if (busyRef.current || current.ended || current.status !== "idle" || before === null) return;
    const request = ++requestRef.current;
    busyRef.current = true;
    setStatus("more");
    try {
      const page = await getHistoryPage({ before, q: current.query });
      if (request !== requestRef.current) return;
      const merged = mergeHistoryPage(stateRef.current.entries, page);
      setEntries(merged.entries);
      // Rien de nouveau : la fin de l'historique (ou un serveur qui ignore `before`).
      if (merged.added === 0) setEnded(true);
      setStatus("idle");
    } catch (error) {
      if (request !== requestRef.current) return;
      setStatus(error instanceof HistorySearchUnavailableError ? "unavailable" : "moreFailed");
    } finally {
      if (request === requestRef.current) busyRef.current = false;
    }
  }, []);

  /** « Réessayer » : la première page si elle a échoué, sinon la suite. */
  const retry = useCallback(() => {
    if (stateRef.current.status === "moreFailed") {
      setStatus("idle");
      stateRef.current = { ...stateRef.current, status: "idle" };
      void loadMore();
    } else void load();
  }, [load, loadMore]);

  /** Le champ de recherche : la liste change 350 ms après la dernière frappe,
   * dès 2 caractères ; effacé, tout l'historique revient. */
  const search = useCallback(
    (next: string | null) => {
      if (next === stateRef.current.query) return;
      setQuery(next);
      setEntries([]);
      setEnded(false);
      setStatus("loading");
      stateRef.current = { ...stateRef.current, query: next, entries: [], ended: false, status: "loading" };
      void load(next);
    },
    [load]
  );

  const onChangeText = useCallback(
    (value: string) => {
      setText(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const next = normalizeHistoryQuery(value);
      debounceRef.current = setTimeout(() => search(next), HISTORY_SEARCH_DELAY_MS);
    },
    [search]
  );

  /** La croix du champ : tout l'historique revient tout de suite. */
  const clear = useCallback(() => {
    setText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    search(null);
  }, [search]);

  // Stables : l'accueil relit l'historique à chaque retour sur Spotter (useFocusEffect), une seule fois.
  const reload = useCallback(() => load(), [load]);
  const more = useCallback(() => void loadMore(), [loadMore]);

  return {
    text,
    onChangeText,
    clear,
    query,
    entries,
    status,
    ended,
    loaded,
    empty: empty === true,
    reload,
    loadMore: more,
    retry,
  };
}
