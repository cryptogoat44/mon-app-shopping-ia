import { randomUUID } from "node:crypto";

// Fausse base Supabase en mémoire, pour les tests sans base (aucun réseau) :
// des tables, et juste ce que les routes des messages demandent au client
// (select, insert, upsert, update, delete ; eq, neq, in, is, not, gt, lt ; order,
// limit, range ; single, maybeSingle ; compte exact). Les règles de la base
// utiles à ces tests sont imitées : clés uniques (paire d'une conversation,
// envie une seule fois par collection, une copie par envie), suppressions en
// cascade, et le déclencheur de la migration 0032 (aperçu, ordre, « non lu »).
// Une table absente (`missing`) répond comme une base sans la migration ; de
// même une colonne absente (`missingColumns`, lot modération des
// collections : base sans 0034). Les fonctions de la base (`rpc`) sont
// fournies par le test qui en a besoin ; sinon, elles sont « absentes ».
// Lot « vie sociale » : filtres `or` (fil, notifications) et `ilike`
// (recherche de comptes), une demande d'abonnement par paire de comptes.
// Migration 0046 : réponses, « j'aime » et mentions des commentaires (clés
// uniques, cascades en chaîne à la suppression d'un commentaire).
// Migration 0047 : photos 2 à 5 et personnes identifiées (une position et
// une identification par publication, effacées avec la publication).
// Migration 0048 : publications enregistrées (une par membre et par
// publication, effacées avec la publication ; « sans collection » quand la
// collection est supprimée, comme « on delete set null »).
// Migration 0051 : un nouvel appareil ne reçoit aucune sorte d'activité
// (valeurs par défaut de la base ; celles de 0036 ne sont pas imitées : un
// appareil enregistré sans elles les laisse absentes, comme avant).
// Migration 0057 : une page look par membre et par pièce, un jeton unique.

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

interface DbError {
  code?: string;
  message: string;
}

export interface FakeDbOptions {
  /** Tables absentes (base sans la migration 0032 ou 0033). */
  missing?: string[];
  /** Fait échouer une écriture (table, action) : son erreur est renvoyée. */
  failWrite?: (table: string, action: "insert" | "update" | "delete", values: unknown) => DbError | null;
  /** Colonnes absentes, par table (base sans la migration 0034) : les nommer
   * dans un select, une écriture ou un filtre renvoie l'erreur de Postgres. */
  missingColumns?: Record<string, string[]>;
  /** Le stockage refuse d'effacer (chaque essai compte). */
  failStorageRemove?: () => boolean;
  /** Les fonctions de la base (moderation_apply…), imitées par le test. */
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>;
  /** « Max rows » de Supabase (lot « corrections en ligne ») : une lecture
   * rend au plus ce nombre de lignes, sans erreur ; le compte exact, lui,
   * reste le vrai total. */
  maxRows?: number;
}

