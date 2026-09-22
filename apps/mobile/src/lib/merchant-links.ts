import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MerchantLinkContext } from "@monapp/shared-types";
import { trackProductMatchClick } from "./api";

const DEBOUNCE_MS = 2000;

const lastOpenedAt = new Map<string, number>();

function isDebounced(key: string): boolean {
  const last = lastOpenedAt.get(key);
  return last !== undefined && Date.now() - last < DEBOUNCE_MS;
}

// Suivi du clic envoyé en arrière-plan, jamais attendu avant d'ouvrir le
// lien marchand : un souci de suivi (réseau, pas de session, timeout...) ne
// doit jamais retarder ni bloquer l'accès au marchand.
function trackClickInBackground(matchId: string, context: MerchantLinkContext): void {
  trackProductMatchClick(matchId, context).catch(() => {});
}

export interface OpenMerchantLinkOptions {
  /** L'id du `product_match` réel, pour enregistrer le clic en arrière-plan
   * — absent pour une pièce de démonstration (catalogue mock), auquel cas
   * aucun suivi n'est tenté. */
  matchId?: string | null;
  /** Le lien à ouvrir : l'URL affiliée si elle est connue (déjà renvoyée
   * avec les résultats de recherche), sinon l'URL marchande brute. Toujours
   * résolue à l'avance — plus aucun aller-retour serveur n'est attendu au
   * moment du clic. */
  url: string;
  /** Depuis quel écran le lien est ouvert. */
  context: MerchantLinkContext;
}

export interface OpenMerchantLinkResult {
  /** true si le navigateur a malgré tout bloqué l'ouverture (web
   * uniquement — ne peut jamais arriver sur mobile natif). L'appelant doit
   * alors proposer un lien cliquable de secours vers `url`. */
  blocked: boolean;
  /** Présent seulement quand `blocked` est vrai. */
  url?: string;
}

const NOT_BLOCKED: OpenMerchantLinkResult = { blocked: false };

/**
 * Logique web : ouvre le lien marchand immédiatement et de façon
 * synchrone — dans le même tick que le clic, sans aucun `await` avant
 * `window.open`, pour rester dans le geste utilisateur et ne jamais être
 * traité comme un pop-up indésirable par le navigateur.
 *
 * Volontairement SANS le mot-clé "noopener" dans les fonctionnalités de
 * `window.open` : les navigateurs (Chrome, Firefox) renvoient `null` dès
 * que "noopener" est utilisé, que l'ouverture soit bloquée ou non — il
 * devient alors impossible de distinguer un vrai blocage d'une ouverture
 * réussie. C'est ce qui cassait la version précédente de ce correctif
 * (l'onglet ouvert restait bloqué sur about:blank, impossible à piloter).
 * À la place : on récupère la vraie référence, puis on neutralise nous-
 * mêmes `win.opener` (protection anti-tabnabbing équivalente à "noopener",
 * pratique standard bien antérieure à ce mot-clé) — la valeur de retour
 * redevient alors un signal fiable de blocage.
 * Exportée séparément (plutôt que de lire `Platform.OS` ici) pour pouvoir
 * être testée sans dépendre de `react-native`.
 */
export function openMerchantLinkWeb({ matchId, url, context }: OpenMerchantLinkOptions): OpenMerchantLinkResult {
  if (typeof window === "undefined") return NOT_BLOCKED;

  const win = window.open(url, "_blank");
  if (matchId) trackClickInBackground(matchId, context);

  if (!win) return { blocked: true, url };

  try {
    win.opener = null;
  } catch {
    // Best-effort : certains navigateurs interdisent l'écriture directe,
    // sans que ça remette en cause l'ouverture elle-même.
  }

  return NOT_BLOCKED;
}

async function openMerchantLinkNative({ matchId, url, context }: OpenMerchantLinkOptions): Promise<void> {
  if (matchId) trackClickInBackground(matchId, context);
  await WebBrowser.openBrowserAsync(url);
}

/**
 * Point de passage unique pour ouvrir un lien marchand, où qu'il soit
 * affiché dans l'app (résultat de recherche, pièces similaires, Vault,
 * Envies, publication, alerte de prix...) — aucune ouverture de lien
 * marchand ne doit contourner cette fonction.
 */
export async function openMerchantLink(options: OpenMerchantLinkOptions): Promise<OpenMerchantLinkResult> {
  const debounceKey = options.matchId ?? options.url;
  if (isDebounced(debounceKey)) return NOT_BLOCKED;
  lastOpenedAt.set(debounceKey, Date.now());

  if (Platform.OS === "web") return openMerchantLinkWeb(options);

  await openMerchantLinkNative(options);
  return NOT_BLOCKED;
}
