// Mémoire collective des vidéos (mission « liens vidéo », migrations 0038 et
// 0039).
//
// Quand un membre « spotte » une vidéo TikTok ou Instagram, les pièces
// trouvées par sa recherche sont rattachées à cette vidéo ; le membre suivant
// qui partage la même vidéo voit « Pièces déjà repérées dans cette vidéo ».
//
// Ce qui est gardé : la plateforme, la clé de la vidéo, son adresse publique,
// le pseudo du créateur s'il figurait dans l'adresse, et des pointeurs vers
// les résultats de recherche existants. JAMAIS d'image de la vidéo, et jamais
// l'identité d'un membre dans ce qui est montré aux autres : la lecture passe
// par la fonction video_products, qui ne rend aucun identifiant de membre.
//
// Garde-fous (revue de sécurité, migration 0039) : une pièce n'est montrée
// qu'une fois trouvée par VIDEO_MEMORY_MIN_MEMBERS membres distincts ; un
// membre ne note qu'un spot par vidéo, avec une recherche de moins de
// 30 minutes ; il ne peut pas confirmer une pièce qu'il a lui-même apportée ;
// les spots et confirmations d'un compte suspendu ne comptent plus ; un
// administrateur peut retirer une pièce d'une vidéo.
//
// Sonde video_memory_version : la mémoire n'est « disponible » qu'avec 0039
// (version 2). Avec 0038 seule (version 1), elle reste « indisponible » (rien
// n'est lu ni noté, un avertissement dit que les garde-fous manquent) :
// l'option la plus simple et la plus sûre, plutôt que de servir la mémoire
// sans garde-fous. L'export RGPD, lui, lit ce qui est déjà noté dès 0038.
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { VideoLink, VideoProduct, VideoSpotSource } from "@monapp/shared-types";
import { VIDEO_PRODUCTS_LIMIT } from "@monapp/shared-types";
import { pageKey } from "../services/matchFilters.js";
import { fetchAffiliateUrls, isAffiliateLink } from "./affiliateLinks.js";
import { DatabaseReadError, parseDbRows, webUrlOrNull } from "./validation.js";

/** Pièces rattachées à un spot, au plus (les premières de la recherche). */
export const SPOT_ITEMS_MAX = 10;
/** Nombre de membres DISTINCTS qui doivent avoir trouvé une pièce dans une
 * vidéo pour qu'elle soit montrée aux autres. Compromis : à 1, une pièce
 * apparaît dès le premier membre (la mémoire se remplit plus vite), mais un
 * seul compte peut alors placer ses produits sous n'importe quelle vidéo, et
 * celui qui a envoyé un lien confidentiel peut deviner qui l'a spotté. À 2,
 * il faut deux membres qui trouvent la même page de boutique. */
export const VIDEO_MEMORY_MIN_MEMBERS = 2;
/** Version de la mémoire exigée : 2 = migration 0039 (garde-fous). */
export const VIDEO_MEMORY_REQUIRED_VERSION = 2;
/** Sonde refaite au plus toutes les 5 minutes tant que 0039 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

type Server = Pick<FastifyInstance, "supabaseAdmin" | "log">;

let knownVersion: { version: number; at: number } | null = null;
let schemaProbe: Promise<number> | null = null;

async function probeSchema(fastify: Server): Promise<number> {
  try {
    const { data, error } = await fastify.supabaseAdmin.rpc("video_memory_version");
    if (!error && typeof data === "number" && data >= VIDEO_MEMORY_REQUIRED_VERSION) return data;
    if (!error && typeof data === "number" && data >= 1) {
      fastify.log.warn({ version: data }, "Mémoire des vidéos coupée : migration 0039 absente (garde-fous manquants)");
      return data;
    }
    fastify.log.warn({ code: (error as { code?: string } | null)?.code ?? null }, "Mémoire des vidéos coupée : migration 0038 absente");
  } catch {
    fastify.log.warn({ code: null }, "Mémoire des vidéos coupée : base illisible");
  }
  return 0;
}

/** Version de la mémoire dans la base (0 : migration 0038 absente).
 * Mémorisée une fois la version exigée vue ; sinon la sonde n'est refaite
 * qu'au bout de 5 minutes. */
