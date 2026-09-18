import { createClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";

if (!env.SUPABASE_ANON_KEY) {
  throw new Error(
    "SUPABASE_ANON_KEY doit être définie dans apps/backend/.env pour lancer les tests (voir .env.example)."
  );
}

// Client dédié à la connexion par mot de passe des utilisateurs de test —
// jamais le client service-role de l'app, sinon se connecter avec lui
// écraserait son contexte d'auth et toutes les requêtes admin suivantes
// tourneraient avec le rôle "authenticated" au lieu de "service_role".
const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PASSWORD = "TestPass123!";

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return (Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 4)).slice(-10);
}

export interface TestUser {
  id: string;
  token: string;
  email: string;
  username: string;
}

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

// Crée un vrai utilisateur Supabase (compte + profil + session) — le même
// motif que les scripts de QA manuels utilisés tout au long de cette
// session, formalisé ici pour être rejouable via `pnpm test`.
export async function createTestUser(app: FastifyInstance, label: string): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const email = `test-${label}-${suffix}@example.com`;
  const username = `t${label}${suffix}`.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 20);

  const { data, error } = await app.supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("Échec de création de l'utilisateur de test.");

  const { error: profileError } = await app.supabaseAdmin
    .from("profiles")
    .update({ username, display_name: username })
    .eq("id", data.user.id);
  if (profileError) throw profileError;

  const { data: session, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError || !session.session) throw signInError ?? new Error("Échec de connexion de l'utilisateur de test.");

  return { id: data.user.id, token: session.session.access_token, email, username };
}

export async function deleteTestUser(app: FastifyInstance, userId: string): Promise<void> {
  await app.supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
}

export function authHeaders(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

// Construit un corps multipart/form-data à la main — aucune route testée
// ici ne l'exige typiquement via une bibliothèque cliente, mais les routes
// d'upload du backend (vault, posts, avatar...) n'acceptent que ce format.
export function buildMultipart(
  fields: Record<string, string>,
  file?: { fieldname: string; filename: string; contentType: string; data: Buffer }
): { payload: Buffer; headers: { "content-type": string } } {
  const boundary = `testboundary${uniqueSuffix()}`;
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
      )
    );
    parts.push(file.data);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
