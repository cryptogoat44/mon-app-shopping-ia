import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MerchantLinkContext } from "@monapp/shared-types";
import { trackProductMatchClick } from "./api";

const TRACKING_TIMEOUT_MS = 1500;
const DEBOUNCE_MS = 2000;

const lastOpenedAt = new Map<string, number>();

function isDebounced(key: string): boolean {
  const last = lastOpenedAt.get(key);
  return last !== undefined && Date.now() - last < DEBOUNCE_MS;
}

export async function resolveTrackedUrl(
  matchId: string,
  context: MerchantLinkContext,
  fallbackUrl: string
): Promise<string> {
  // On ne laisse jamais un souci de suivi (réseau, timeout, pas connecté,
  // 404...) empêcher l'utilisateur d'accéder au marchand — le clic continue
  // de s'enregistrer en arrière-plan même si on n'attend pas sa réponse.
  const tracking = trackProductMatchClick(matchId, context).catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TRACKING_TIMEOUT_MS));
  const result = await Promise.race([tracking, timeout]);
  return result?.url ?? fallbackUrl;
}

export interface OpenMerchantLinkOptions {
  /** L'id du `product_match` réel, pour enregistrer le clic — absent pour
   * une pièce de démonstration (catalogue mock) sans équivalent côté
   * serveur, auquel cas on ouvre directement `fallbackUrl` sans suivi. */
  matchId?: string | null;
  /** L'URL à ouvrir si le suivi échoue, prend trop de temps, ou n'existe pas. */
  fallbackUrl: string;
  /** Depuis quel écran le lien est ouvert. */
  context: MerchantLinkContext;
}

export interface OpenMerchantLinkResult {
  /** true si le navigateur a bloqué l'ouverture du nouvel onglet (web
   * uniquement — ne peut jamais arriver sur mobile natif). L'appelant doit
   * alors proposer un lien cliquable de secours vers `url`. */
  blocked: boolean;
  /** Présent seulement quand `blocked` est vrai. */
  url?: string;
}

const NOT_BLOCKED: OpenMerchantLinkResult = { blocked: false };

// Page volontairement sobre, affichée le temps que le suivi du clic
// réponde (1,5s maximum) avant la redirection réelle vers le marchand.
const REDIRECT_PLACEHOLDER_HTML =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Spotto</title>" +
  "<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;" +
  "font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:#faf9f7;color:#2b2b28}</style>" +
  "</head><body>Redirection vers le marchand…</body></html>";

/**
 * Logique web : ouvre un onglet vide de façon synchrone (avant tout appel
 * réseau, pour ne jamais être bloqué comme pop-up), coupe le lien avec la
 * page d'origine (protection anti-tabnabbing), puis redirige cet onglet une
 * seule fois vers le lien affilié dès qu'il est connu, ou vers `fallbackUrl`
 * à défaut. Exportée séparément (plutôt que de lire `Platform.OS` ici) pour
 * pouvoir être testée sans dépendre de `react-native`.
 */
export async function openMerchantLinkWeb({
  matchId,
  fallbackUrl,
  context,
}: OpenMerchantLinkOptions): Promise<OpenMerchantLinkResult> {
  if (typeof window === "undefined") return NOT_BLOCKED;

  // "noopener" en plus du nettoyage manuel ci-dessous : deux protections
  // contre le tabnabbing plutôt qu'une seule.
  const win = window.open("about:blank", "_blank", "noopener");

  if (!win) {
    // Bloqué malgré l'ouverture synchrone (réglage navigateur strict) — on
    // ne peut plus rien ouvrir nous-mêmes, mais on va quand même chercher la
    // bonne URL pour que l'appelant propose un lien cliquable qui fonctionne.
    const url = matchId ? await resolveTrackedUrl(matchId, context, fallbackUrl) : fallbackUrl;
    return { blocked: true, url };
  }

  try {
    win.opener = null;
  } catch {
    // Certains navigateurs interdisent l'écriture directe — "noopener"
    // ci-dessus couvre déjà ce cas.
  }

  try {
    win.document.write(REDIRECT_PLACEHOLDER_HTML);
    win.document.close();
  } catch {
    // Best-effort : un onglet vide sans ce message n'est pas grave.
  }

  const target = matchId ? await resolveTrackedUrl(matchId, context, fallbackUrl) : fallbackUrl;

  try {
    win.location.href = target;
  } catch {
    // L'utilisateur a pu fermer l'onglet entre-temps — rien à faire.
  }

  return NOT_BLOCKED;
}

async function openMerchantLinkNative({ matchId, fallbackUrl, context }: OpenMerchantLinkOptions): Promise<void> {
  const url = matchId ? await resolveTrackedUrl(matchId, context, fallbackUrl) : fallbackUrl;
  await WebBrowser.openBrowserAsync(url);
}

/**
 * Point de passage unique pour ouvrir un lien marchand, où qu'il soit
 * affiché dans l'app (résultat de recherche, pièces similaires, Vault,
 * Envies, publication, alerte de prix...) — aucune ouverture de lien
 * marchand ne doit contourner cette fonction.
 */
export async function openMerchantLink(options: OpenMerchantLinkOptions): Promise<OpenMerchantLinkResult> {
  const debounceKey = options.matchId ?? options.fallbackUrl;
  if (isDebounced(debounceKey)) return NOT_BLOCKED;
  lastOpenedAt.set(debounceKey, Date.now());

  if (Platform.OS === "web") return openMerchantLinkWeb(options);

  await openMerchantLinkNative(options);
  return NOT_BLOCKED;
}