const DEFAULTS: Record<string, () => Row> = {
  conversations: () => ({ id: randomUUID(), last_message_id: null, last_sender_id: null, last_message_at: nextTimestamp(), created_at: nextTimestamp() }),
  conversation_participants: () => ({
    invitation: "none",
    invitation_at: null,
    unread: false,
    last_read_at: null,
    cleared_at: null,
    last_message_at: nextTimestamp(),
    created_at: nextTimestamp(),
  }),
  messages: () => ({
    id: randomUUID(),
    body: null,
    wish_title: null,
    wish_image_url: null,
    wish_image_thumb_url: null,
    wish_merchant_name: null,
    wish_merchant_url: null,
    wish_product_match_id: null,
    wish_price_min: null,
    wish_currency: null,
    hidden_at: null,
    created_at: nextTimestamp(),
    // Lot « messages, plus de confort » (migration 0044) ; base sans elle : `missingColumns`.
    reply_to_id: null,
    post_id: null,
    shared_post: false,
    deleted_at: null,
    updated_at: null,
  }),
  // « J'aime » d'un message (migration 0044).
  message_reactions: () => ({ created_at: nextTimestamp() }),
  reports: () => ({ id: randomUUID(), note: null, handled_at: null, moderation_action_id: null, created_at: new Date().toISOString() }),
  // Lot collections (migration 0033).
  collections: () => ({ id: randomUUID(), visibility: "private", visibility_changed_at: null, created_at: nextTimestamp(), updated_at: nextTimestamp() }),
  collection_items: () => ({ id: randomUUID(), created_at: nextTimestamp() }),
  collection_image_copies: () => ({ created_at: nextTimestamp() }),
  wishlist_items: () => ({ id: randomUUID(), reference: null, created_at: nextTimestamp() }),
  // Modération (imitée par les tests de la modération des collections).
  moderation_actions: () => ({ id: randomUUID(), admin_id: null, reason: null, note: null, undoes_action_id: null, automatic: false, created_at: nextTimestamp() }),
  notifications: () => ({ id: randomUUID(), actor_id: null, post_id: null, moderation_action_id: null, read_at: null, hidden_at: null, created_at: nextTimestamp() }),
  // Lot alertes prix et stock (migration 0036) : les valeurs par défaut de la base.
  wish_tracking: () => ({ stock_state: "unknown" }),
  wish_watches: () => ({ notify_price_drop: false, notify_restock: false, notify_sold_out: false, created_at: nextTimestamp(), updated_at: nextTimestamp() }),
  // Historique des consentements (lot « vidéo auto ») : la date de chaque choix.
  consents: () => ({ created_at: nextTimestamp() }),
  // Lot « vie sociale » (migration 0045) : demandes d'abonnement, et les
  // valeurs par défaut des tables sociales écrites par les routes.
  follow_requests: () => ({ created_at: nextTimestamp() }),
  follows: () => ({ created_at: nextTimestamp() }),
  comments: () => ({ id: randomUUID(), parent_id: null, hidden_at: null, created_at: nextTimestamp() }),
  // Migration 0046 : « j'aime » et mentions des commentaires.
  comment_reactions: () => ({ created_at: nextTimestamp() }),
  comment_mentions: () => ({ created_at: nextTimestamp() }),
  post_reactions: () => ({ created_at: nextTimestamp() }),
  // Migration 0047 : photos 2 à 5 et personnes identifiées.
  post_media: () => ({ id: randomUUID(), created_at: nextTimestamp() }),
  post_people_tags: () => ({ created_at: nextTimestamp() }),
  // Migration 0048 : publications enregistrées.
  saved_posts: () => ({ collection_id: null, created_at: nextTimestamp() }),
  // Colonnes que la base remplit seule à la création d'une publication.
  posts: () => ({ id: randomUUID(), wishlist_item_id: null, media_thumb_url: null, media_removed_at: null, hidden_at: null, created_at: nextTimestamp() }),
  // Migration 0051 : aucune sorte d'activité pour un nouvel appareil.
  push_tokens: () => ({ notify_likes: false, notify_comments: false, notify_follows: false, notify_mentions: false }),
  // Migration 0057 : la page look reçoit son identifiant de la base.
  shared_looks: () => ({ id: randomUUID(), image_path: null, created_at: nextTimestamp() }),
};

/** Clés uniques imitées (doublon : erreur 23505, comme Postgres). */
const UNIQUE: Record<string, string[][]> = {
  conversations: [["user_low", "user_high"]],
  message_reactions: [["message_id", "user_id"]],
  collection_items: [["collection_id", "wishlist_item_id"]],
  collection_image_copies: [["wishlist_item_id"]],
  // Lot alertes prix et stock (0036) : un suivi et une cloche par envie.
  wish_tracking: [["wishlist_item_id"]],
  wish_watches: [["wishlist_item_id"]],
  // Lot « vie sociale » (0045) : une demande par paire de comptes.
  follow_requests: [["requester_id", "target_id"]],
  // Migration 0046 : un « j'aime » et une mention par membre et par commentaire.
  comment_reactions: [["comment_id", "user_id"]],
  comment_mentions: [["comment_id", "user_id"]],
  // Migration 0047 : une photo par position, une identification par membre, par publication.
  post_media: [["post_id", "position"]],
  post_people_tags: [["post_id", "user_id"]],
  // Migration 0048 : une publication enregistrée par membre.
  saved_posts: [["user_id", "post_id"]],
  // Migration 0057 : un seul jeton, une page par membre et par pièce.
  shared_looks: [["token"], ["user_id", "match_id"]],
};

