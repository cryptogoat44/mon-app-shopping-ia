// Mesure de la voie C : options de la commande, garde « spotto-dev-2
// seulement », environnement du serveur local, et masquage des secrets dans
// tout ce que l'outil affiche ou écrit. Logique pure, testée
// (tests/mesureVoieC.test.ts).
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "dotenv";
import { assertDevDatabaseUrl, assertDevSupabaseUrl, DEV_PROJECT_NAME, DEV_PROJECT_REF, DevDatabaseGuardError } from "../dev-database.js";
import { lirePlafond, PLAFOND_PAR_DEFAUT } from "./budget.js";
import { ErreurMesure } from "./jeu-de-verite.js";

export type ModeMots = "avec" | "sans" | "les-deux";

export interface OptionsMesure {
  /** Sans lui : essai à blanc, aucun appel payant. */
  confirmer: boolean;
  /** Dossier du jeu de vérité (reponses.txt et les photos). */
  jeu: string;
  /** Fichier des cadres tracés (pourcentages). */
  cadres: string;
  /** Dossier des sorties ; chaque mesure y crée son sous-dossier daté. */
  sortie: string;
  plafond: number;
  mots: ModeMots;
  /** Refaire le rapport d'une mesure déjà faite, sans rien lancer. */
  refaireRapport: string | null;
  /** Finir une mesure arrêtée : seuls ses cas absents ou en panne sont relancés, dans son dossier. */
  reprendre: string | null;
  /** Supprimer, par l'administration, les comptes d'essai listés dans comptes.json de ce dossier. */
  nettoyer: string | null;
}

/** Dossier habituel du fondateur (travail non commité) : l'outil n'y écrit jamais. */
export function depotHabituel(maison: string): string {
  return join(maison, "Desktop", "Spotto", "mon-app-shopping-ia");
}

/** Emplacements par défaut, sur le Mac du fondateur (à partir de son dossier personnel). */
export function emplacementsParDefaut(maison: string): Pick<OptionsMesure, "jeu" | "cadres" | "sortie"> {
  return {
    jeu: join(maison, "Downloads", "spotto-jeu-de-verite"),
    cadres: join(depotHabituel(maison), "docs", "banc-jeu-de-verite", "cadres-traces.txt"),
    sortie: join(maison, "Downloads", "spotto-mesure-voie-c"),
  };
}

const AVEC_VALEUR = ["--jeu", "--cadres", "--sortie", "--plafond-credits", "--refaire-rapport", "--reprendre", "--nettoyer"];
const SEULES = ["--confirmer", "--sans-mots", "--les-deux"];

/** Lit la ligne de commande. Une option inconnue est refusée (une faute de
 * frappe ne doit jamais changer le budget en silence). */
export function lireOptions(argv: readonly string[], maison: string, dossierCourant: string): OptionsMesure {
  const valeurs = new Map<string, string>();
  const drapeaux = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i]!;
    if (SEULES.includes(option)) drapeaux.add(option);
    else if (AVEC_VALEUR.includes(option)) {
      const valeur = argv[i + 1];
      if (valeur === undefined || valeur.startsWith("--")) throw new ErreurMesure(`${option} attend une valeur.`);
      valeurs.set(option, valeur);
      i += 1;
    } else throw new ErreurMesure(`Option inconnue : ${option}. Options : ${[...SEULES, ...AVEC_VALEUR].join(", ")}.`);
  }
  if (drapeaux.has("--sans-mots") && drapeaux.has("--les-deux")) throw new ErreurMesure("--sans-mots et --les-deux s'excluent.");
  if (valeurs.has("--reprendre") && (drapeaux.has("--sans-mots") || drapeaux.has("--les-deux"))) {
    throw new ErreurMesure("--reprendre garde le mode de la mesure reprise (avec vos mots, sans, ou les deux) : ne pas ajouter --sans-mots ni --les-deux.");
  }
  if (valeurs.has("--reprendre") && valeurs.has("--refaire-rapport")) throw new ErreurMesure("--reprendre et --refaire-rapport s'excluent.");
  if (valeurs.has("--nettoyer") && (drapeaux.has("--confirmer") || valeurs.has("--reprendre") || valeurs.has("--refaire-rapport"))) {
    throw new ErreurMesure("--nettoyer s'emploie seul : pnpm --filter backend mesure-voie-c --nettoyer <dossier d'une mesure>.");
  }
  const chemin = (option: string, parDefaut: string) => {
    const valeur = valeurs.get(option);
    return valeur === undefined ? parDefaut : resolve(dossierCourant, valeur);
  };
  const facultatif = (option: string) => {
    const valeur = valeurs.get(option);
    return valeur === undefined ? null : resolve(dossierCourant, valeur);
  };
  const defauts = emplacementsParDefaut(maison);
  return {
    confirmer: drapeaux.has("--confirmer"),
    jeu: chemin("--jeu", defauts.jeu),
    cadres: chemin("--cadres", defauts.cadres),
    sortie: chemin("--sortie", defauts.sortie),
    plafond: valeurs.has("--plafond-credits") ? lirePlafond(valeurs.get("--plafond-credits")) : PLAFOND_PAR_DEFAUT,
    mots: drapeaux.has("--les-deux") ? "les-deux" : drapeaux.has("--sans-mots") ? "sans" : "avec",
    refaireRapport: facultatif("--refaire-rapport"),
    reprendre: facultatif("--reprendre"),
    nettoyer: facultatif("--nettoyer"),
  };
}

