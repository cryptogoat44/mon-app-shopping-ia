// Confirmations de lecture (lot « messages vus », migration 0043). Dans une
// conversation ouverte, la personne qui a écrit voit « Vu » sous son dernier
// message quand l'autre membre a ouvert la conversation après ce message,
// « Envoyé » sinon. Le serveur décide seul de ce qu'il montre :
// - réciproque : dès que l'un des deux membres a éteint « Confirmations de
//   lecture » (profiles.read_receipts), aucun des deux ne reçoit rien ;
// - jamais pour une invitation : rien tant que la conversation n'est pas
//   ouverte des DEUX côtés (la personne qui invite n'apprend pas si son
//   invitation a été regardée, lib/messaging.ts), et une lecture faite AVANT
//   l'ouverture n'est jamais montrée ensuite (shownReadAt) ;
// - jamais pour un compte suspendu : ce qu'il lit n'est plus montré à
//   l'autre membre. Un blocage, lui, cache déjà toute la conversation
//   (routes/conversations.ts) : cette lecture n'est alors jamais faite ;
// - sans la migration 0043, ou si une lecture de la base échoue : rien.
//   Jamais « allumé » par défaut : personne n'est exposé avant de pouvoir
//   refuser.
// Ce que l'app reçoit : null (rien à montrer), ou { seenAt }, la dernière
// ouverture de la conversation par l'autre membre (null : pas encore).
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConversationReadReceipts } from "@monapp/shared-types";
import { SIDE_COLUMNS, SIDE_ROWS, type Side } from "./messaging.js";
import { suspendedAmong } from "./moderation.js";
import { parseDbRows } from "./validation.js";

export const READ_RECEIPTS_UNAVAILABLE = {
  error: "read_receipts_unavailable",
  message: "Les confirmations de lecture ne sont pas encore disponibles.",
} as const;

// ---- Règles, sans réseau ----

/** La conversation est ouverte aux deux membres : ni invitation envoyée ou
 * reçue, ni invitation refusée, d'un côté comme de l'autre. */
export function openBothWays(mine: Pick<Side, "invitation"> | null, theirs: Pick<Side, "invitation"> | null): boolean {
  return mine?.invitation === "none" && theirs?.invitation === "none";
}

/** La dernière lecture de ce membre que l'autre peut connaître, ou null.
 * `invitation_at` date la dernière réponse à une invitation : pour un côté
 * ouvert, le moment où la conversation s'est ouverte (null : ouverte dès le
 * premier message, entre amis). Une lecture d'AVANT ce moment — la personne
 * invitée qui regarde l'invitation — n'est jamais montrée, même une fois la
 * conversation ouverte : tout ce qui sort d'ici date de l'ouverture ou
 * d'après. Les deux dates viennent de l'horloge du serveur. Date illisible :
 * rien. */
export function shownReadAt(side: Pick<Side, "invitation" | "invitation_at" | "last_read_at">): string | null {
  if (side.invitation !== "none" || side.last_read_at === null) return null;
  if (side.invitation_at === null) return Number.isFinite(Date.parse(side.last_read_at)) ? side.last_read_at : null;
  const readAt = Date.parse(side.last_read_at);
  const openedAt = Date.parse(side.invitation_at);
  return Number.isFinite(readAt) && Number.isFinite(openedAt) && readAt >= openedAt ? side.last_read_at : null;
}

/** La date à écrire quand ce membre marque sa conversation comme lue :
 * maintenant (horloge du serveur). Dans une conversation ouverte, jamais
 * avant le dernier message qu'il vient de lire : les messages sont datés par
 * la base, dont l'horloge peut avancer de quelques instants sur celle du
 * serveur, et ce message resterait « Envoyé » pour la personne qui l'a écrit.
 * Pour une invitation reçue, toujours l'horloge du serveur, comme la date de
 * son acceptation : shownReadAt compare deux dates de la même horloge. */
