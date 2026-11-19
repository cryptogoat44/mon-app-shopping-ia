import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { encodeAvatar, isOtherImageFormat } from "../lib/photos.js";
import { z } from "zod";
import {
  APP_LOCALES,
  AVATAR_MAX_BYTES,
  DEFAULT_MENTIONS_FROM,
  DEFAULT_MESSAGES_FROM,
  MENTIONS_FROM,
  MESSAGES_FROM,
  PIECE_SENDS_FROM,
  PRIVACY_LEVELS,
  bioProblem,
  normalizeBio,
  singleLine,
  type Profile,
} from "@monapp/shared-types";
import { DatabaseReadError, WEB_URL_MAX_LENGTH, parseDbRows, parseInput } from "../lib/validation.js";
import { PRIVATE_ACCOUNTS_UNAVAILABLE, privateAccountsReady } from "../lib/audience.js";
import { toMemberRows } from "../lib/memberRows.js";
import { COMMENT_THREADS_UNAVAILABLE, commentThreadsReady } from "../lib/comments.js";
import { postExtrasReady } from "../lib/postExtras.js";
import { dropUnseeableTags } from "../lib/peopleTags.js";
import { isFileTooLargeError, isTooManyPartsError } from "../lib/multipartErrors.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { isAdmin } from "../lib/moderation.js";
import { CONTENT_NOT_ALLOWED, firstBannedText } from "../lib/contentFilter.js";
import { MESSAGES_UNAVAILABLE, messagesReady } from "../lib/messaging.js";
import { READ_RECEIPTS_UNAVAILABLE, readReceiptsReady, saveReadReceipts } from "../lib/readReceipts.js";
import { emptyUserFolder, extractOwnedStoragePath, removeOwnedFiles } from "../lib/storage.js";
import { AVATAR_BUCKET } from "../lib/profileModeration.js";
import { PROFILE_LINK_UNAVAILABLE, profileExtrasReady, profileExtrasShown } from "../lib/profileExtras.js";
import { LINK_INVALID, LINK_TOO_LONG, bioLinkProblem, bioLinkTexts } from "../lib/bioLink.js";
import { DISCOVERY_SETTING_UNAVAILABLE, discoveryReady, discoveryShown } from "../lib/forYou.js";
import { RATE_LIMITS } from "../lib/rateLimits.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";

/** Comptes dont une photo de profil est en cours d'envoi (un seul envoi à la fois par compte). */
const avatarUploads = new Set<string>();
const AVATAR_IN_PROGRESS = { error: "avatar_in_progress", message: "Une photo est déjà en cours d'envoi. Réessayez dans un instant." } as const;

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
/** Bio reçue, avant d'en retirer espaces et lignes vides en trop. */
const BIO_RAW_MAX_LENGTH = 1000;

/** Nom affiché reçu, avant nettoyage. */
const DISPLAY_NAME_RAW_MAX_LENGTH = 500;
// Messages des refus de PATCH /api/me, par champ : toujours en français,
// jamais le message technique (en anglais) de la bibliothèque de validation.
const UPDATE_ME_MESSAGES: Record<string, string> = {
  username: "3 à 20 caractères : lettres minuscules, chiffres, underscore.",
  displayName: "Le nom affiché doit compter de 1 à 60 caractères.",
  bio: "La bio est trop longue (160 caractères maximum).",
};

const updateMeSchema = z.object({
  username: z.string().toLowerCase().regex(USERNAME_REGEX),
  // Une seule ligne, sans caractère de contrôle (singleLine), puis 1 à 60 caractères.
  displayName: z.string().max(DISPLAY_NAME_RAW_MAX_LENGTH).transform(singleLine).pipe(z.string().min(1).max(60)),
  // Bio : normalisée puis contrôlée dans la route (160 caractères, 3 lignes :
  // normalizeBio, bioProblem). Ici, seul un texte démesuré est écarté d'emblée.
  bio: z.string().max(BIO_RAW_MAX_LENGTH).nullable().optional(),
  // Lien en bio (migration 0049) : absent = inchangé ; null ou "" = retiré.
  // Contrôlé dans la route (lib/bioLink.ts) ; ici, seul un texte démesuré est écarté.
  linkUrl: z.string().max(WEB_URL_MAX_LENGTH).nullable().optional(),
});

