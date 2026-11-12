import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { encodeAvatar, isOtherImageFormat } from "../lib/photos.js";
import { z } from "zod";
import {
  APP_LOCALES,
  AVATAR_MAX_BYTES,
  DEFAULT_MESSAGES_FROM,
  MESSAGES_FROM,
  PIECE_SENDS_FROM,
  PRIVACY_LEVELS,
  bioProblem,
  normalizeBio,
  type Profile,
} from "@monapp/shared-types";
import { DatabaseReadError, parseInput } from "../lib/validation.js";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { GENERIC_SERVER_ERROR } from "../lib/messages.js";
import { isAdmin } from "../lib/moderation.js";
import { CONTENT_NOT_ALLOWED, firstBannedText } from "../lib/contentFilter.js";
import { MESSAGES_UNAVAILABLE, messagesReady } from "../lib/messaging.js";
import { emptyUserFolder, extractOwnedStoragePath, removeOwnedFiles } from "../lib/storage.js";
import { AVATAR_BUCKET } from "../lib/profileModeration.js";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
/** Bio reçue, avant d'en retirer espaces et lignes vides en trop. */
const BIO_RAW_MAX_LENGTH = 1000;

const updateMeSchema = z.object({
  username: z
    .string()
    .toLowerCase()
    .regex(USERNAME_REGEX, "3 à 20 caractères : lettres minuscules, chiffres, underscore."),
  displayName: z.string().trim().min(1).max(60),
  // Bio : normalisée puis contrôlée dans la route (160 caractères, 3 lignes :
  // normalizeBio, bioProblem). Ici, seul un texte démesuré est écarté d'emblée.
  bio: z.string().max(BIO_RAW_MAX_LENGTH, "La bio est trop longue (160 caractères maximum).").nullable().optional(),
});

const updateLocaleSchema = z.object({ locale: z.enum(APP_LOCALES) });
const updatePieceSendsFromSchema = z.object({ pieceSendsFrom: z.enum(PIECE_SENDS_FROM) });
const updateMessagesFromSchema = z.object({ messagesFrom: z.enum(MESSAGES_FROM) });

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
  created_at: z.string(),
  updated_at: z.string(),
});

interface ProfileCounts {
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

/** Profil renvoyé à l'app ; null si la ligne lue n'a pas la forme attendue. */
function toProfile(row: unknown, counts: ProfileCounts, admin: boolean): Profile | null {
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

const PROFILE_UNREADABLE = { error: "internal_error", message: GENERIC_SERVER_ERROR } as const;

export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/api/me", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    // Rôle administrateur illisible : la requête échoue (500), jamais « non administrateur » par défaut.
    const [{ data, error }, counts, admin] = await Promise.all([
      fastify.supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
      fetchFollowCounts(fastify, userId),
      isAdmin(fastify, userId),
    ]);

    if (error || !data) {
      request.log.error({ error }, "Profil introuvable pour un utilisateur authentifié");
      return reply.code(404).send({ error: "profile_not_found", message: "Profil introuvable." });
    }

    const profile = toProfile(data, counts, admin);
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
  fastify.post("/api/me/avatar", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    const userId = request.user!.id;

    const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES } });
    if (!file || !file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "invalid_file", message: "Merci d'envoyer une image." });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "file_too_large", message: "La photo est trop lourde (5 Mo maximum)." });
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

    const profile = toProfile(updated, await fetchFollowCounts(fastify, userId), admin);
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  // « Supprimer ma photo » (lot « profil et icône des réglages ») : tous les
  // fichiers du dossier de la personne dans le bucket des photos de profil
  // sont effacés D'ABORD (3 essais par appel) ; le profil n'est changé
  // qu'ensuite. Si le stockage refuse, rien n'est changé (503) : jamais une
  // photo « supprimée » encore en ligne. Permis à un compte suspendu : on
  // retire seulement quelque chose de son profil public.
  fastify.delete("/api/me/avatar", { preHandler: fastify.requireAuth }, async (request, reply) => {
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

    const profile = toProfile(updated, await fetchFollowCounts(fastify, userId), admin);
    if (!profile) {
      request.log.error("Profil illisible");
      return reply.code(500).send(PROFILE_UNREADABLE);
    }
    return reply.send(profile);
  });

  fastify.patch("/api/me", { preHandler: [fastify.requireAuth, fastify.requireActiveAccount] }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        message: parsed.error.issues[0]?.message ?? "Requête invalide.",
      });
    }

    const userId = request.user!.id;
    const { username, displayName } = parsed.data;
    // Bio (lot « profil et icône des réglages ») : lignes vides en trop et
    // espaces retirés, puis 160 caractères et 3 lignes au plus. Le texte de
    // la bio n'est jamais journalisé.
    const bio = normalizeBio(parsed.data.bio ?? "");
    const problem = bioProblem(bio);
    if (problem === "too_long") return reply.code(400).send({ error: "bio_too_long", message: "La bio est trop longue (160 caractères maximum)." });
    if (problem === "too_many_lines") return reply.code(400).send({ error: "bio_too_many_lines", message: "La bio ne peut pas dépasser 3 lignes." });
    // Filtre des mots interdits (chantier 3, règle 1.2 d'Apple) : noms et bio sont vus des autres.
    if (firstBannedText(username, displayName, bio) !== null) return reply.code(400).send(CONTENT_NOT_ALLOWED);
    // Lu avant toute écriture : une lecture impossible n'enregistre rien.
    const admin = await isAdmin(fastify, userId);

    const { data, error } = await fastify.supabaseAdmin
      .from("profiles")
      .update({ username, display_name: displayName, bio: bio === "" ? null : bio, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("*")
      .single();

    if (error) {
      // Contrainte unique sur `username` violée
      if (error.code === "23505") {
        return reply.code(409).send({ error: "username_taken", message: "Ce nom d'utilisateur est déjà pris." });
      }
      request.log.error({ error }, "Échec de mise à jour du profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Un profil qu'on vient de compléter n'a par construction encore
    // aucun abonné, abonnement ni publication — pas besoin de requêter les
    // compteurs ici.
    const profile = toProfile(data, { followersCount: 0, followingCount: 0, postsCount: 0 }, admin);
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