export function readStamp(side: Pick<Side, "invitation" | "last_message_at">, now: number): string {
  const lastMessageAt = Date.parse(side.last_message_at);
  return side.invitation === "none" && Number.isFinite(lastMessageAt) && lastMessageAt > now ? side.last_message_at : new Date(now).toISOString();
}

// ---- Schéma de la base (migration 0043) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0043 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("profiles").select("read_receipts").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Confirmations de lecture coupées : migration 0043 absente");
  } catch {
    fastify.log.warn({ code: null }, "Confirmations de lecture coupées : schéma illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0043 ? Même sonde que pour les messages
 * (lib/messaging.ts) : mémorisée une fois vue ; absente, un avertissement,
 * puis la sonde n'est refaite qu'au bout de 5 minutes. Sans elle : aucune
 * confirmation de lecture, et le réglage n'est pas proposé. */
export async function readReceiptsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  if (schemaReadyAt !== null) return true;
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return false;
  schemaProbe ??= probeSchema(fastify)
    .then((ready) => {
      if (ready) schemaReadyAt = now();
      else schemaMissingAt = now();
      return ready;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** Tests seulement : oublie la sonde. */
export function resetReadReceiptsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

// ---- Lecture ----

// Une ligne sans réponse nette (colonne vide) vaut « éteint ».
const SETTING_ROWS = z.array(z.object({ id: z.guid(), read_receipts: z.boolean().nullable().optional() }));

/** Ce que `mine.user_id` peut savoir des lectures de l'autre membre (règles
 * en tête de fichier). `mine` et `theirs` : les deux côtés de la
 * conversation, tels qu'ils viennent d'être lus. Ne relève jamais d'erreur :
 * une lecture impossible vaut « rien à montrer », la conversation et l'envoi
 * d'un message continuent sans. */
export async function readReceiptsFor(fastify: FastifyInstance, log: FastifyBaseLogger, mine: Side | null, theirs: Side | null): Promise<ConversationReadReceipts | null> {
  if (!mine || !theirs || !openBothWays(mine, theirs)) return null;
  try {
    if (!(await readReceiptsReady(fastify))) return null;
    const members = [mine.user_id, theirs.user_id];
    const [settings, suspended] = await Promise.all([
      fastify.supabaseAdmin
        .from("profiles")
        .select("id, read_receipts")
        .in("id", members)
        .then((result) => parseDbRows(SETTING_ROWS, result, "Réglage « Confirmations de lecture »")),
      suspendedAmong(fastify, [theirs.user_id]),
    ]);
    // Les deux réglages, allumés tous les deux (un profil introuvable : rien).
    if (!members.every((id) => settings.some((row) => row.id === id && row.read_receipts === true))) return null;
    if (suspended.has(theirs.user_id)) return null;
    return { seenAt: shownReadAt(theirs) };
  } catch {
    // Colonne disparue (retour en arrière de 0043) ou panne : la sonde est
    // refaite. Ni identifiant ni détail au journal.
    resetReadReceiptsProbe();
    log.warn("Confirmations de lecture : lecture impossible, rien n'est montré");
    return null;
  }
}

/** Les mêmes confirmations juste après l'envoi d'un message, pour
 * l'expéditeur : les deux côtés sont relus (l'envoi vient peut-être d'ouvrir
 * la conversation). Ne relève jamais d'erreur. */
export async function readReceiptsAfterSend(fastify: FastifyInstance, log: FastifyBaseLogger, conversationId: string, senderId: string): Promise<ConversationReadReceipts | null> {
  try {
    const sides = parseDbRows(
      SIDE_ROWS,
      await fastify.supabaseAdmin.from("conversation_participants").select(SIDE_COLUMNS).eq("conversation_id", conversationId),
      "Côtés d'une conversation"
    );
    return await readReceiptsFor(
      fastify,
      log,
      sides.find((side) => side.user_id === senderId) ?? null,
      sides.find((side) => side.user_id !== senderId) ?? null
    );
  } catch {
    log.warn("Confirmations de lecture : lecture impossible, rien n'est montré");
    return null;
  }
}
