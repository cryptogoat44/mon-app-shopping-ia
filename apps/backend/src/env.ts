import "dotenv/config";
import { z } from "zod";
import { SENTRY_EU_DSN_PATTERN } from "./lib/sentry.js";
import { parseMinimumBuild, parseStoreUrl } from "./lib/appVersion.js";
import { parseServedCommit } from "./lib/serverVersion.js";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SERPAPI_KEY: z.string().min(1),
  // Plafond GLOBAL des recherches SerpApi (lot 4 quater, lib/searchCapacity.ts) :
  // par jour (heure de Paris) et par cycle mensuel de SerpApi, qui commence le
  // jour de renouvellement de son quota (le 3 en octobre 2026). Quota réel en
  // octobre 2026 : 250 par mois (offre gratuite) ; la marge de 25 couvre les
  // outils d'essai du fondateur, qui puisent dans le même compte. Changer
  // d'offre ne demande que ces variables (docs/points-de-vigilance.md).
  SERPAPI_DAILY_CAP: z.coerce.number().int().min(1).default(25),
  SERPAPI_MONTHLY_CAP: z.coerce.number().int().min(1).default(225),
  SERPAPI_RENEWAL_DAY: z.coerce.number().int().min(1).max(31).default(3),
  // Part de chaque personne, par jour : qu'une seule personne ne puisse pas
  // épuiser la journée des autres (8 sur 25 : un tiers au plus).
  SERPAPI_USER_DAILY_CAP: z.coerce.number().int().min(1).default(8),
  // Non requis pour que l'app démarre : sans jeton Meta, la reconnaissance
  // automatique Instagram est simplement sautée au profit du repli manuel.
  META_OEMBED_ACCESS_TOKEN: z.string().min(1).optional(),
  // Analyse automatique des vidéos (lot 4, temps 1 bis) : clé secrète
  // d'Anthropic, saisie par le fondateur dans Render. Absente : la fonction se
  // désactive proprement et l'app propose le curseur manuel.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Interrupteurs de la voie C (lot c, 2026-11-02), COUPÉS par défaut. Seule
  // la valeur exacte "true" en allume un ; toute autre valeur (absente,
  // « TRUE », « 1 », « true » suivi d'une espace…) le laisse coupé, sans
  // jamais arrêter le serveur : une faute de frappe dans Render ne doit pas
  // couper toute l'API. Jamais z.coerce.boolean (il lit "false" comme vrai),
  // jamais une liste stricte (elle ferait échouer le démarrage).
  // Lus seulement par lib/aiSwitches.ts. Hors de la liste des variables
  // modifiables par les outils (render-guard) : le fondateur seul les change,
  // à la main, dans le tableau de bord de Render.
  // - VOIE_C_ENABLED : toute la voie C (complément « boutiques » et « Que
  //   cherchez-vous ? »).
  VOIE_C_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  // - VOIE_C_AI_ENABLED : l'étape IA (requête écrite à partir des titres
  //   Lens, texte seulement), tant que ses consignes ne sont pas validées ;
  //   demande aussi ANTHROPIC_API_KEY.
  VOIE_C_AI_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  // - ANTHROPIC_PHOTO_ENABLED : envoi d'une photo d'un utilisateur à
  //   Anthropic. Coupé : tout bloc image est refusé avant l'appel de la voie C
  //   (lib/aiSwitches.ts, assertNoUserImage). Ne couvre PAS l'analyse des
  //   vidéos existante (consentement analyse_video_ia).
  ANTHROPIC_PHOTO_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
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
  // Mise à jour obligatoire de l'app iPhone (lot « app iPhone prête »,
  // lib/appVersion.ts), COUPÉE par défaut. APP_MIN_IOS_BUILD : numéro de build
  // minimal (celui d'EAS et d'App Store Connect, par exemple 12) ; un build
  // plus ancien affiche « Mettez à jour Spotto ». APP_STORE_URL : la fiche de
  // Spotto (https://apps.apple.com/…), pour le bouton de cet écran. Valeur
  // absente ou illisible : aucun minimum, aucun bouton — jamais un arrêt du serveur.
  APP_MIN_IOS_BUILD: z.string().optional().transform(parseMinimumBuild),
  APP_STORE_URL: z.string().optional().transform(parseStoreUrl),
  // Version servie (lot « filets de sécurité », lib/serverVersion.ts) : le
  // commit construit, fourni par Render lui-même (nom à vérifier), renvoyé
  // par /health en 7 caractères. Jamais à saisir à la main ; absente ou
  // illisible : version null, jamais un arrêt du serveur.
  RENDER_GIT_COMMIT: z.string().optional().transform(parseServedCommit),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables d'environnement invalides ou manquantes :");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("\nAstuce : copiez apps/backend/.env.example vers apps/backend/.env et remplissez les valeurs.");
  process.exit(1);
}

export const env = parsed.data;
