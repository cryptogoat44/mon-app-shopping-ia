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

async function resolveTrackedUrl(
  matchId: string,
  context: MerchantLinkContext,
  fallbackUrl: string
): Promise<string> {
  // On ne laisse jamais un souci de suivi (réseau, timeout, 404...)
  // empêcher l'utilisateur d'accéder au marchand — le clic continue de
  // s'enregistrer en arrière-plan même si on n'attend pas sa réponse.
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

/**
 * Point de passage unique pour ouvrir un lien marchand, où qu'il soit
 * affiché dans l'app (résultat de recherche, pièces similaires, Vault,
 * Envies, publication, alerte de prix...) — aucune ouverture de lien
 * marchand ne doit contourner cette fonction.
 */
export async function openMerchantLink({ matchId, fallbackUrl, context }: OpenMerchantLinkOptions): Promise<void> {
  const debounceKey = matchId ?? fallbackUrl;
  if (isDebounced(debounceKey)) return;
  lastOpenedAt.set(debounceKey, Date.now());

  const url = matchId ? await resolveTrackedUrl(matchId, context, fallbackUrl) : fallbackUrl;
  await WebBrowser.openBrowserAsync(url);
}
