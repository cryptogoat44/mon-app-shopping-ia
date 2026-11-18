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
// - jamais une lecture du passé : une lecture n'est montrée que si elle a
//   été faite pendant que le réglage de la personne qui lit était allumé, et
//   après que « Vu » a existé pour elle. profiles.read_receipts_since garde
//   ce moment (la migration pour les membres déjà inscrits, la création du
//   profil pour les nouveaux, puis chaque fois que le réglage est rallumé) :
//   une lecture d'avant n'est jamais montrée, même plus tard (shownReadAt,
//   sinceStamp). La date de la lecture elle-même reste écrite comme avant
//   (compteurs de non-lus, export) ;
// - jamais pour un compte suspendu : ce qu'il lit n'est plus montré à
//   l'autre membre. Un blocage, lui, cache déjà toute la conversation
//   (routes/conversations.ts) : cette lecture n'est alors jamais faite ;
// - sans la migration 0043, ou si une lecture de la base échoue : rien.
//   Jamais « allumé » par défaut : personne n'est exposé avant de pouvoir
//   refuser.
// - réciproque dans le temps aussi : une lecture n'est montrée que si elle a
//   été faite pendant que les DEUX réglages étaient allumés. La borne est la
//   plus tardive des deux dates « depuis » (laterSince) : rallumer son
//   réglage un instant ne fait pas apparaître ce que l'autre a lu pendant
//   qu'il était éteint ;
// - jamais l'heure d'une lecture : l'app ne reçoit pas la date à laquelle
//   l'autre membre a ouvert la conversation (elle bougerait à chaque
//   ouverture, et dirait quand il regarde). Elle reçoit la date du dernier
//   message de la personne qui regarde, quand la lecture le couvre
//   (seenStamp) : un oui ou un non, rien de plus.
// Ce que l'app reçoit : null (rien à montrer), ou { seenAt } : la date de
// VOTRE dernier message si l'autre membre a ouvert la conversation après lui
// (« Vu ») ; null sinon (« Envoyé » : pas encore lu, ou pas par une lecture
// qui peut être montrée).
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConversationReadReceipts } from "@monapp/shared-types";
import { SIDE_COLUMNS, SIDE_ROWS, messageActionsReady, type Side } from "./messaging.js";
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
 * Deux moments la bornent ; une lecture d'avant l'un ou l'autre n'est jamais
 * montrée, même plus tard :
 * - `since` (profiles.read_receipts_since de ce membre) : depuis quand ses
 *   lectures peuvent être montrées. Avant : « Vu » n'existait pas encore pour
 *   lui, ou son réglage était éteint. Absent ou illisible : rien ;
 * - `invitation_at`, la dernière réponse à une invitation : pour un côté
 *   ouvert, le moment où la conversation s'est ouverte (null : ouverte dès
 *   le premier message, entre amis). Avant : la personne invitée regardait
 *   l'invitation.
 * Les dates sont comparées à la milliseconde ; sinceStamp et la migration
 * 0043 placent `since` au moins une milliseconde après toute lecture déjà
 * faite. Date illisible : rien. */
export function shownReadAt(side: Pick<Side, "invitation" | "invitation_at" | "last_read_at">, since: string | null | undefined): string | null {
  if (side.invitation !== "none" || side.last_read_at === null || typeof since !== "string") return null;
  const readAt = Date.parse(side.last_read_at);
  const sinceAt = Date.parse(since);
  if (!Number.isFinite(readAt) || !Number.isFinite(sinceAt) || readAt < sinceAt) return null;
  if (side.invitation_at === null) return side.last_read_at;
  const openedAt = Date.parse(side.invitation_at);
  return Number.isFinite(openedAt) && readAt >= openedAt ? side.last_read_at : null;
}

/** La plus tardive de deux dates « depuis » : le moment à partir duquel les
 * réglages des DEUX membres sont allumés ensemble. Une lecture d'avant n'est
 * montrée à aucun des deux (réciprocité). L'une des deux absente ou
 * illisible : null, rien n'est montré. */
export function laterSince(a: string | null | undefined, b: string | null | undefined): string | null {
  if (typeof a !== "string" || typeof b !== "string") return null;
  const aAt = Date.parse(a);
  const bAt = Date.parse(b);
  if (!Number.isFinite(aAt) || !Number.isFinite(bAt)) return null;
  return bAt > aAt ? b : a;
}

/** Ce que l'app reçoit à la place de l'heure de la lecture : la date du
 * dernier message de la personne qui regarde (`ownLastMessageAt`, tel que sa
 * conversation le montre) si la lecture `readAt` le couvre, null sinon
 * (aucune lecture à montrer, aucun message d'elle, date illisible). L'heure
 * de la lecture elle-même ne sort jamais du serveur. */
