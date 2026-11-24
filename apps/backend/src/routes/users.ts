import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MEMBER_LIST_PAGE_SIZE,
  PINNED_POSTS_MAX,
  PRIVATE_ACCOUNT_ERROR,
  type FriendVaultPage,
  type FriendWishPage,
  type MemberPage,
  type PublicProfile,
  type UserPostsPage,
  type UserProfile,
  type VaultCategory,
} from "@monapp/shared-types";
import { DatabaseReadError, INVALID_CURSOR, INVALID_ID, cursorQuerySchema, parseDbRows, parseInput, userIdParamsSchema, webUrlOrNull } from "../lib/validation.js";
import { shownPosts, visiblePrivacies } from "../lib/visibility.js";
import { canSeeAuthorContent, readAudience, readAudienceOf } from "../lib/audience.js";
import { followStateOf, toMemberRows } from "../lib/memberRows.js";
import { withoutSuspendedFaces } from "../lib/profileModeration.js";
import { notInFilter, reportedIdsFor } from "../lib/reportedByViewer.js";
import { profileExtrasShown } from "../lib/profileExtras.js";
import { POST_ROWS, hydratePosts, type PostRow } from "./posts.js";
import { NO_SHELVES, friendShelvesFor, type FriendShelves } from "../lib/friendShelves.js";
import { collectionsReady, ownCopyUrl, readCopies, syncFriendCopiesQuietly } from "../lib/collections.js";
import { fetchAffiliateUrls, isAffiliateLink } from "../lib/affiliateLinks.js";
import { fetchHdImageUrls } from "../lib/pieceImages.js";

const USER_POSTS_PAGE_SIZE = 18;

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40),
});

/** Ce que le profil d'un membre montre aux autres (lien en bio : migration 0049). */
const PROFILE_COLUMNS = "id, username, display_name, avatar_url, bio";
const STORED_PROFILE = z
  .object({ id: z.guid(), username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable(), bio: z.string().nullable(), link_url: z.string().nullable().optional() })
  .nullable();

/** Une ligne de `follows`, lue du côté qui intéresse la liste. */
const FOLLOW_ROWS = z.array(z.object({ follower_id: z.guid(), followee_id: z.guid(), created_at: z.string() }));

// ---- Étagères des amis (migration 0058, lib/friendShelves.ts) ----

/** Envies ou pièces par page, sur le profil d'un ami. */
const SHELF_PAGE_SIZE = 24;
/** Le curseur est un simple rang (jamais une date d'ajout). */
const shelfQuerySchema = z.object({ cursor: z.string().regex(/^\d{1,6}$/).transform(Number).optional() });
/** Temps laissé aux copies des images d'une page avant de répondre ; les
 * copies continuent ensuite (elles seront là à la prochaine ouverture). */
const SHELF_COPY_WAIT_MS = 4_000;

// Ce que les amis peuvent lire d'une envie : jamais image_url (l'adresse du
// marchand), reference (une note de la personne), ni rien des alertes.
const FRIEND_WISH_ROWS = z.array(
  z.object({
    id: z.guid(),
    title: z.string(),
    price_min: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
    merchant_name: z.string().nullable(),
    merchant_url: z.string().nullable(),
    product_match_id: z.guid().nullable(),
  })
);
// Ce que les amis peuvent lire d'une pièce du Vault : jamais created_at,
// verified, affiliate_conversion_id. product_match_id sert seulement à
// retrouver l'image HD, jamais renvoyé.
const FRIEND_VAULT_ROWS = z.array(
  z.object({ id: z.guid(), title: z.string(), category: z.string(), image_url: z.string(), product_match_id: z.guid().nullable() })
);

/** Page vide : la même pour tout refus, et pour un ami qui n'a rien. */
const emptyShelf = (): FriendWishPage & FriendVaultPage => ({ items: [], nextCursor: null });

/** Attend `work` au plus `ms` millisecondes, sans jamais échouer. */
async function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work.catch(() => undefined), new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  if (timer) clearTimeout(timer);
}

