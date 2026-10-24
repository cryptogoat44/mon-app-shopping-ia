// Appels de la série : Google Lens par le chemin du serveur (stockage de
// spotto-dev, adresse signée de 5 minutes, image effacée aussitôt), Google
// Shopping Light, Immersive Product et Google Product (1 recherche chacun),
// compteur de SerpApi et page d'état (lectures gratuites). Les réponses ne
// sont jamais écrites : seules leurs mesures le sont, par l'outil.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../../src/env.js";
import { safeFetch } from "../../src/lib/safeFetch.js";
import { callSerpApi, type LensResponse } from "../../src/services/visualSearch.js";
import type { SearchLocale } from "../../src/services/lensSettings.js";
import { COMPTEUR, type Compteur } from "./serie-garde-fous.js";

const SERPAPI = "https://serpapi.com/";
const DELAI_MS = 15_000;
/** Dossier des images d'essai dans le stockage de spotto-dev (vidé au début et à la fin). */
export const DOSSIER_STOCKAGE = "essais-serie";

export interface ReponseSerpApi {
  code: number | null;
  statut: string | null;
  json: unknown;
  secondes: number | null;
}

const METADONNEES = z.object({ search_metadata: z.object({ status: z.string().optional() }).passthrough().optional() }).passthrough();

/** Statut de la recherche selon SerpApi (« Success », « Error »…), sans autre contenu. */
export function statutDe(json: unknown): string | null {
  const lu = METADONNEES.safeParse(json);
  return lu.success ? (lu.data.search_metadata?.status?.slice(0, 20) ?? null) : null;
}

/** Ajoute `no_cache=true` à une adresse de recherche de SerpApi (lot 9 : jamais le cache). */
export function sansCache(adresse: string): string {
  const url = new URL(adresse);
  url.searchParams.set("no_cache", "true");
  return url.href;
}

export interface Branchement {
  derniere: () => ReponseSerpApi;
  /** Le prochain appel de recherche à SerpApi partira avec `no_cache=true`. */
  sansCacheAuProchain: () => void;
  /** Oublie la dernière réponse : à faire avant chaque étape, pour ne jamais prêter à une panne le statut de l'appel précédent. */
  reinitialiser: () => void;
}

const AUCUNE_REPONSE: ReponseSerpApi = { code: null, statut: null, json: null, secondes: null };

/** Relève chaque réponse de SerpApi au passage (code, statut, durée) et peut forcer `no_cache`. */
export function brancherSerpApi(): Branchement {
  let derniere: ReponseSerpApi = AUCUNE_REPONSE;
  let forcerSansCache = false;
  const fetchReel = globalThis.fetch;
  globalThis.fetch = async (entree: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const adresse = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    const recherche = adresse.startsWith(`${SERPAPI}search`);
    const cible = recherche && forcerSansCache ? sansCache(adresse) : adresse;
    if (recherche) forcerSansCache = false;
    const debut = Date.now();
    const reponse = await fetchReel(cible === adresse ? entree : cible, init);
    if (recherche) {
      const json: unknown = await reponse.clone().json().catch(() => null);
      derniere = { code: reponse.status, statut: statutDe(json), json, secondes: Math.round((Date.now() - debut) / 1000) };
    }
    return reponse;
  };
  return {
    derniere: () => derniere,
    sansCacheAuProchain: () => (forcerSansCache = true),
    reinitialiser: () => {
      derniere = AUCUNE_REPONSE;
      forcerSansCache = false;
    },
  };
}

/** Un appel Google Lens (1 recherche) sur une image préparée ; l'image est effacée du stockage ensuite. */
export async function appelLens(admin: SupabaseClient, image: Buffer, locale: SearchLocale, texte: string | null): Promise<LensResponse> {
  const chemin = `${DOSSIER_STOCKAGE}/${randomUUID()}.jpg`;
  const envoi = await admin.storage.from("screenshots").upload(chemin, image, { contentType: "image/jpeg" });
  if (envoi.error) throw new Error(`Envoi de l'image impossible : ${envoi.error.message}`);
  try {
    const signee = await admin.storage.from("screenshots").createSignedUrl(chemin, 300);
    if (signee.error || !signee.data) throw new Error(`Adresse signée impossible : ${signee.error?.message ?? "?"}`);
    return await callSerpApi(signee.data.signedUrl, { type: "visual_matches", locale }, texte);
  } finally {
    const effacement = await admin.storage.from("screenshots").remove([chemin]);
    if (effacement.error) console.error(`ATTENTION : image d'essai non effacée du stockage : ${effacement.error.message}`);
  }
}

/** Efface les images d'essai restées dans le stockage (après une interruption). Renvoie leur nombre. */
export async function viderStockage(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.storage.from("screenshots").list(DOSSIER_STOCKAGE, { limit: 100 });
  if (error) throw new Error(`Stockage illisible : ${error.message}`);
  const chemins = (data ?? []).map((f) => `${DOSSIER_STOCKAGE}/${f.name}`);
  if (chemins.length === 0) return 0;
  const effacement = await admin.storage.from("screenshots").remove(chemins);
  if (effacement.error) throw new Error(`Images d'essai non effacées : ${effacement.error.message}`);
  return chemins.length;
}