export function seenStamp(readAt: string | null, ownLastMessageAt: string | null | undefined): string | null {
  if (readAt === null || typeof ownLastMessageAt !== "string") return null;
  const read = Date.parse(readAt);
  const sent = Date.parse(ownLastMessageAt);
  return Number.isFinite(read) && Number.isFinite(sent) && read >= sent ? ownLastMessageAt : null;
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

/** La date à écrire dans profiles.read_receipts_since quand ce membre
 * rallume « Confirmations de lecture » : maintenant (horloge du serveur, la
 * même que celle des lectures : une lecture faite juste après est montrée),
 * et dans tous les cas APRÈS sa lecture la plus récente déjà enregistrée
 * (`latestReadAt`, toutes conversations confondues ; null : aucune). readStamp
 * peut dater une lecture de quelques instants « dans le futur » (dernier
 * message daté par la base, en avance) : sans cela, une lecture faite réglage
 * éteint, puis le réglage rallumé aussitôt, serait montrée. Une milliseconde
 * après elle : shownReadAt compare à la milliseconde. Cas limite assumé : si
 * la base avance sur le serveur, rouvrir la même conversation dans ces
 * quelques instants laisse « Envoyé » jusqu'à la lecture suivante. */
export function sinceStamp(latestReadAt: string | null, now: number): string {
  const latest = latestReadAt === null ? Number.NaN : Date.parse(latestReadAt);
  return new Date(Number.isFinite(latest) && latest >= now ? Math.floor(latest) + 1 : now).toISOString();
}

// ---- Schéma de la base (migration 0043) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0043 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    // Les DEUX colonnes de 0043 : sans la date « depuis », rien n'est montré non plus.
    const { error } = await fastify.supabaseAdmin.from("profiles").select("read_receipts, read_receipts_since").limit(0);
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

// Une ligne sans réponse nette (colonne vide) vaut « éteint » ; sans date
// « depuis », aucune lecture de ce membre n'est montrée.
const SETTING_ROWS = z.array(z.object({ id: z.guid(), read_receipts: z.boolean().nullable().optional(), read_receipts_since: z.string().nullable().optional() }));

const OWN_MESSAGE_ROWS = z.array(z.object({ created_at: z.string() }));

/** La date du dernier message de ce membre, tel que sa conversation le
 * montre (routes/conversations.ts, readThreadMessages) : jamais un message
 * masqué par la modération, ni d'avant ce qu'il a effacé de son côté. null :
 * aucun. Lot « messages, plus de confort » : jamais non plus un message
 * qu'il a supprimé (« Vu » ne s'affiche pas sous « Message supprimé » : la
 * date renvoyée est celle d'un message encore montré). La colonne n'est
 * nommée que si la base a la migration 0044, sondée à part : 0043 fonctionne
 * sans 0044, et l'inverse. */
async function ownLastMessageAt(fastify: FastifyInstance, mine: Side): Promise<string | null> {
  let builder = fastify.supabaseAdmin.from("messages").select("created_at").eq("conversation_id", mine.conversation_id).eq("sender_id", mine.user_id).is("hidden_at", null);
  if (await messageActionsReady(fastify)) builder = builder.is("deleted_at", null);
  if (mine.cleared_at) builder = builder.gt("created_at", mine.cleared_at);
  const rows = parseDbRows(OWN_MESSAGE_ROWS, await builder.order("created_at", { ascending: false }).limit(1), "Dernier message de la personne qui regarde");
  return rows[0]?.created_at ?? null;
}

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
        .select("id, read_receipts, read_receipts_since")
        .in("id", members)
        .then((result) => parseDbRows(SETTING_ROWS, result, "Réglage « Confirmations de lecture »")),
      suspendedAmong(fastify, [theirs.user_id]),
    ]);
    // Les deux réglages, allumés tous les deux (un profil introuvable : rien).
    if (!members.every((id) => settings.some((row) => row.id === id && row.read_receipts === true))) return null;
    if (suspended.has(theirs.user_id)) return null;
    // Sa lecture, seulement si elle a été faite pendant que les DEUX réglages étaient allumés.
    const since = (id: string) => settings.find((row) => row.id === id)?.read_receipts_since;
    const readAt = shownReadAt(theirs, laterSince(since(mine.user_id), since(theirs.user_id)));
    if (readAt === null) return { seenAt: null };
    // Jamais l'heure de cette lecture : la date de MON dernier message, si elle le couvre.
    return { seenAt: seenStamp(readAt, await ownLastMessageAt(fastify, mine)) };
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

// ---- Écriture du réglage ----

const LATEST_READ_ROWS = z.array(z.object({ last_read_at: z.string().nullable() }));

/** Enregistre le réglage « Confirmations de lecture » de ce membre.
 * Éteindre : le réglage seul. Allumer : le réglage ET la date « depuis »
 * (sinceStamp), en UNE écriture qui ne touche la ligne que si le réglage
 * était éteint (`read_receipts = false` dans la condition, jamais lu puis
 * écrit) : rallumer un réglage déjà allumé ne déplace pas la date, deux
 * demandes en même temps non plus (une seule trouve la ligne éteinte).
 * Rend l'erreur de la base, ou null. */
export async function saveReadReceipts(fastify: Pick<FastifyInstance, "supabaseAdmin">, userId: string, on: boolean, now: () => number = Date.now): Promise<unknown> {
  if (!on) {
    const { error } = await fastify.supabaseAdmin.from("profiles").update({ read_receipts: false, updated_at: new Date(now()).toISOString() }).eq("id", userId);
    return error ?? null;
  }
  // Sa lecture la plus récente, toutes conversations confondues (invitations comprises).
  const latest = await fastify.supabaseAdmin
    .from("conversation_participants")
    .select("last_read_at")
    .eq("user_id", userId)
    .not("last_read_at", "is", null)
    .order("last_read_at", { ascending: false })
    .limit(1);
  if (latest.error) return latest.error;
  const rows = LATEST_READ_ROWS.safeParse(latest.data ?? []);
  if (!rows.success) return new Error("Dernière lecture illisible");
  // L'heure est prise APRÈS cette lecture de la base, au plus près de l'écriture.
  const at = now();
  const { error } = await fastify.supabaseAdmin
    .from("profiles")
    .update({ read_receipts: true, read_receipts_since: sinceStamp(rows.data[0]?.last_read_at ?? null, at), updated_at: new Date(at).toISOString() })
    .eq("id", userId)
    .eq("read_receipts", false);
  return error ?? null;
}
