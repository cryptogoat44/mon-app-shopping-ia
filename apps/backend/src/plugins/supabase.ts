import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Client Supabase avec la clé service_role : accès total, contourne RLS.
     * À utiliser uniquement pour des opérations serveur légitimes. */
    supabaseAdmin: SupabaseClient;
  }
}

export default fp(async function supabasePlugin(fastify: FastifyInstance) {
  const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  fastify.decorate("supabaseAdmin", supabaseAdmin);
});