export async function videoMemoryVersion(fastify: Server, now: () => number = Date.now): Promise<number> {
  if (knownVersion && (knownVersion.version >= VIDEO_MEMORY_REQUIRED_VERSION || now() - knownVersion.at < SCHEMA_RETRY_MS)) return knownVersion.version;
  schemaProbe ??= probeSchema(fastify)
    .then((version) => {
      knownVersion = { version, at: now() };
      return version;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** La mémoire est-elle servie ? Seulement avec la migration 0039. */
export async function videoMemoryReady(fastify: Server, now: () => number = Date.now): Promise<boolean> {
  return (await videoMemoryVersion(fastify, now)) >= VIDEO_MEMORY_REQUIRED_VERSION;
}

/** Les tables de la mémoire existent-elles (0038) ? Pour l'export RGPD : ce
 * qui a été noté doit y figurer, même si la mémoire est coupée. */
export async function videoMemoryStored(fastify: Server): Promise<boolean> {
  return (await videoMemoryVersion(fastify)) >= 1;
}

/** Tests seulement : oublie la sonde. */
export function resetVideoMemoryProbe(): void {
  knownVersion = null;
  schemaProbe = null;
}

/** Clé « même page » d'une pièce : l'empreinte de l'adresse de la boutique
 * nettoyée (hôte en minuscules, sans « www. », sans paramètre de suivi, sans
 * ancre : pageKey, la règle qui dédoublonne déjà les résultats d'une
 * recherche). Deux membres qui trouvent la même page de boutique ont la même
 * clé ; l'adresse elle-même n'est pas gardée dans la mémoire. */
export function productKeyOf(merchantUrl: string): string {
  return createHash("sha256").update(pageKey(merchantUrl)).digest("hex");
}

const PRODUCT_ROWS = z.array(
  z.object({
    product_key: z.string().regex(/^[0-9a-f]{64}$/),
    product_match_id: z.guid(),
    product_name: z.string(),
    brand: z.string().nullable(),
    image_url: z.string(),
    image_hd_url: z.string().nullable(),
    // numeric : un nombre, ou un texte selon le pilote de la base.
    price_min: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
    merchant_name: z.string().nullable(),
    merchant_url: z.string(),
    confirmations: z.number().int().nonnegative(),
    appearances: z.number().int().positive(),
    confirmed_by_viewer: z.boolean(),
  })
);

/** Les pièces déjà repérées dans une vidéo, pour la personne `viewerId` :
 * celles trouvées par au moins VIDEO_MEMORY_MIN_MEMBERS membres distincts
 * (comptes suspendus écartés), triées par la base (confirmations d'autres
 * membres que ceux qui l'ont apportée, puis nombre de membres, puis récence —
 * jamais d'après une commission), sans aucun identifiant de membre. Vidéo
 * inconnue : liste vide. Lecture impossible : DatabaseReadError. */
export async function readVideoProducts(fastify: FastifyInstance, link: VideoLink, viewerId: string, limit: number = VIDEO_PRODUCTS_LIMIT): Promise<VideoProduct[]> {
  const rows = parseDbRows(
    PRODUCT_ROWS,
    await fastify.supabaseAdmin.rpc("video_products", {
      p_platform: link.platform,
      p_video_key: link.videoKey,
      p_viewer_id: viewerId,
      p_limit: limit,
      p_min_members: VIDEO_MEMORY_MIN_MEMBERS,
    }),
    "Pièces d'une vidéo"
  );
  // Une pièce sans lien web ordinaire n'est pas montrée (rien à ouvrir).
  const shown = rows.filter((row) => webUrlOrNull(row.merchant_url) !== null);
  // Lien affilié, s'il existe : le même que partout ailleurs, avec sa mention. L'ordre n'en dépend pas.
  const affiliateUrls = await fetchAffiliateUrls(
    fastify,
    shown.map((row) => row.product_match_id)
  );
  return shown.map((row) => {
    const affiliateUrl = affiliateUrls.get(row.product_match_id) ?? null;
    const price = row.price_min === null ? null : Number(row.price_min);
    return {
      productKey: row.product_key,
      productName: row.product_name,
      brand: row.brand,
      imageUrl: row.image_hd_url ?? row.image_url,
      priceMin: price !== null && Number.isFinite(price) ? price : null,
      currency: row.currency?.trim() || null,
      merchantName: row.merchant_name,
      merchantUrl: affiliateUrl ?? row.merchant_url,
      isAffiliate: isAffiliateLink(affiliateUrl, row.merchant_url),
      confirmations: row.confirmations,
      appearances: row.appearances,
      confirmedByMe: row.confirmed_by_viewer,
    };
  });
}

const SEARCH_ROWS = z.array(z.object({ id: z.guid(), status: z.string() }));
const MATCH_ROWS = z.array(z.object({ id: z.guid(), merchant_url: z.string() }));
const OUTCOME_ROWS = z.array(z.object({ outcome: z.string() })).length(1);

export type SpotOutcome = "ok" | "already_recorded" | "search_not_found" | "search_not_finished" | "search_too_old" | "no_products";

/** Note qu'un membre a spotté une vidéo avec une de SES recherches, terminée,
 * de moins de 30 minutes (vérifié par la base : « search_too_old ») et qui a
 * donné au moins une pièce. Les pièces rattachées : les SPOT_ITEMS_MAX
 * premières de la recherche. Une recherche ne donne qu'un spot, et un membre
 * n'a qu'un spot par vidéo (« already_recorded »). Lecture ou écriture
 * impossible : DatabaseReadError. */
export async function recordVideoSpot(
  fastify: FastifyInstance,
  spot: { userId: string; link: VideoLink; searchId: string; source: VideoSpotSource; momentSeconds: number | null }
): Promise<SpotOutcome> {
  const searches = parseDbRows(
    SEARCH_ROWS,
    await fastify.supabaseAdmin.from("product_searches").select("id, status").eq("id", spot.searchId).eq("user_id", spot.userId).limit(1),
    "Recherche d'un spot"
  );
  const search = searches[0];
  if (!search) return "search_not_found";
  if (search.status !== "completed") return "search_not_finished";

  const matches = parseDbRows(
    MATCH_ROWS,
    await fastify.supabaseAdmin.from("product_matches").select("id, merchant_url").eq("search_id", spot.searchId).order("rank", { ascending: true }).limit(50),
    "Résultats d'un spot"
  );
  const items = matches
    .filter((match) => webUrlOrNull(match.merchant_url) !== null)
    .slice(0, SPOT_ITEMS_MAX)
    .map((match) => ({ m: match.id, k: productKeyOf(match.merchant_url) }));
  if (items.length === 0) return "no_products";

  const { data, error } = await fastify.supabaseAdmin.rpc("video_spot_record", {
    p_user_id: spot.userId,
    p_platform: spot.link.platform,
    p_video_key: spot.link.videoKey,
    p_canonical_url: spot.link.canonicalUrl,
    p_creator_handle: spot.link.creatorHandle,
    p_search_id: spot.searchId,
    p_source: spot.source,
    p_moment_seconds: spot.momentSeconds,
    p_items: items,
  });
  const outcome = parseDbRows(OUTCOME_ROWS, { data, error }, "Enregistrement d'un spot")[0]!.outcome;
  if (outcome === "ok" || outcome === "already_recorded" || outcome === "search_not_found" || outcome === "search_too_old") return outcome;
  throw new DatabaseReadError(`Enregistrement d'un spot : réponse inattendue (${outcome})`);
}

export type ConfirmOutcome = "ok" | "already_confirmed" | "unknown_video" | "unknown_product";

/** « C'est bien cette pièce » : une fois par membre, par vidéo et par pièce. */
export async function confirmVideoProduct(fastify: FastifyInstance, userId: string, link: VideoLink, productKey: string): Promise<ConfirmOutcome> {
  const { data, error } = await fastify.supabaseAdmin.rpc("video_confirm", {
    p_user_id: userId,
    p_platform: link.platform,
    p_video_key: link.videoKey,
    p_product_key: productKey,
  });
  const outcome = parseDbRows(OUTCOME_ROWS, { data, error }, "Confirmation d'une pièce")[0]!.outcome;
  if (outcome === "ok" || outcome === "already_confirmed" || outcome === "unknown_video" || outcome === "unknown_product") return outcome;
  throw new DatabaseReadError(`Confirmation d'une pièce : réponse inattendue (${outcome})`);
}

const REMOVAL_ROWS = z.array(z.object({ outcome: z.string(), items: z.number().int().nonnegative(), confirmations: z.number().int().nonnegative() })).length(1);

export type RemovalOutcome = { outcome: "ok"; items: number; confirmations: number } | { outcome: "unknown_video" | "unknown_product" };

/** Modération : retire une pièce (clé « même page ») d'une vidéo — ses
 * rattachements à tous les spots de cette vidéo et ses confirmations. Les
 * recherches des membres ne sont pas touchées. */
export async function removeVideoProduct(fastify: FastifyInstance, link: VideoLink, productKey: string): Promise<RemovalOutcome> {
  const { data, error } = await fastify.supabaseAdmin.rpc("video_memory_remove", {
    p_platform: link.platform,
    p_video_key: link.videoKey,
    p_product_key: productKey,
  });
  const row = parseDbRows(REMOVAL_ROWS, { data, error }, "Retrait d'une pièce d'une vidéo")[0]!;
  if (row.outcome === "ok") return { outcome: "ok", items: row.items, confirmations: row.confirmations };
  if (row.outcome === "unknown_video" || row.outcome === "unknown_product") return { outcome: row.outcome };
  throw new DatabaseReadError(`Retrait d'une pièce d'une vidéo : réponse inattendue (${row.outcome})`);
}
