import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SERPAPI_KEY: z.string().min(1),
  // Non requis pour que l'app démarre : sans jeton Meta, la reconnaissance
  // automatique Instagram est simplement sautée au profit du repli manuel.
  META_OEMBED_ACCESS_TOKEN: z.string().min(1).optional(),
  PORT: z.coerce.number().default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables d'environnement invalides ou manquantes :");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("\nAstuce : copiez apps/backend/.env.example vers apps/backend/.env et remplissez les valeurs.");
  process.exit(1);
}

export const env = parsed.data;