const updateLocaleSchema = z.object({ locale: z.enum(APP_LOCALES) });
const updatePieceSendsFromSchema = z.object({ pieceSendsFrom: z.enum(PIECE_SENDS_FROM) });
const updateMessagesFromSchema = z.object({ messagesFrom: z.enum(MESSAGES_FROM) });
// Un vrai oui ou non : ni « true » en texte, ni 1.
const updateReadReceiptsSchema = z.object({ readReceipts: z.boolean() });
const updatePrivateAccountSchema = z.object({ isPrivate: z.boolean() });
const updateMentionsFromSchema = z.object({ mentionsFrom: z.enum(MENTIONS_FROM) });
const updateDiscoverableSchema = z.object({ discoverable: z.boolean() });

// Ligne brute de la table `profiles` (colonnes en snake_case, cf. schema.sql), relue sans lui faire confiance.
const profileRowSchema = z.object({
  id: z.guid(),
  username: z.string().nullable(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  locale: z.string(),
  default_privacy: z.enum(PRIVACY_LEVELS),
  // Lot 5 (migration 0024) ; valeur par défaut tant que la colonne n'existe pas.
  piece_sends_from: z.enum(PIECE_SENDS_FROM).default("following"),
  // Lot messages (migration 0032) ; valeur par défaut tant que la colonne n'existe pas.
  messages_from: z.enum(MESSAGES_FROM).default(DEFAULT_MESSAGES_FROM),
  // Lot « messages vus » (migration 0043) ; absente tant que la colonne n'existe pas.
  read_receipts: z.boolean().nullable().optional(),
  // Compte privé (migration 0045) ; public tant que la colonne n'existe pas.
  is_private: z.boolean().default(false),
  // Mentions (migration 0046) ; valeur de départ tant que la colonne n'existe pas.
  mentions_from: z.enum(MENTIONS_FROM).default(DEFAULT_MENTIONS_FROM),
  // Lien en bio (migration 0049) ; absent tant que la colonne n'existe pas.
  link_url: z.string().nullable().optional(),
  // « Proposer mon compte aux autres membres » (migration 0050) ; proposé tant que la colonne n'existe pas.
  discoverable: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

interface ProfileCounts {
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

/** Compte privé (migration 0045) : ce que le profil en dit ; null tant que la
 * migration manque (l'app cache alors le réglage). */
interface PrivateAccountInfo {
  followRequestsCount: number;
}

/** Au-delà, les demandes en attente ne sont plus comptées : le nombre annoncé plafonne à 100. */
const FOLLOW_REQUESTS_COUNT_MAX = 100;
const REQUESTER_ROWS = z.array(z.object({ requester_id: z.guid() }));

/** Nombre de demandes d'abonnement en attente, telles que la liste les
 * montre (jamais un compte en blocage, suspendu ou sans nom d'utilisateur :
 * lib/memberRows.ts) ; null sans la migration 0045. Une seule lecture quand
 * il n'y en a aucune. */
async function readPrivateAccountInfo(fastify: FastifyInstance, userId: string): Promise<PrivateAccountInfo | null> {
  try {
    if (!(await privateAccountsReady(fastify))) return null;
  } catch {
    // Schéma illisible : le profil reste lisible, sans le réglage (l'app le cache).
    return null;
  }
  try {
    return { followRequestsCount: await countFollowRequests(fastify, userId) };
  } catch {
    // Le profil reste lisible : seul le compteur des demandes manque.
    fastify.log.warn("Demandes d'abonnement en attente : compteur illisible");
    return { followRequestsCount: 0 };
  }
}

async function countFollowRequests(fastify: FastifyInstance, userId: string): Promise<number> {
  const pending = parseDbRows(
    REQUESTER_ROWS,
    await fastify.supabaseAdmin.from("follow_requests").select("requester_id").eq("target_id", userId).limit(FOLLOW_REQUESTS_COUNT_MAX),
    "Demandes d'abonnement en attente"
  );
  if (pending.length === 0) return 0;
  const shown = await toMemberRows(
    fastify,
    userId,
    pending.map((row) => row.requester_id),
    { contextOwnerId: userId }
  );
  return shown.length;
}

/** Réglage « Qui peut me mentionner » : proposé seulement avec la migration
 * 0046. Schéma illisible : le profil reste lisible, sans le réglage. */
async function mentionsSettingShown(fastify: FastifyInstance): Promise<boolean> {
  try {
    return await commentThreadsReady(fastify);
  } catch {
    return false;
  }
}

/** Profil renvoyé à l'app ; null si la ligne lue n'a pas la forme attendue.
 * `withLink` : la base a la migration 0049 (sinon, pas de `linkUrl` : l'app cache le champ).
 * `receipts` : la base a la migration 0043 ; sans elle, le réglage
 * « Confirmations de lecture » n'est pas renvoyé (l'app ne le propose pas).
 * `withDiscovery` : la base a la migration 0050 (sinon, pas de `discoverable` : l'app cache le réglage). */
function toProfile(
  row: unknown,
  counts: ProfileCounts,
  admin: boolean,
  privateAccount: PrivateAccountInfo | null,
  withMentions: boolean,
  withLink: boolean,
  receipts: boolean,
  withDiscovery: boolean
): Profile | null {
  const parsed = profileRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const profile = parsed.data;
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    locale: profile.locale,
    defaultPrivacy: profile.default_privacy,
    ...counts,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    isAdmin: admin,
    pieceSendsFrom: profile.piece_sends_from,
    messagesFrom: profile.messages_from,
    ...(receipts && typeof profile.read_receipts === "boolean" ? { readReceipts: profile.read_receipts } : {}),
    ...(privateAccount ? { isPrivate: profile.is_private, followRequestsCount: privateAccount.followRequestsCount } : {}),
    ...(withMentions ? { mentionsFrom: profile.mentions_from } : {}),
    ...(withLink ? { linkUrl: profile.link_url ?? null } : {}),
    ...(withDiscovery ? { discoverable: profile.discoverable !== false } : {}),
  };
}

async function fetchFollowCounts(fastify: FastifyInstance, userId: string): Promise<ProfileCounts> {
  const [followers, following, posts] = await Promise.all([
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    // Son propre nombre de publications (toutes, y compris privées), hors
    // publications masquées par la modération (lot 5).
    fastify.supabaseAdmin.from("posts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("hidden_at", null),
  ]);
  return { followersCount: followers.count ?? 0, followingCount: following.count ?? 0, postsCount: posts.count ?? 0 };
}

/** Adresse de la photo de profil actuelle (null : aucune). Lecture impossible : DatabaseReadError. */
async function readAvatarUrl(fastify: FastifyInstance, userId: string): Promise<string | null> {
  const { data, error } = await fastify.supabaseAdmin.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture de la photo de profil impossible");
  const row = z.object({ avatar_url: z.string().nullable() }).nullable().safeParse(data);
  return row.success ? (row.data?.avatar_url ?? null) : null;
}

/** Lien en bio actuel (migration 0049 ; null : aucun). Lecture impossible : DatabaseReadError. */
async function readLinkUrl(fastify: FastifyInstance, userId: string): Promise<string | null> {
  const { data, error } = await fastify.supabaseAdmin.from("profiles").select("link_url").eq("id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture du lien du profil impossible");
  const row = z.object({ link_url: z.string().nullable() }).nullable().safeParse(data);
  if (!row.success) throw new DatabaseReadError("Lien du profil illisible");
  return row.data?.link_url ?? null;
}

const PROFILE_UNREADABLE = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    // Rôle administrateur illisible : la requête échoue (500), jamais « non administrateur » par défaut.
    const [{ data, error }, counts, admin, privateAccount] = await Promise.all([
      fastify.supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
      fetchFollowCounts(fastify, userId),
      isAdmin(fastify, userId),
      readPrivateAccountInfo(fastify, userId),
    ]);

    if (error || !data) {
      request.log.error({ error }, "Profil introuvable pour un utilisateur authentifié");
      return reply.code(404).send({ error: "profile_not_found", message: "Profil introuvable." });
    }

    const profile = toProfile(data, counts, admin, privateAccount, await mentionsSettingShown(fastify), await profileExtrasShown(fastify), await readReceiptsReady(fastify), await discoveryShown(fastify));
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  // Profil public (photo, nom, bio) : non modifiable par un compte suspendu (lot 5).
  // Lot « profil et icône des réglages » : l'app envoie un carré JPEG déjà
  // recadré ; ici, JPEG ou PNG seulement, 5 Mo au plus, refait en carré de
  // 512 px sans métadonnées (encodeAvatar). Chaque photo a un nom nouveau
  // (« <compte>/avatar-<aléatoire>.jpg », adresse publique) : aucun cache ne
  // ressert l'ancienne, qui est effacée une fois la nouvelle en place.
  // Revue de sécurité du 12 novembre 2026 : 20 envois ou suppressions par
  // heure (refus compris), un seul fichier et aucun autre champ dans le
  // formulaire, une image de 2 048 × 2 048 px au plus (encodeAvatar), et un
  // seul envoi à la fois par compte (deux envois simultanés laissaient un
  // fichier public que plus rien n'effaçait).
  fastify.post(
    "/api/me/avatar",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("avatarWrite")], config: { rateLimitName: "avatarWrite" as const } },
    async (request, reply) => {
      const userId = request.user!.id;
      if (avatarUploads.has(userId)) return reply.code(429).send(AVATAR_IN_PROGRESS);
      avatarUploads.add(userId);
      try {
        return await receiveAvatar(request, reply, userId);
      } finally {
        avatarUploads.delete(userId);
      }
    }
  );

  async function receiveAvatar(request: FastifyRequest, reply: FastifyReply, userId: string) {
    let buffer: Buffer;
    try {
      // L'app n'envoie que le fichier : tout autre champ, ou un second
      // fichier, fait refuser l'envoi sans rien garder en mémoire.
      const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0, parts: 1 } });
      if (!file || !file.mimetype.startsWith("image/")) {
        return reply.code(400).send({ error: "invalid_file", message: "Merci d'envoyer une image." });
      }
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "file_too_large", message: "La photo est trop lourde (5 Mo maximum)." });
      }
      if (isTooManyPartsError(error)) {
        return reply.code(413).send({ error: "invalid_file", message: "Merci d'envoyer une seule image, sans autre champ." });
      }
      throw error;
    }

    // Format reconnu à ses premiers octets, jamais au type annoncé. Inconnu
    // ou déguisé (SVG, texte…) : « illisible », comme avant. Vraie image
    // d'un autre format (HEIC envoyé sans conversion, WebP, GIF, AVIF) : on
    // dit quoi envoyer.
    if (await isOtherImageFormat(buffer)) {
      return reply.code(400).send({ error: "unsupported_format", message: "Format non accepté : choisissez une photo JPEG, PNG ou HEIC." });
    }
    let encoded: Buffer;
    try {
      encoded = (await encodeAvatar(buffer)).data;
    } catch {
      return reply.code(400).send({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
    }
    // Lus avant toute écriture : une lecture impossible n'enregistre rien.
    const admin = await isAdmin(fastify, userId);
    const previousUrl = await readAvatarUrl(fastify, userId);

    const bucket = fastify.supabaseAdmin.storage.from(AVATAR_BUCKET);
    const path = `${userId}/avatar-${randomUUID()}.jpg`;
    const { error: uploadError } = await bucket.upload(path, encoded, { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      request.log.error({ uploadError }, "Échec d'upload de la photo de profil");
      return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
    }
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;

    const { data: updated, error: updateError } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();

    if (updateError || !updated) {
      request.log.error({ updateError }, "Échec de mise à jour de avatar_url");
      // La nouvelle photo ne sert à rien : effacée, l'ancienne reste en place.
      await bucket.remove([path]);
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Ancienne photo effacée, si elle est bien dans le dossier de la personne
    // (ancien nom fixe « avatar.jpg » compris). Un échec ne change rien pour
    // elle : le fichier resté partira avec le compte ; journal sans chemin.
    const previousPath = previousUrl ? extractOwnedStoragePath(previousUrl, AVATAR_BUCKET, userId) : null;
    if (previousUrl && previousPath && previousPath !== path) {
      const cleanup = await removeOwnedFiles(fastify, AVATAR_BUCKET, [{ ownerId: userId, url: previousUrl }]);
      if (cleanup.failed > 0) request.log.warn({ bucket: AVATAR_BUCKET, failed: cleanup.failed }, "Ancienne photo de profil restée dans le stockage");
    }

    const profile = toProfile(updated, await fetchFollowCounts(fastify, userId), admin, await readPrivateAccountInfo(fastify, userId), await mentionsSettingShown(fastify), await profileExtrasShown(fastify), await readReceiptsReady(fastify), await discoveryShown(fastify));
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  }

  // « Supprimer ma photo » (lot « profil et icône des réglages ») : tous les
  // fichiers du dossier de la personne dans le bucket des photos de profil
  // sont effacés D'ABORD (3 essais par appel) ; le profil n'est changé
  // qu'ensuite. Si le stockage refuse, rien n'est changé (503) : jamais une
  // photo « supprimée » encore en ligne. Permis à un compte suspendu : on
  // retire seulement quelque chose de son profil public.
  fastify.delete("/api/me/avatar", { preHandler: [fastify.requireAuth, fastify.rateLimit("avatarWrite")], config: { rateLimitName: "avatarWrite" as const } }, async (request, reply) => {
    const userId = request.user!.id;
    const admin = await isAdmin(fastify, userId);

    const cleanup = await emptyUserFolder(fastify.supabaseAdmin.storage.from(AVATAR_BUCKET), AVATAR_BUCKET, userId);
    if (cleanup.failed > 0 || cleanup.unreadable) {
      request.log.warn({ bucket: AVATAR_BUCKET, failed: cleanup.failed, unreadable: cleanup.unreadable }, "Photo de profil : effacement refusé par le stockage");
      return reply.code(503).send({ error: "storage_failed", message: "La photo n'a pas pu être effacée : rien n'a été changé. Réessayez dans un instant." });
    }

    const { data: updated, error: updateError } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();
    if (updateError || !updated) {
      request.log.error({ updateError }, "Échec de la suppression de avatar_url");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const profile = toProfile(updated, await fetchFollowCounts(fastify, userId), admin, await readPrivateAccountInfo(fastify, userId), await mentionsSettingShown(fastify), await profileExtrasShown(fastify), await readReceiptsReady(fastify), await discoveryShown(fastify));
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  fastify.patch("/api/me", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0];
      if (field === "linkUrl") return reply.code(400).send(issue?.code === "too_big" ? LINK_TOO_LONG : LINK_INVALID);
      return reply.code(400).send({
        error: "invalid_body",
        message: (typeof field === "string" ? UPDATE_ME_MESSAGES[field] : undefined) ?? "Requête invalide.",
      });
    }

    const userId = request.user!.id;
    const { username, displayName } = parsed.data;
    // Lien en bio (lot « vie sociale », migration 0049). Absent : inchangé
    // (une ancienne app qui enregistre le profil ne l'efface jamais). Sans la
    // migration, rien du profil n'est enregistré : l'app ne croit jamais le
    // lien gardé. Le lien n'est jamais journalisé.
    const linkAsked = parsed.data.linkUrl !== undefined;
    let linkUrl: string | null = null;
    if (linkAsked) {
      if (!(await profileExtrasReady(fastify))) return reply.code(404).send(PROFILE_LINK_UNAVAILABLE);
      const link = bioLinkProblem(parsed.data.linkUrl ?? null);
      if (!link.ok) return reply.code(400).send(link.refusal);
      linkUrl = link.url;
    }
    // Bio (lot « profil et icône des réglages ») : lignes vides en trop et
    // espaces retirés, puis 160 caractères et 3 lignes au plus. Le texte de
    // la bio n'est jamais journalisé.
    const bio = normalizeBio(parsed.data.bio ?? "");
    const problem = bioProblem(bio);
    if (problem === "too_long") return reply.code(400).send({ error: "bio_too_long", message: "La bio est trop longue (160 caractères maximum)." });
    if (problem === "too_many_lines") return reply.code(400).send({ error: "bio_too_many_lines", message: "La bio ne peut pas dépasser 3 lignes." });
    // Filtre des mots interdits (chantier 3, règle 1.2 d'Apple) : noms, bio et lien sont vus des autres.
    const linkTexts = linkAsked ? bioLinkTexts(parsed.data.linkUrl ?? null, linkUrl) : [];
    if (firstBannedText(username, displayName, bio, ...linkTexts) !== null) return reply.code(400).send(CONTENT_NOT_ALLOWED);
    // Lu avant toute écriture : une lecture impossible n'enregistre rien.
    const admin = await isAdmin(fastify, userId);
    // Changer le lien (pas le retirer, ni le renvoyer tel quel) : 10 fois par
    // 24 heures. Le lien actuel est lu avant toute écriture.
    if (linkAsked && linkUrl !== null && (await readLinkUrl(fastify, userId)) !== linkUrl && !consumeRateLimit(request, "profileLink")) {
      const rule = RATE_LIMITS.profileLink;
      return reply.code(429).send({ error: rule.error, message: rule.message });
    }

    const { data, error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ username, display_name: displayName, bio: bio === "" ? null : bio, ...(linkAsked ? { link_url: linkUrl } : {}), updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();

    if (error) {
      // Contrainte unique sur `username` violée
      if (error.code === "23505") {
        return reply.code(409).send({ error: "username_taken", message: "Ce nom d'utilisateur est déjà pris." });
      }
      // Contrainte du lien (migration 0049) : la base a refusé ce que le serveur avait accepté.
      if (error.code === "23514" && linkAsked) return reply.code(400).send(LINK_INVALID);
      request.log.error({ error }, "Échec de mise à jour du profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Un profil qu'on vient de compléter n'a par construction encore
    // aucun abonné, abonnement ni publication — pas besoin de requêter les
    // compteurs ici.
    const profile = toProfile(data, { followersCount: 0, followingCount: 0, postsCount: 0 }, admin, await readPrivateAccountInfo(fastify, userId), await mentionsSettingShown(fastify), await profileExtrasShown(fastify), await readReceiptsReady(fastify), await discoveryShown(fastify));
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  // « Qui peut m'envoyer des pièces » (lot 5, 5.C) : les comptes que je suis
  // (par défaut), tout le monde, ou personne. Un réglage de confidentialité :
  // modifiable même par un compte suspendu.
  fastify.put("/api/me/piece-sends-from", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const body = parseInput(updatePieceSendsFromSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ piece_sends_from: body.pieceSendsFrom, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage des pièces reçues");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });

  // « Qui peut m'écrire » (lot messages) : invitations des membres qui ne
  // sont pas vos amis. Un réglage de confidentialité : modifiable même par un
  // compte suspendu. Sans la migration 0032 : indisponible.
  fastify.put("/api/me/messages-from", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await messagesReady(fastify))) return reply.code(404).send(MESSAGES_UNAVAILABLE);
    const body = parseInput(updateMessagesFromSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ messages_from: body.messagesFrom, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage des messages");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });

  // « Confirmations de lecture » (lot « messages vus », migration 0043) :
  // allumé par défaut. Éteint : l'autre membre ne voit plus « Vu » pour vos
  // lectures, et vous ne voyez plus les siennes (lib/readReceipts.ts). Rallumé :
  // seules vos lectures faites à partir de ce moment sont montrées, jamais
  // celles faites pendant qu'il était éteint (saveReadReceipts). Un réglage
  // de confidentialité : modifiable même par un compte suspendu.
  // Sans les messages (0032) ou sans 0043 : indisponible, rien n'est écrit.
  fastify.put("/api/me/read-receipts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await messagesReady(fastify)) || !(await readReceiptsReady(fastify))) return reply.code(404).send(READ_RECEIPTS_UNAVAILABLE);
    const body = parseInput(updateReadReceiptsSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const error = await saveReadReceipts(fastify, request.user!.id, body.readReceipts);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage des confirmations de lecture");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });

  // « Qui peut me mentionner » (lot « vie sociale », migration 0046) : tout le
  // monde, les comptes que je suis (valeur de départ) ou personne. Un réglage
  // de confidentialité : modifiable même par un compte suspendu. Il vaut pour
  // les mentions à venir : celles déjà faites restent, tant que le membre ne
  // les retire pas (DELETE /api/comments/:id/mentions/me). Sans la migration :
  // indisponible.
  fastify.put("/api/me/mentions-from", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await commentThreadsReady(fastify))) return reply.code(404).send(COMMENT_THREADS_UNAVAILABLE);
    const body = parseInput(updateMentionsFromSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ mentions_from: body.mentionsFrom, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage des mentions");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });

  // « Proposer mon compte aux autres membres » (lot « découverte », migration
  // 0050) : allumé au départ. Éteint, ni les publications publiques ni le
  // compte ne sont proposés aux membres qui ne vous suivent pas (« Pour vous »,
  // suggestions) ; vos abonnés et les visiteurs de votre profil les voient
  // comme avant. Un réglage de confidentialité : modifiable même par un compte
  // suspendu. Sans la migration : indisponible.
  fastify.put("/api/me/discoverable", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await discoveryReady(fastify))) return reply.code(404).send(DISCOVERY_SETTING_UNAVAILABLE);
    const body = parseInput(updateDiscoverableSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ discoverable: body.discoverable, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage « Proposer mon compte »");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });

  // « Compte privé » (lot « vie sociale », migration 0045). Un réglage de
  // confidentialité : modifiable même par un compte suspendu. Passer en privé
  // ne change aucune ligne d'autre : les abonnés actuels restent abonnés, et
  // la visibilité enregistrée de chaque publication ne bouge pas. Repasser en
  // public efface D'ABORD les demandes en attente et leurs notifications :
  // personne ne devient abonné sans une décision du propriétaire (les
  // personnes concernées revoient « Suivre »). Sans la migration : indisponible.
  fastify.put("/api/me/private-account", { preHandler: fastify.requireAuth }, async (request, reply) => {
    if (!(await privateAccountsReady(fastify))) return reply.code(404).send(PRIVATE_ACCOUNTS_UNAVAILABLE);
    const body = parseInput(updatePrivateAccountSchema, request.body, reply, { error: "invalid_body", message: "Réglage invalide." });
    if (!body) return;
    const userId = request.user!.id;
    const failed = () => reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });

    if (!body.isPrivate) {
      const requests = await fastify.supabaseAdmin.from("follow_requests").delete().eq("target_id", userId);
      const notices = await fastify.supabaseAdmin.from("notifications").delete().eq("user_id", userId).eq("type", "follow_request");
      if (requests.error || notices.error) {
        // Rien n'est changé : le compte reste privé tant que ses demandes ne sont pas effacées.
        request.log.error({ error: requests.error ?? notices.error }, "Échec de l'effacement des demandes d'abonnement");
        return failed();
      }
    }
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ is_private: body.isPrivate, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour du réglage « compte privé »");
      return failed();
    }
    // Identifications (migration 0047) : en passant en privé, un membre qui
    // n'est pas un abonné accepté ne voit plus aucune publication du compte ;
    // il y perd ses identifications. Échec : journalisé, le compte est déjà privé.
    if (body.isPrivate && (await postExtrasReady(fastify).catch(() => false))) {
      await dropUnseeableTags(fastify, { authorId: userId }).catch(() => request.log.warn("Compte passé en privé : identifications non relues"));
    }
    return reply.code(204).send();
  });

  // Langue de l'interface (lot 3) : choisie sur l'écran Bienvenue ou dans les
  // Réglages, elle fixe aussi la langue des messages du serveur.
  fastify.put("/api/me/locale", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const body = parseInput(updateLocaleSchema, request.body, reply, { error: "invalid_body" });
    if (!body) return;
    const { error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ locale: body.locale, updated_at: new Date().toISOString() })
      .eq("id", request.user!.id);
    if (error) {
      request.log.error({ error }, "Échec de mise à jour de la langue");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    return reply.code(204).send();
  });
}
