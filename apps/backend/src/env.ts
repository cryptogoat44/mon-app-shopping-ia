import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
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