async function rechercheSerpApi(parametres: Record<string, string>): Promise<ReponseSerpApi> {
  const adresse = `${SERPAPI}search.json?${new URLSearchParams({ ...parametres, api_key: env.SERPAPI_KEY }).toString()}`;
  const debut = Date.now();
  const reponse = await safeFetch(adresse, { allowedHosts: ["serpapi.com"], signal: AbortSignal.timeout(DELAI_MS) });
  const json: unknown = await reponse.json().catch(() => null);
  return { code: reponse.status, statut: statutDe(json), json, secondes: Math.round((Date.now() - debut) / 1000) };
}

/** Google Shopping Light, texte seul, en France (1 recherche). */
export function appelShopping(texte: string): Promise<ReponseSerpApi> {
  return rechercheSerpApi({ engine: "google_shopping_light", q: texte, gl: "fr", hl: "fr", google_domain: "google.fr" });
}

/** Les boutiques d'un produit (1 recherche) : Immersive Product (jeton), ou Google Product (identifiant, pays France). */
export function appelBoutiques(api: "immersive" | "product", produit: { productId: string | null; pageToken: string | null }): Promise<ReponseSerpApi> {
  if (api === "immersive") {
    if (!produit.pageToken) throw new Error("Produit sans jeton pour Immersive Product.");
    return rechercheSerpApi({ engine: "google_immersive_product", page_token: produit.pageToken });
  }
  const cle: Record<string, string> = produit.productId ? { product_id: produit.productId } : produit.pageToken ? { page_token: produit.pageToken } : {};
  if (Object.keys(cle).length === 0) throw new Error("Produit sans identifiant pour Google Product.");
  return rechercheSerpApi({ engine: "google_product", ...cle, gl: "fr", hl: "fr" });
}

/** Où mène un lien de boutique : domaine final et code, sans rien lire de la page. */
export async function verifierLien(lien: string): Promise<{ domaineFinal: string | null; code: number | null }> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const reponse = await fetch(lien, { method, redirect: "follow", signal: AbortSignal.timeout(10_000) });
      await reponse.body?.cancel();
      if (method === "HEAD" && (reponse.status === 405 || reponse.status === 403)) continue;
      return { domaineFinal: new URL(reponse.url).hostname.toLowerCase().replace(/^www\./, ""), code: reponse.status };
    } catch {
      if (method === "GET") return { domaineFinal: null, code: null };
    }
  }
  return { domaineFinal: null, code: null };
}

const COMPTE = z.object({ this_month_usage: z.number().int(), total_searches_left: z.number().int() }).passthrough();

/** Compteur de SerpApi (Account API, gratuite). Ni la clé ni l'adresse e-mail du compte ne sont gardées. */
export async function lireCompteur(maintenant: () => Date = () => new Date()): Promise<Compteur> {
  const reponse = await safeFetch(`${SERPAPI}account.json?api_key=${encodeURIComponent(env.SERPAPI_KEY)}`, { allowedHosts: ["serpapi.com"], signal: AbortSignal.timeout(DELAI_MS) });
  const lu = COMPTE.safeParse(await reponse.json().catch(() => null));
  if (!reponse.ok || !lu.success) throw new Error(`Compteur de SerpApi illisible (code ${reponse.status}).`);
  return COMPTEUR.parse({ utilisees: lu.data.this_month_usage, restantes: lu.data.total_searches_left, lueLe: maintenant().toISOString() });
}

const COMPOSANTS = z.object({ components: z.array(z.object({ name: z.string(), status: z.string() })) });
const INCIDENTS = z.object({ incidents: z.array(z.object({ name: z.string() })) });

/** État des services utiles et noms des incidents ouverts (page d'état publique, sans clé ni crédit). */
export async function lirePageEtat(services: readonly string[]): Promise<{ etats: Record<string, string | null>; incidents: string[] }> {
  const lire = async (chemin: string): Promise<unknown> => {
    const reponse = await fetch(`https://status.serpapi.com/api/v2/${chemin}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(DELAI_MS) }).catch(() => null);
    return reponse?.ok ? reponse.json().catch(() => null) : null;
  };
  const [composants, incidents] = await Promise.all([lire("components.json"), lire("incidents/unresolved.json")]);
  const lus = COMPOSANTS.safeParse(composants);
  const etats = Object.fromEntries(services.map((s) => [s, lus.success ? (lus.data.components.find((c) => c.name === s)?.status ?? null) : null]));
  const ouverts = INCIDENTS.safeParse(incidents);
  return { etats, incidents: ouverts.success ? ouverts.data.incidents.map((i) => i.name.slice(0, 160)) : ["page des incidents illisible"] };
}