/** Suppressions en cascade imitées : en supprimant une ligne de la table,
 * celles des tables filles qui la désignent partent aussi. */
const CASCADES: Record<string, { table: string; column: string }[]> = {
  conversations: [
    { table: "conversation_participants", column: "conversation_id" },
    { table: "messages", column: "conversation_id" },
  ],
  // Migration 0044 : les « j'aime » partent avec le message.
  messages: [{ table: "message_reactions", column: "message_id" }],
  collections: [{ table: "collection_items", column: "collection_id" }],
  wishlist_items: [
    { table: "collection_items", column: "wishlist_item_id" },
    { table: "collection_image_copies", column: "wishlist_item_id" },
    { table: "wish_tracking", column: "wishlist_item_id" },
    { table: "wish_watches", column: "wishlist_item_id" },
    { table: "wish_alert_events", column: "wishlist_item_id" },
  ],
  // Migration 0046 : un commentaire emporte ses réponses, ses « j'aime », ses
  // mentions et les notifications qui le citent (0017).
  comments: [
    { table: "comments", column: "parent_id" },
    { table: "comment_reactions", column: "comment_id" },
    { table: "comment_mentions", column: "comment_id" },
    { table: "notifications", column: "comment_id" },
  ],
  // Migration 0047 : une publication emporte ses photos 2 à 5 et ses identifications.
  posts: [
    { table: "post_media", column: "post_id" },
    { table: "post_people_tags", column: "post_id" },
    // Migration 0048 : et les lignes qui l'enregistrent, chez tous les membres.
    { table: "saved_posts", column: "post_id" },
  ],
};

/** « on delete set null » imités : en supprimant une ligne de la table, la
 * colonne des lignes filles qui la désignent redevient vide. */
const SET_NULL: Record<string, { table: string; column: string }[]> = {
  // Migration 0048 : une collection supprimée garde ses publications enregistrées, sans collection.
  collections: [{ table: "saved_posts", column: "collection_id" }],
};

// Dates strictement croissantes, jamais avant l'heure réelle (les routes
// écrivent aussi des dates : refus, lecture), avec des microsecondes comme Postgres.
let clock = 0;
let micro = 0;
function nextTimestamp(): string {
  clock = Math.max(clock, Date.now()) + 1000;
  micro = (micro + 137) % 1000;
  return new Date(clock).toISOString().replace("Z", `${String(micro).padStart(3, "0")}+00:00`);
}

function pick(row: Row, columns: string): Row {
  if (columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const column of columns.split(",").map((c) => c.trim()).filter(Boolean)) out[column] = row[column] ?? null;
  return out;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return String(a) < String(b) ? -1 : 1;
}

function listOf(value: string): string[] {
  return value.replace(/^\(|\)$/g, "").split(",").filter(Boolean);
}

/** Découpe « a,b(c,d),e » aux virgules du premier niveau seulement. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/** Un terme d'un filtre `or` de PostgREST : « col.eq.v », « col.is.null »,
 * « col.in.(a,b) », « col.not.in.(a,b) » ou « and(terme,terme) ». Tout autre
 * terme relève une erreur : jamais un filtre ignoré en silence. */
