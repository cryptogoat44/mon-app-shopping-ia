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
  }),
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
};

/** Clés uniques imitées (doublon : erreur 23505, comme Postgres). */
const UNIQUE: Record<string, string[][]> = {
  conversations: [["user_low", "user_high"]],
  collection_items: [["collection_id", "wishlist_item_id"]],
  collection_image_copies: [["wishlist_item_id"]],
  // Lot alertes prix et stock (0036) : un suivi et une cloche par envie.
  wish_tracking: [["wishlist_item_id"]],
  wish_watches: [["wishlist_item_id"]],
};

/** Suppressions en cascade imitées : en supprimant une ligne de la table,
 * celles des tables filles qui la désignent partent aussi. */
const CASCADES: Record<string, { table: string; column: string }[]> = {
  conversations: [
    { table: "conversation_participants", column: "conversation_id" },
    { table: "messages", column: "conversation_id" },
  ],
  collections: [{ table: "collection_items", column: "collection_id" }],
  wishlist_items: [
    { table: "collection_items", column: "wishlist_item_id" },
    { table: "collection_image_copies", column: "wishlist_item_id" },
    { table: "wish_tracking", column: "wishlist_item_id" },
    { table: "wish_watches", column: "wishlist_item_id" },
    { table: "wish_alert_events", column: "wishlist_item_id" },
  ],
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
      if (action === "update") {
        const failure = options.failWrite?.(name, "update", values);
        if (failure) return { data: null, error: failure };
        for (const row of matching) Object.assign(row, values);
        return { data: returning ? matching.map((row) => pick(row, columns)) : null, error: null };
      }
      if (action === "delete") {
        const failure = options.failWrite?.(name, "delete", null);
        if (failure) return { data: null, error: failure };
        tables.set(
          name,
          rows.filter((row) => !matching.includes(row))
        );
        const ids = new Set(matching.map((row) => row.id));
        for (const child of CASCADES[name] ?? []) {
          tables.set(child.table, table(child.table).filter((row) => !ids.has(row[child.column])));
        }
        return { data: returning ? matching.map((row) => pick(row, columns)) : null, error: null };
      }
      let result = [...matching];
      for (const order of [...orders].reverse()) {
        result.sort((a, b) => (order.ascending ? 1 : -1) * compare(a[order.column], b[order.column]));
      }
      const count = result.length;
      if (range) result = result.slice(range[0], range[1] + 1);
      if (limit !== null) result = result.slice(0, limit);
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
      gt(column: string, value: string) {
        filters.push((row) => String(row[column]) > value);
        return chain;
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column]) >= value);
        return chain;
      },
      lt(column: string, value: string) {
        filters.push((row) => String(row[column]) < value);
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

  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        uploads.push(`${bucket}/${path}`);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        if (options.failStorageRemove?.()) return { data: null, error: { message: "panne simulée du stockage" } };
        removed.push(...paths.map((path) => `${bucket}/${path}`));
        return { error: null };
      },
      list: async () => ({ data: [], error: null }),
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
  return { db: { from, storage, auth, rpc }, tables, table, uploads, removed, deletedUsers };
}

/** Origine du stockage des tests (celle de SUPABASE_URL dans tests:hors-base). */
export const STORAGE_ORIGIN = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "http://127.0.0.1:9";
