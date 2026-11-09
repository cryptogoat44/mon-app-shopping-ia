import { randomUUID } from "node:crypto";

// Fausse base Supabase en mémoire, pour les tests sans base (aucun réseau) :
// des tables, et juste ce que les routes des messages demandent au client
// (select, insert, update, delete ; eq, neq, in, is, not, gt, lt ; order,
// limit, range ; single, maybeSingle ; compte exact). Les règles de la base
// utiles à ces tests sont imitées : paire unique d'une conversation, et le
// déclencheur de la migration 0032 (aperçu, ordre, « non lu »).
// Une table absente (`missing`) répond comme une base sans la migration.

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

interface DbError {
  code?: string;
  message: string;
}

export interface FakeDbOptions {
  /** Tables absentes (base sans la migration 0032). */
  missing?: string[];
  /** Fait échouer une écriture (table, action) : son erreur est renvoyée. */
  failWrite?: (table: string, action: "insert" | "update" | "delete", values: unknown) => DbError | null;
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
    let action: "select" | "insert" | "update" | "delete" = "select";
    let columns = "*";
    let countExact = false;
    let head = false;
    let limit: number | null = null;
    let range: [number, number] | null = null;
    let values: Row | Row[] | null = null;
    let returning = false;

    function run(mode: "many" | "single" | "maybe"): { data: unknown; error: DbError | null; count?: number | null } {
      if (options.missing?.includes(name)) return { data: null, error: { code: "42P01", message: `relation "${name}" does not exist` } };
      const rows = table(name);
      if (action === "insert") {
        const failure = options.failWrite?.(name, "insert", values);
        if (failure) return { data: null, error: failure };
        const list = (Array.isArray(values) ? values : [values!]).map((value) => ({ ...(DEFAULTS[name]?.() ?? {}), ...value }));
        if (name === "conversations") {
          for (const row of list) {
            if (rows.some((other) => other.user_low === row.user_low && other.user_high === row.user_high)) {
              return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
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
        if (name === "conversations") {
          const ids = new Set(matching.map((row) => row.id));
          tables.set("conversation_participants", table("conversation_participants").filter((row) => !ids.has(row.conversation_id)));
          tables.set("messages", table("messages").filter((row) => !ids.has(row.conversation_id)));
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

  return { db: { from, storage, auth, rpc: async () => ({ data: null, error: { code: "PGRST202", message: "absente" } }) }, tables, table, uploads, removed, deletedUsers };
}

/** Origine du stockage des tests (celle de SUPABASE_URL dans tests:hors-base). */
export const STORAGE_ORIGIN = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "http://127.0.0.1:9";