/** Ce que la garde des dossiers sait du disque (faux dans les tests). */
export interface GardesDossier {
  /** Chemin réel (liens symboliques résolus) d'un chemin EXISTANT ; lève une erreur sinon. */
  realpath(chemin: string): string;
  /** Dossiers interdits en plus du dépôt de l'outil : le dossier habituel du fondateur. */
  interdits: readonly string[];
  /** Racine du dépôt Git qui contient ce dossier existant (git rev-parse --show-toplevel), ou null. */
  depotGit(dossierExistant: string): string | null;
}

/** Sans disque : chemins pris tels quels, aucun dépôt Git détecté. */
const GARDES_SANS_DISQUE: GardesDossier = { realpath: (chemin) => chemin, interdits: [], depotGit: () => null };

/** Chemin réel d'un dossier qui n'existe peut-être pas encore : celui de son
 * plus proche parent existant (liens résolus), suivi du reste. */
export function cheminReel(chemin: string, realpath: GardesDossier["realpath"]): { reel: string; existant: string } {
  let courant = resolve(chemin);
  const suite: string[] = [];
  for (;;) {
    try {
      const reel = realpath(courant);
      return { reel: join(reel, ...suite), existant: reel };
    } catch {
      const parent = dirname(courant);
      if (parent === courant) return { reel: resolve(chemin), existant: courant };
      suite.unshift(basename(courant));
      courant = parent;
    }
  }
}

function dedans(chemin: string, zone: string): boolean {
  const ecart = relative(zone, chemin);
  return ecart === "" || (!ecart.startsWith("..") && !isAbsolute(ecart));
}

/** Les sorties restent hors de tout dépôt Git — celui de l'outil, le dossier
 * habituel du fondateur, et tout autre dépôt —, liens symboliques résolus :
 * jamais une réponse ni une image dans du code. */
export function verifierHorsDuDepot(dossier: string, racineDepot: string, gardes: GardesDossier = GARDES_SANS_DISQUE): void {
  const cible = cheminReel(dossier, gardes.realpath);
  const zones = [{ zone: racineDepot, nom: "le dépôt Git de l'outil" }, ...gardes.interdits.map((zone) => ({ zone, nom: "le dossier habituel du fondateur" }))];
  for (const { zone, nom } of zones) {
    if (dedans(resolve(dossier), resolve(zone)) || dedans(cible.reel, cheminReel(zone, gardes.realpath).reel)) {
      throw new ErreurMesure(`Le dossier ${dossier} est dans ${nom} (${zone}) : choisissez-en un autre, hors de tout dépôt Git (--sortie).`);
    }
  }
  const depot = gardes.depotGit(cible.existant);
  if (depot !== null) throw new ErreurMesure(`Le dossier ${dossier} est dans un dépôt Git (${depot}) : choisissez-en un autre, hors de tout dépôt Git (--sortie).`);
}

/** L'environnement que verrait le serveur lancé dans apps/backend : le
 * fichier .env, et par-dessus les variables du Terminal (comme dotenv). */
export function environnementEffectif(contenuEnv: string | null, terminal: NodeJS.ProcessEnv): Record<string, string> {
  const effectif: Record<string, string> = { ...parse(contenuEnv ?? "") };
  for (const [cle, valeur] of Object.entries(terminal)) if (valeur !== undefined) effectif[cle] = valeur;
  return effectif;
}

