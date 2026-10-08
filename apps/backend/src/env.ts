import "dotenv/config";
import { z } from "zod";
import { SENTRY_EU_DSN_PATTERN } from "./lib/sentry.js";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SERPAPI_KEY: z.string().min(1),
  // Plafond GLOBAL des recherches SerpApi (lot 4 quater, lib/searchCapacity.ts) :
  // par jour (heure de Paris) et sur 31 jours glissants. Quota réel en
  // octobre 2026 : 250 par mois (offre gratuite) ; la marge de 25 couvre les
  // outils d'essai du fondateur, qui puisent dans le même compte.
  SERPAPI_DAILY_CAP: z.coerce.number().int().min(1).default(25),
  SERPAPI_MONTHLY_CAP: z.coerce.number().int().min(1).default(225),
  // Non requis pour que l'app démarre : sans jeton Meta, la reconnaissance
  // automatique Instagram est simplement sautée au profit du repli manuel.
  META_OEMBED_ACCESS_TOKEN: z.string().min(1).optional(),
  // Analyse automatique des vidéos (lot 4, temps 1 bis) : clé secrète
  // d'Anthropic, saisie par le fondateur dans Render. Absente : la fonction se
  // désactive proprement et l'app propose le curseur manuel.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Non requis à l'exécution (jamais utilisée par le serveur lui-même) —
  // seulement par les tests, pour se connecter en tant qu'utilisateur de
  // test via mot de passe. Clé publique, sans risque à exiger.
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().default(3000),
  // Suivi des erreurs (lot 2) : facultatif ; sans DSN, rien n'est envoyé.
  // La région UE est imposée : adresse d'envoi en « ingest.de.sentry.io ».
  SENTRY_DSN: z
    .string()
    .regex(SENTRY_EU_DSN_PATTERN, "SENTRY_DSN doit être une adresse Sentry de la région UE (ingest.de.sentry.io).")
    .optional(),
  SENTRY_ENVIRONMENT: z.enum(["development", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables d'environnement invalides ou manquantes :");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("\nAstuce : copiez apps/backend/.env.example vers apps/backend/.env et remplissez les valeurs.");
  process.exit(1);
}

export const env = parsed.data;