function orTerm(term: string): Filter {
  if (term.startsWith("and(") && term.endsWith(")")) {
    const inner = topLevelParts(term.slice(4, -1)).map(orTerm);
    return (row) => inner.every((filter) => filter(row));
  }
  const [column, ...rest] = term.split(".");
  const expression = rest.join(".");
  if (!column) throw new Error(`fakeSupabase : filtre « or » illisible (${term})`);
  if (expression.startsWith("eq.")) return (row) => String(row[column]) === expression.slice(3);
  if (expression === "is.null") return (row) => (row[column] ?? null) === null;
  if (expression.startsWith("not.in.")) {
    const excluded = listOf(expression.slice(7));
    return (row) => (row[column] ?? null) !== null && !excluded.includes(String(row[column]));
  }
  if (expression.startsWith("in.")) {
    const wanted = listOf(expression.slice(3));
    return (row) => wanted.includes(String(row[column]));
  }
  throw new Error(`fakeSupabase : filtre « or » inconnu (${term})`);
}

export function fakeSupabase(options: FakeDbOptions = {}) {
  const tables = new Map<string, Row[]>();
  const uploads: string[] = [];
  const removed: string[] = [];
  const deletedUsers: string[] = [];
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  /** Le déclencheur de 0032 : aperçu de la conversation, ordre, « non lu ». */
  function afterMessageInsert(message: Row) {
    for (const conversation of table("conversations")) {
      if (conversation.id === message.conversation_id && String(conversation.last_message_at) <= String(message.created_at)) {
        Object.assign(conversation, { last_message_id: message.id, last_sender_id: message.sender_id, last_message_at: message.created_at });
      }
    }
    for (const side of table("conversation_participants")) {
      if (side.conversation_id !== message.conversation_id) continue;
      side.last_message_at = message.created_at;
      if (side.user_id !== message.sender_id) side.unread = true;
    }
  }

  /** Suppressions en cascade, en chaîne (une réponse emporte ses « j'aime »). */
  function cascade(name: string, deleted: Row[]) {
    const ids = new Set<unknown>(deleted.map((row) => row.id).filter((id) => id !== undefined && id !== null));
    if (ids.size === 0) return;
    for (const child of CASCADES[name] ?? []) {
      const gone = table(child.table).filter((row) => ids.has(row[child.column]));
      if (gone.length === 0) continue;
      tables.set(child.table, table(child.table).filter((row) => !gone.includes(row)));
      cascade(child.table, gone);
    }
    for (const child of SET_NULL[name] ?? []) {
      for (const row of table(child.table)) if (ids.has(row[child.column])) row[child.column] = null;
    }
  }

  function from(name: string) {
    const filters: Filter[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let action: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    // upsert : colonnes du conflit (comme Postgres, deux NULL ne se rencontrent jamais).
    let conflict: string[] = [];
    let columns = "*";
    let countExact = false;
    let head = false;
    let limit: number | null = null;
    let range: [number, number] | null = null;
    let values: Row | Row[] | null = null;
    let returning = false;

    const named: string[] = [];

    function run(mode: "many" | "single" | "maybe"): { data: unknown; error: DbError | null; count?: number | null } {
      if (options.missing?.includes(name)) return { data: null, error: { code: "42P01", message: `relation "${name}" does not exist` } };
      const absent = options.missingColumns?.[name] ?? [];
      const written = action === "insert" || action === "upsert" || action === "update" ? (Array.isArray(values) ? values : [values ?? {}]).flatMap((value) => Object.keys(value)) : [];
      const asked = [...named, ...written, ...(columns.trim() === "*" ? [] : columns.split(",").map((c) => c.trim()))];
      const unknownColumn = asked.find((column) => absent.includes(column));
      if (unknownColumn) return { data: null, error: { code: "42703", message: `column ${name}.${unknownColumn} does not exist` } };
      const rows = table(name);
      if (action === "upsert") {
        const failure = options.failWrite?.(name, "insert", values);
        if (failure) return { data: null, error: failure };
        const written: Row[] = [];
        for (const value of Array.isArray(values) ? values : [values!]) {
          const existing = rows.find((row) => conflict.length > 0 && conflict.every((column) => value[column] != null && row[column] === value[column]));
          if (existing) {
            Object.assign(existing, value);
            written.push(existing);
          } else {
            const row = { ...(DEFAULTS[name]?.() ?? {}), ...value };
            rows.push(row);
            written.push(row);
          }
        }
        const data = written.map((row) => pick(row, columns));
        return mode === "many" ? { data: returning ? data : null, error: null } : { data: data[0] ?? null, error: null };
      }
      if (action === "insert") {
        const failure = options.failWrite?.(name, "insert", values);
        if (failure) return { data: null, error: failure };
        const list = (Array.isArray(values) ? values : [values!]).map((value) => ({ ...(DEFAULTS[name]?.() ?? {}), ...value }));
        for (const columns of UNIQUE[name] ?? []) {
          const key = (row: Row) => JSON.stringify(columns.map((column) => row[column]));
          const seen = new Set(rows.map(key));
          for (const row of list) {
            if (seen.has(key(row))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            seen.add(key(row));
          }
        }
        rows.push(...list);
        if (name === "messages") list.forEach(afterMessageInsert);
        const data = list.map((row) => pick(row, columns));
        return mode === "many" ? { data: returning ? data : null, error: null } : { data: data[0] ?? null, error: null };
      }
      const matching = rows.filter((row) => filters.every((filter) => filter(row)));
      // Lignes rendues par une écriture suivie de select() : une seule avec single()/maybeSingle().
      const returned = (written: Row[]): { data: unknown; error: DbError | null } => {
        if (!returning) return { data: null, error: null };
        const data = written.map((row) => pick(row, columns));
        if (mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
        if (mode === "maybe") return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      if (action === "update") {
        const failure = options.failWrite?.(name, "update", values);
        if (failure) return { data: null, error: failure };
        for (const row of matching) Object.assign(row, values);
        return returned(matching);
      }
      if (action === "delete") {
        const failure = options.failWrite?.(name, "delete", null);
        if (failure) return { data: null, error: failure };
        tables.set(
          name,
          rows.filter((row) => !matching.includes(row))
        );
        cascade(name, matching);
        return returned(matching);
      }
      let result = [...matching];
      for (const order of [...orders].reverse()) {
        result.sort((a, b) => (order.ascending ? 1 : -1) * compare(a[order.column], b[order.column]));
      }
      const count = result.length;
      if (range) result = result.slice(range[0], range[1] + 1);
      if (limit !== null) result = result.slice(0, limit);
      if (options.maxRows !== undefined) result = result.slice(0, options.maxRows);
      const data = result.map((row) => pick(row, columns));
      if (head) return { data: null, error: null, count };
      if (mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (mode === "maybe") return { data: data[0] ?? null, error: null };
      return { data, error: null, count: countExact ? count : null };
    }

    const chain = {
      select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
        columns = cols;
        if (action !== "select") returning = true;
        countExact = opts?.count === "exact";
        head = opts?.head === true;
        return chain;
      },
      insert(value: Row | Row[]) {
        action = "insert";
        values = value;
        return chain;
      },
      upsert(value: Row | Row[], opts?: { onConflict?: string }) {
        action = "upsert";
        values = value;
        conflict = (opts?.onConflict ?? "").split(",").map((column) => column.trim()).filter(Boolean);
        return chain;
      },
      update(value: Row) {
        action = "update";
        values = value;
        return chain;
      },
      delete() {
        action = "delete";
        return chain;
      },
      eq(column: string, value: unknown) {
        named.push(column);
        filters.push((row) => row[column] === value);
        return chain;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== null && row[column] !== value);
        return chain;
      },
      in(column: string, list: unknown[]) {
        filters.push((row) => list.includes(row[column]));
        return chain;
      },
      is(column: string, value: null) {
        named.push(column);
        filters.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      not(column: string, operator: "in" | "is", value: unknown) {
        if (operator === "in") {
          const excluded = listOf(String(value));
          filters.push((row) => !excluded.includes(String(row[column])));
        } else {
          filters.push((row) => (row[column] ?? null) !== value);
        }
        return chain;
      },
      // Au moins un des termes (syntaxe de PostgREST, voir orTerm).
      or(expression: string) {
        const terms = topLevelParts(expression).map(orTerm);
        filters.push((row) => terms.some((filter) => filter(row)));
        return chain;
      },
      // Comme Postgres : « % » vaut n'importe quel texte, sans tenir compte de la casse.
      ilike(column: string, pattern: string) {
        named.push(column);
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
        const regex = new RegExp(`^${escaped}$`, "i");
        filters.push((row) => typeof row[column] === "string" && regex.test(row[column] as string));
        return chain;
      },
      // Comme Postgres : une valeur vide n'est ni plus grande ni plus petite qu'une autre.
      gt(column: string, value: string) {
        named.push(column);
        filters.push((row) => row[column] != null && String(row[column]) > value);
        return chain;
      },
      gte(column: string, value: string) {
        filters.push((row) => row[column] != null && String(row[column]) >= value);
        return chain;
      },
      lt(column: string, value: string) {
        filters.push((row) => row[column] != null && String(row[column]) < value);
        return chain;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orders.push({ column, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      range(start: number, end: number) {
        range = [start, end];
        return Promise.resolve(run("many"));
      },
      abortSignal() {
        return chain;
      },
      single: () => Promise.resolve(run("single")),
      maybeSingle: () => Promise.resolve(run("maybe")),
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run("many")).then(resolve, reject);
      },
    };
    return chain;
  }

  // Fichiers du stockage (« bucket/chemin » → contenu) : un envoi sans
  // « upsert » sur un chemin déjà pris est refusé, comme chez Supabase ;
  // list() rend les fichiers d'un dossier (lot « profil et icône des réglages »).
  const files = new Map<string, Buffer>();
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body?: unknown, uploadOptions?: { upsert?: boolean }) => {
        const key = `${bucket}/${path}`;
        if (files.has(key) && !uploadOptions?.upsert) return { error: { message: "The resource already exists", statusCode: "409" } };
        uploads.push(key);
        files.set(key, Buffer.isBuffer(body) ? body : Buffer.alloc(0));
        return { error: null };
      },
      // Déplace un fichier (nouveau nom) ; refusé si la source manque ou si la cible existe.
      move: async (fromPath: string, toPath: string) => {
        const source = files.get(`${bucket}/${fromPath}`);
        if (options.failStorageRemove?.() || source === undefined || files.has(`${bucket}/${toPath}`)) return { data: null, error: { message: "déplacement refusé" } };
        files.delete(`${bucket}/${fromPath}`);
        files.set(`${bucket}/${toPath}`, source);
        return { data: { message: "Successfully moved" }, error: null };
      },
      remove: async (paths: string[]) => {
        if (options.failStorageRemove?.()) return { data: null, error: { message: "panne simulée du stockage" } };
        removed.push(...paths.map((path) => `${bucket}/${path}`));
        for (const path of paths) files.delete(`${bucket}/${path}`);
        return { error: null };
      },
      list: async (folder = "", listOptions?: { limit?: number; offset?: number }) => {
        const prefix = `${bucket}/${folder}/`;
        const names = [...files.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .map((key) => key.slice(prefix.length))
          .sort();
        const offset = listOptions?.offset ?? 0;
        return { data: names.slice(offset, offset + (listOptions?.limit ?? 100)).map((name) => ({ name, id: name })), error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${STORAGE_ORIGIN}/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  };

  const auth = {
    admin: {
      deleteUser: async (userId: string) => {
        deletedUsers.push(userId);
        return { error: null };
      },
    },
  };

  const rpc = async (fn: string, args: Record<string, unknown> = {}) =>
    options.rpc ? options.rpc(fn, args) : { data: null, error: { code: "PGRST202", message: "absente" } };
  return { db: { from, storage, auth, rpc }, tables, table, uploads, removed, files, deletedUsers };
}

/** Origine du stockage des tests (celle de SUPABASE_URL dans tests:hors-base). */
export const STORAGE_ORIGIN = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "http://127.0.0.1:9";