/** Refus net si l'environnement ne vise pas spotto-dev-2 (adresse Supabase,
 * et adresse de la base si elle est là), ou s'il manque une clé. Le message ne
 * recopie jamais une adresse ni une clé. */
export function verifierSpottoDev2(env: Readonly<Record<string, string | undefined>>): URL {
  const url = assertDevSupabaseUrl(env.SUPABASE_URL, "apps/backend/.env (SUPABASE_URL)");
  if (!env.SUPABASE_URL!.includes(DEV_PROJECT_REF)) {
    throw new DevDatabaseGuardError(`apps/backend/.env (SUPABASE_URL) ne désigne pas ${DEV_PROJECT_NAME} (${DEV_PROJECT_REF}) : refusé.`);
  }
  if (env.DEV_DATABASE_URL) assertDevDatabaseUrl(env.DEV_DATABASE_URL);
  for (const cle of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SERPAPI_KEY"]) {
    if (!env[cle]) throw new ErreurMesure(`${cle} manque dans apps/backend/.env.`);
  }
  return url;
}

/** Clé SerpApi de l'essai à blanc : invalide, pour qu'aucun crédit ne puisse partir. */
export const CLE_SERPAPI_A_BLANC = "cle-invalide-essai-a-blanc";

export interface SurchargesServeur {
  port: number;
  /** Clé d'essai d'Anthropic ; null : aucune, et l'IA de la voie C coupée
   * (essai à blanc, seconde passe de --les-deux). */
  cleAnthropic: string | null;
  /** Remplace la clé SerpApi (essai à blanc) ; null : celle du .env. */
  cleSerpApi: string | null;
  plafonds: Record<string, string>;
  /** Fichier .env inexistant : le serveur ne relit pas apps/backend/.env (il y
   * reprendrait ce que l'outil a retiré, comme SENTRY_DSN). */
  envAbsent: string;
}

/** Variables retirées pour CE processus : Sentry (rien ne part), la photo vers
 * Anthropic (reste coupée), toute clé d'Anthropic venue d'ailleurs, et
 * NODE_ENV (« test » couperait les limites du serveur). */
const RETIREES = ["SENTRY_DSN", "ANTHROPIC_PHOTO_ENABLED", "ANTHROPIC_API_KEY", "NODE_ENV"];

/** Environnement du serveur local : celui de apps/backend/.env, voie C
 * allumée, son IA allumée seulement avec une clé d'essai, plafonds relevés
 * juste assez, pour CE processus seulement. Sans clé, l'IA est coupée deux
 * fois (VOIE_C_AI_ENABLED et clé absente) : le complément finit en
 * « skipped », sans IA ni Google Shopping. */
export function environnementServeur(base: Readonly<Record<string, string>>, surcharges: SurchargesServeur): Record<string, string> {
  const env: Record<string, string> = { ...base };
  for (const cle of RETIREES) delete env[cle];
  Object.assign(env, surcharges.plafonds, {
    PORT: String(surcharges.port),
    VOIE_C_ENABLED: "true",
    VOIE_C_AI_ENABLED: surcharges.cleAnthropic ? "true" : "false",
    DOTENV_CONFIG_PATH: surcharges.envAbsent,
  });
  if (surcharges.cleAnthropic) env.ANTHROPIC_API_KEY = surcharges.cleAnthropic;
  if (surcharges.cleSerpApi) env.SERPAPI_KEY = surcharges.cleSerpApi;
  return env;
}

/** Les valeurs à ne jamais afficher ni écrire : clés, adresse de la base et son mot de passe. */
export function secretsDe(env: Readonly<Record<string, string | undefined>>): string[] {
  const secrets = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SERPAPI_KEY", "ANTHROPIC_API_KEY", "DEV_DATABASE_URL", "SENTRY_DSN"].map((cle) => env[cle] ?? "");
  try {
    if (env.DEV_DATABASE_URL) secrets.push(decodeURIComponent(new URL(env.DEV_DATABASE_URL).password));
  } catch {
    // Adresse illisible : déjà masquée en entier.
  }
  return secrets.filter((secret) => secret.length >= 8);
}

/** Remplace chaque secret connu par « [masqué] » (aussi sous sa forme encodée dans une adresse). */
export function masquerSecrets(texte: string, secrets: readonly string[]): string {
  let sortie = texte;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    for (const forme of new Set([secret, encodeURIComponent(secret)])) sortie = sortie.split(forme).join("[masqué]");
  }
  return sortie;
}
