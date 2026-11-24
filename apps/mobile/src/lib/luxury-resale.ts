// Seconde main de luxe (lot « seconde main de luxe ») : sous une pièce qui
// semble venir d'une maison de luxe, une entrée discrète ouvre la recherche
// publique des sites de revente choisis par le fondateur. Le serveur décide
// (apps/backend/src/lib/luxuryResale.ts, listes dans
// apps/backend/src/listes/secondeMainDeLuxe.ts) ; l'app relit le champ et
// n'en garde qu'une forme connue. Absent ou illisible : rien n'est affiché.
// L'entrée ne change l'ordre de rien. Aucun clic n'est enregistré sur le
// serveur : les liens s'ouvrent par openExternalLink
// (components/external-link-sheet.tsx), jamais par openMerchantLink.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { LuxuryResale } from "@monapp/shared-types";
import { httpsParts } from "./bio-link";

export const LUXURY_HOUSE_MAX = 40;
export const LUXURY_WORDS_MAX = 80;
export const LUXURY_SITE_NAME_MAX = 40;
export const LUXURY_SITES_MAX = 5;

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() !== "" && value.length <= max;

/** Le champ reçu, seulement sous une forme connue ; undefined sinon (rien
 * d'affiché). Un site dont l'adresse n'est pas « https: » (httpsParts) ou au
 * nom illisible est retiré ; sans site, ou avec plus de 5 sites, rien. */
export function parseLuxuryResale(raw: unknown): LuxuryResale | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (!text(value.house, LUXURY_HOUSE_MAX) || !text(value.words, LUXURY_WORDS_MAX)) return undefined;
  if (!Array.isArray(value.sites) || value.sites.length === 0 || value.sites.length > LUXURY_SITES_MAX) return undefined;
  const sites = value.sites.flatMap((site: unknown) => {
    if (typeof site !== "object" || site === null) return [];
    const { name, url } = site as Record<string, unknown>;
    const parts = httpsParts(url);
    return text(name, LUXURY_SITE_NAME_MAX) && parts ? [{ name, url: parts.href }] : [];
  });
  if (sites.length === 0) return undefined;
  return { house: value.house, words: value.words, sites };
}

/** Le nom du site en clair, montré sous chaque bouton (« fr.vestiairecollective.com ») ; null : adresse refusée. */
export function resaleHost(url: string): string | null {
  return httpsParts(url)?.host ?? null;
}

/** Faut-il envoyer luxury_resale_shown ? Une fois par résultat affiché qui
 * montre l'entrée (y compris quand elle apparaît avec les boutiques
 * arrivées ensuite) : `last` est l'identifiant de la recherche déjà comptée
 * sur cet écran. */
export function luxuryResaleToTrack(searchId: string | null, resale: LuxuryResale | undefined, last: string | null | undefined): { searchId: string | null; sitesCount: number } | null {
  if (!resale) return null;
  if (last !== undefined && last === searchId) return null;
  return { searchId, sitesCount: resale.sites.length };
}

/** Un bouton de site touché : l'adresse est ouverte par `open`
 * (openExternalLink, qui la relit : https seulement), puis
 * luxury_resale_site_opened est envoyé avec sa place (1 à 5) et le nombre
 * de sites — jamais le nom du site. Adresse refusée : rien ne s'ouvre, rien
 * n'est envoyé. Vrai si le site s'est ouvert (la feuille se ferme alors). */
export function openResaleSite(
  url: string,
  position: number,
  sitesCount: number,
  deps: { open: (url: string) => boolean; track: (event: "luxury_resale_site_opened", props: { position: number; sites_count: number }) => void }
): boolean {
  if (!deps.open(url)) return false;
  deps.track("luxury_resale_site_opened", { position, sites_count: sitesCount });
  return true;
}