/** Les étagères de `ownerId` ouvertes à `viewerId` (lib/friendShelves.ts).
 * Les Envies demandent aussi les copies des images (migration 0033) : sans
 * elles, rien. Toute lecture impossible : DatabaseReadError. */
async function openShelves(fastify: FastifyInstance, viewerId: string, ownerId: string): Promise<FriendShelves> {
  const shelves = await friendShelvesFor(fastify, viewerId, ownerId);
  if (!shelves.wishes && !shelves.vault) return NO_SHELVES;
  return { wishes: shelves.wishes && (await collectionsReady(fastify)), vault: shelves.vault };
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export default async function usersRoutes(fastify: FastifyInstance) {
  fastify.get("/api/users/search", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", message: "Requête de recherche invalide." });
    }

    const userId = request.user!.id;
    const query = parsed.data.q.toLowerCase();
    const pattern = `%${query}%`;

    // Deux requêtes séparées et paramétrées plutôt qu'un .or() construit par
    // interpolation de chaîne : la syntaxe de filtre PostgREST donne un sens
    // spécial à la virgule et aux parenthèses, donc injecter le texte tapé
    // par l'utilisateur directement dedans permettrait de manipuler le
    // filtre plutôt que de simplement chercher ce texte.
    const [byUsername, byDisplayName] = await Promise.all([
      fastify.supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .not("username", "is", null)
        .neq("id", userId)
        .ilike("username", pattern)
        .limit(20),
      fastify.supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .not("username", "is", null)
        .neq("id", userId)
        .ilike("display_name", pattern)
        .limit(20),
    ]);

    if (byUsername.error || byDisplayName.error) {
      request.log.error({ error: byUsername.error ?? byDisplayName.error }, "Échec de recherche de profils");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const seenIds = new Set<string>();
    const candidateRows: ProfileRow[] = [];
    for (const row of [...(byUsername.data ?? []), ...(byDisplayName.data ?? [])] as ProfileRow[]) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      candidateRows.push(row);
      if (candidateRows.length >= 20) break;
    }

    // Une seule lecture groupée (lib/audience.ts). Invisibilité mutuelle : un
    // profil bloqué par moi, ou qui m'a bloqué, n'apparaît dans aucune
    // recherche ; un compte suspendu par la modération non plus (lot 5). Un
    // compte privé apparaît, avec son nom et sa photo seulement (comme sur
    // son profil), et l'app y propose « Suivre » ou « Demandé ».
    const audiences = await readAudience(
      fastify,
      userId,
      candidateRows.map((p) => p.id)
    );
    const results: PublicProfile[] = candidateRows.flatMap((row) => {
      const audience = audiences.get(row.id);
      if (!audience || audience.blocked || audience.suspended) return [];
      return [
        {
          id: row.id,
          username: row.username!,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          isFollowing: audience.follows,
          isPrivate: audience.isPrivate,
          followState: followStateOf(audience),
        },
      ];
    });

    return reply.send(results);
  });

  // Profil d'un autre utilisateur (Lot Q, décision 6) : identité, bio et
  // nombres d'abonnés / d'abonnements. JAMAIS le nombre de pièces du Vault ;
  // le Vault et les Envies seulement par leurs propres routes, et seulement
  // si leur propriétaire les montre à ses amis (migration 0058, plus bas). Un blocage, dans un sens ou dans l'autre, rend le profil
  // introuvable (404, sans dire pourquoi). Lot « conformité Apple » : la bio
  // et la photo d'un compte suspendu ne sont montrées qu'à lui-même.
  // Lien en bio (migration 0049) : comme la bio, jamais celui d'un compte
  // suspendu ; et, comme les publications, seulement pour qui voit le contenu
  // du compte (jamais pour qui n'est pas un abonné accepté d'un compte privé).
  fastify.get("/api/users/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const notFound = () => reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });

    const withLink = await profileExtrasShown(fastify);
    const answer = await fastify.supabaseAdmin
      .from("profiles")
      .select(withLink ? `${PROFILE_COLUMNS}, link_url` : PROFILE_COLUMNS)
      .eq("id", targetId)
      .maybeSingle();
    const read = STORED_PROFILE.safeParse(answer.data);
    if (answer.error || !read.success) throw new DatabaseReadError("Lecture d'un profil impossible");
    const stored = read.data;
    // Profil pas encore complété (sans nom d'utilisateur) : pas de page publique.
    if (!stored || !stored.username) return notFound();
    const isMe = targetId === viewerId;
    const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false });
    if (audience.blocked) return notFound();
    const [row] = await withoutSuspendedFaces(
      fastify,
      [{ id: stored.id, username: stored.username, display_name: stored.display_name, avatar_url: stored.avatar_url, bio: stored.bio, ...(withLink ? { link_url: stored.link_url ?? null } : {}) }],
      viewerId
    );
    if (!row) return notFound();

    // Compte privé (migration 0045) : qui n'est pas un abonné accepté ne voit
    // que nom, photo, bio et compteurs d'abonnés et d'abonnements ; jamais le
    // nombre de publications (0), ni rien d'autre.
    const privacies = canSeeAuthorContent(audience) ? visiblePrivacies(isMe, audience.follows, audience.isPrivate) : [];
    const [followers, following, posts] = await Promise.all([
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", targetId),
      fastify.supabaseAdmin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", targetId),
      // Nombre de publications que CE visiteur peut voir (le même que la
      // grille) : ne révèle jamais l'existence de publications privées ni masquées.
      privacies.length > 0
        ? shownPosts(fastify, "id", { count: "exact", head: true }).eq("user_id", targetId).in("privacy", privacies)
        : Promise.resolve({ count: 0 }),
    ]);

    const profile: UserProfile = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      followersCount: followers.count ?? 0,
      followingCount: following.count ?? 0,
      postsCount: posts.count ?? 0,
      isFollowing: audience.follows,
      isMe,
      isPrivate: audience.isPrivate,
      followState: followStateOf(audience),
      // Rien de plus pour qui n'est pas un abonné accepté d'un compte privé (ni même un champ vide).
      ...(withLink && canSeeAuthorContent(audience) ? { linkUrl: row.link_url ?? null } : {}),
    };
    // Étagères des amis (migration 0058) : annoncées seulement quand au moins
    // une est ouverte à CE visiteur ; sinon, aucun champ. Lecture impossible :
    // rien d'annoncé (jamais ouvert par défaut), le profil reste lisible.
    if (!isMe) {
      try {
        const shelves = await openShelves(fastify, viewerId, targetId);
        if (shelves.wishes || shelves.vault) profile.friendShelves = { wishes: shelves.wishes, vault: shelves.vault };
      } catch {
        request.log.warn("Étagères des amis : lecture impossible, aucune annoncée");
      }
    }
    reply.header("Cache-Control", "no-store");
    return reply.send(profile);
  });

  // Ses publications, chacune selon SA confidentialité : publique pour
  // tous, « abonnés » pour ses abonnés, privée pour personne d'autre.
  // Compte privé : seulement pour ses abonnés acceptés.
  // Épingles (migration 0049) : la PREMIÈRE page porte aussi `pinned`, ses
  // publications épinglées (3 au plus, les plus récemment épinglées d'abord),
  // filtrées exactement comme la page (masquées, confidentialité, compte
  // privé, signalées par le visiteur). Elles restent aussi à leur place dans
  // `posts` : une ancienne app les y montre comme avant.
  fastify.get("/api/users/:userId/posts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const viewerId = request.user!.id;
    const targetId = params.userId;
    const isMe = targetId === viewerId;

    const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false, requested: false });
    if (audience.blocked) {
      return reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
    }
    // Compte privé : rien pour qui n'est pas un abonné accepté, quelle que
    // soit la visibilité de chaque publication — et aucune lecture des publications.
    const privacies = canSeeAuthorContent(audience) ? visiblePrivacies(isMe, audience.follows, audience.isPrivate) : [];
    // Compte privé, pour qui n'est pas un abonné accepté : rien, pas même une liste d'épingles vide.
    if (privacies.length === 0) return reply.send({ posts: [], nextCursor: null });
    const withPins = !pageQuery.cursor && (await profileExtrasShown(fastify));

    let query = shownPosts(fastify, "*")
      .eq("user_id", targetId)
      .in("privacy", privacies)
      .order("created_at", { ascending: false })
      .limit(USER_POSTS_PAGE_SIZE + 1);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
    // Chantier 3 : les publications que le visiteur a signalées ne lui sont plus montrées.
    const reported = isMe ? null : notInFilter(await reportedIdsFor(fastify, request.log, viewerId, "post"));
    if (reported) query = query.not("id", "in", reported);

    const [{ data, error }, pinnedRows] = await Promise.all([query, withPins ? readPinnedRows(targetId, privacies, reported) : Promise.resolve(null)]);
    if (error) {
      request.log.error({ error }, "Échec de lecture des publications d'un profil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const rows = parseDbRows(POST_ROWS, { data, error: null }, "Publications d'un profil");
    const hasMore = rows.length > USER_POSTS_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, USER_POSTS_PAGE_SIZE) : rows;
    // Une seule préparation pour la page et les épingles (sans doublon).
    const pageIds = new Set(pageRows.map((row) => row.id));
    const hydrated = await hydratePosts(fastify, [...pageRows, ...(pinnedRows ?? []).filter((row) => !pageIds.has(row.id))], viewerId);
    const byId = new Map(hydrated.map((post) => [post.id, post]));
    const page: UserPostsPage = {
      posts: pageRows.flatMap((row) => byId.get(row.id) ?? []),
      nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
      ...(pinnedRows ? { pinned: pinnedRows.flatMap((row) => byId.get(row.id) ?? []) } : {}),
    };
    return reply.send(page);
  });

  /** Les publications épinglées d'un membre (migration 0049), filtrées comme
   * la page : jamais une masquée, jamais hors des confidentialités permises,
   * jamais une signalée par le visiteur. Des photos seulement ; les 3 plus
   * récemment épinglées (deux épingles au même instant peuvent en laisser 4
   * dans la base). Lecture impossible : null (la page part sans `pinned`,
   * jamais une liste non filtrée). */
  async function readPinnedRows(targetId: string, privacies: string[], reported: string | null): Promise<PostRow[] | null> {
    let query = shownPosts(fastify, "*")
      .eq("user_id", targetId)
      .eq("type", "lifestyle")
      .in("privacy", privacies)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false })
      .limit(PINNED_POSTS_MAX);
    if (reported) query = query.not("id", "in", reported);
    const { data, error } = await query;
    const parsed = POST_ROWS.safeParse(data ?? []);
    if (error || !parsed.success) {
      fastify.log.warn("Publications épinglées d'un profil : lecture impossible");
      return null;
    }
    return parsed.data;
  }

  // Étagères des amis (lot « étagères des amis », migration 0058) : les Envies
  // et le Vault d'un ami, en lecture seule, s'il a choisi de les montrer à ses
  // amis. Pour tout autre visiteur (pas ami, simple abonné, blocage dans un
  // sens ou dans l'autre, compte suspendu, réglage éteint, migration absente) :
  // une page vide, exactement comme un ami qui n'a rien, sans dire pourquoi.
  // Relu à chaque page (rien n'est gardé) ; aucune notification, aucune trace
  // de qui a regardé. Une lecture impossible : erreur, jamais rien d'ouvert.
  const shelfOptions = {
    preHandler: [fastify.requireAuth, fastify.rateLimit("friendShelfRead")],
    config: { rateLimitName: "friendShelfRead" as const },
  };

  // Ses Envies : titre, copie de l'image faite par Spotto (jamais l'adresse du
  // marchand), prix, boutique et lien. Jamais sa note, ses alertes, le nom de
  // ses collections, les pièces reçues ni la recherche d'origine. Les copies
  // sont faites à la demande, quand un ami ouvre vraiment la page (jamais en
  // masse quand le réglage est allumé) : au plus SHELF_PAGE_SIZE par page,
  // une seule fois chacune ; une copie impossible : l'envie sans image.
  fastify.get("/api/users/:userId/wishlist", shelfOptions, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(shelfQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const ownerId = params.userId;
    if (!(await openShelves(fastify, request.user!.id, ownerId)).wishes) return reply.send(emptyShelf());

    const offset = pageQuery.cursor ?? 0;
    const rows = parseDbRows(
      FRIEND_WISH_ROWS,
      await fastify.supabaseAdmin
        .from("wishlist_items")
        .select("id, title, price_min, currency, merchant_name, merchant_url, product_match_id")
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + SHELF_PAGE_SIZE),
      "Envies d'un ami"
    );
    const hasMore = rows.length > SHELF_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, SHELF_PAGE_SIZE) : rows;
    const wishIds = pageRows.map((row) => row.id);

    let copies = await readCopies(fastify, ownerId, wishIds);
    const missing = wishIds.filter((id) => !copies.has(id));
    if (missing.length > 0) {
      await waitAtMost(syncFriendCopiesQuietly(fastify, request.log, ownerId, missing), SHELF_COPY_WAIT_MS);
      copies = await readCopies(fastify, ownerId, wishIds);
    }
    const affiliateUrls = await fetchAffiliateUrls(fastify, [...new Set(pageRows.flatMap((row) => (row.product_match_id ? [row.product_match_id] : [])))]);
    const page: FriendWishPage = {
      items: pageRows.map((row) => {
        const copy = copies.get(row.id);
        const imageUrl = copy ? ownCopyUrl(copy.image_url, ownerId) : null;
        const imageThumbUrl = copy ? ownCopyUrl(copy.image_thumb_url, ownerId) : null;
        const affiliateUrl = row.product_match_id ? (affiliateUrls.get(row.product_match_id) ?? null) : null;
        return {
          id: row.id,
          title: row.title,
          // Les deux tailles ou aucune : jamais une image à moitié.
          imageUrl: imageUrl && imageThumbUrl ? imageUrl : null,
          imageThumbUrl: imageUrl && imageThumbUrl ? imageThumbUrl : null,
          merchantName: row.merchant_name,
          merchantUrl: webUrlOrNull(affiliateUrl ?? row.merchant_url),
          isAffiliate: isAffiliateLink(affiliateUrl, row.merchant_url),
          priceMin: row.price_min === null ? null : Number(row.price_min),
          currency: row.currency,
        };
      }),
      nextCursor: hasMore ? String(offset + SHELF_PAGE_SIZE) : null,
    };
    return reply.send(page);
  });

  // Son Vault : nom, catégorie et l'image que la pièce affiche (sa propre
  // photo, ou l'image du marchand chargée depuis le site du marchand), comme
  // une publication « achat ». Jamais la date d'ajout, « achat vérifié », la
  // recherche d'origine ni le nombre de pièces.
  fastify.get("/api/users/:userId/vault", shelfOptions, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const pageQuery = parseInput(shelfQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const ownerId = params.userId;
    if (!(await openShelves(fastify, request.user!.id, ownerId)).vault) return reply.send(emptyShelf());

    const offset = pageQuery.cursor ?? 0;
    const rows = parseDbRows(
      FRIEND_VAULT_ROWS,
      await fastify.supabaseAdmin
        .from("vault_items")
        .select("id, title, category, image_url, product_match_id")
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + SHELF_PAGE_SIZE),
      "Vault d'un ami"
    );
    const hasMore = rows.length > SHELF_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, SHELF_PAGE_SIZE) : rows;
    const hdUrls = await fetchHdImageUrls(fastify, pageRows);
    const page: FriendVaultPage = {
      items: pageRows.map((row, index) => ({
        id: row.id,
        title: row.title,
        category: row.category as VaultCategory,
        imageUrl: webUrlOrNull(row.image_url),
        imageHdUrl: webUrlOrNull(hdUrls[index] ?? null),
      })),
      nextCursor: hasMore ? String(offset + SHELF_PAGE_SIZE) : null,
    };
    return reply.send(page);
  });

  // Listes des abonnés et des abonnements d'un membre (lot « vie sociale »,
  // sans migration), les plus récents d'abord, 30 lignes lues par page.
  //   - Le membre lit ses deux listes ; un autre ne les lit que s'il peut voir
  //     son contenu (canSeeAuthorContent) : jamais à travers un blocage (404,
  //     comme un profil inconnu), jamais un compte privé sans en être un
  //     abonné accepté (403).
  //   - Chaque ligne passe par LA règle des listes (lib/memberRows.ts) : pas
  //     de compte bloqué avec le lecteur, suspendu, sans nom d'utilisateur, ni
  //     de compte privé montré à un inconnu. Le tri se fait APRÈS la lecture :
  //     une page peut être plus courte que prévu, ou vide, alors qu'il en
  //     reste ; le curseur est la date de la dernière ligne LUE, et la réponse
  //     ne dit jamais combien de lignes ont été laissées de côté.
  //   - Jamais la date d'un abonnement dans une ligne.
  // Sans la migration 0045, tous les comptes sont publics : les listes marchent.
  const memberListOptions = {
    preHandler: [fastify.requireAuth, fastify.rateLimit("memberList")],
    config: { rateLimitName: "memberList" as const },
  };
  for (const kind of ["followers", "following"] as const) {
    // Abonnés : les lignes où le membre est suivi. Abonnements : celles où il suit.
    const ownerColumn = kind === "followers" ? "followee_id" : "follower_id";
    const memberColumn = kind === "followers" ? "follower_id" : "followee_id";

    fastify.get(`/api/users/:userId/${kind}`, memberListOptions, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
      if (!pageQuery) return;
      const viewerId = request.user!.id;
      const targetId = params.userId;

      const stored = await fastify.supabaseAdmin.from("profiles").select("id, username").eq("id", targetId).maybeSingle();
      if (stored.error) {
        request.log.error({ error: stored.error }, "Échec de lecture du profil d'une liste de membres");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }
      // Inconnu, profil pas encore complété, ou blocage dans un sens ou dans l'autre : la même réponse.
      const notFound = () => reply.code(404).send({ error: "user_not_found", message: "Profil introuvable." });
      if (!stored.data || !stored.data.username) return notFound();
      const audience = await readAudienceOf(fastify, viewerId, targetId, { suspended: false, requested: false });
      if (audience.blocked) return notFound();
      if (!canSeeAuthorContent(audience)) {
        return reply.code(403).send({ error: PRIVATE_ACCOUNT_ERROR, message: "Ce compte est privé." });
      }

      let query = fastify.supabaseAdmin
        .from("follows")
        .select("follower_id, followee_id, created_at")
        .eq(ownerColumn, targetId)
        .order("created_at", { ascending: false })
        .limit(MEMBER_LIST_PAGE_SIZE + 1);
      if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
      const rows = parseDbRows(FOLLOW_ROWS, await query, kind === "followers" ? "Abonnés d'un membre" : "Abonnements d'un membre");
      const hasMore = rows.length > MEMBER_LIST_PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, MEMBER_LIST_PAGE_SIZE) : rows;

      const page: MemberPage = {
        members: await toMemberRows(
          fastify,
          viewerId,
          pageRows.map((row) => row[memberColumn]),
          { contextOwnerId: targetId }
        ),
        nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
      };
      return reply.send(page);
    });
  }
}
