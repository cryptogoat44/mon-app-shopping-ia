// Bascule des fichiers .env de développement vers spotto-dev-2 (lot outils, décision du fondateur
// du 30 octobre 2026) : apps/backend/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)
// et apps/mobile/.env (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY). L'adresse et la clé
// secrète viennent de l'accès déjà enregistré par configurer-banc ; seule la clé publique est demandée.
// Aucune valeur n'est jamais affichée ; une copie de chaque ancien fichier est gardée
// (.env.sauvegarde-…, ignorée par Git, lisible par vous seul). Aucun appel : rien n'est vérifié en ligne.
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertDevSupabaseUrl } from "./dev-database.js";

/** L'accès à spotto-dev-2 enregistré par configurer-banc (adresse et clé secrète, jamais affichées). */
export const ACCES_SPOTTO_DEV_2 = fileURLToPath(new URL("../../.banc-spotto-dev-2-key.json", import.meta.url));
const ACCES = z.object({ url: z.string(), cle: z.string() });

export type GenreDeCle = "publique" | "secrete" | "inconnue";

/** Le genre d'une clé de Supabase, sans jamais l'afficher : nouvelles clés (sb_publishable_…, sb_secret_…)
 * ou anciennes (jeton signé dont le rôle est « anon » ou « service_role »). */
export function genreDeCle(cle: string): GenreDeCle {
  if (/^sb_publishable_\S{10,}$/.test(cle)) return "publique";
  if (/^sb_secret_\S{10,}$/.test(cle)) return "secrete";
  const [, charge, signature] = cle.split(".");
  if (!charge || !signature || cle.split(".").length !== 3) return "inconnue";
  try {
    const role = z.object({ role: z.string() }).safeParse(JSON.parse(Buffer.from(charge, "base64url").toString("utf8")));
    if (role.success && role.data.role === "anon") return "publique";
    if (role.success && role.data.role === "service_role") return "secrete";
  } catch {
    return "inconnue";
  }
  return "inconnue";
}

/** Remplace (ou ajoute à la fin) les variables données dans le texte d'un .env, sans toucher aux autres lignes. */
export function avecVariables(texte: string, valeurs: Readonly<Record<string, string>>): string {
  const vues = new Set<string>();
  const lignes = texte.split("\n").map((ligne) => {
    const nom = /^([A-Z0-9_]+)=/.exec(ligne)?.[1];
    if (nom === undefined || valeurs[nom] === undefined) return ligne;
    vues.add(nom);
    return `${nom}=${valeurs[nom]}`;
  });
  while (lignes.length > 0 && lignes.at(-1) === "") lignes.pop();
  for (const [nom, valeur] of Object.entries(valeurs)) if (!vues.has(nom)) lignes.push(`${nom}=${valeur}`);
  return `${lignes.join("\n")}\n`;
}

/** L'adresse (contrôlée : spotto-dev-2 seulement) et la clé secrète (contrôlée) enregistrées par configurer-banc. */
export function lireAcces(chemin: string): { url: string; cleSecrete: string } {
  if (!existsSync(chemin)) throw new Error("Accès à spotto-dev-2 absent : lancez d'abord « pnpm --filter backend configurer-banc ». Rien n'est écrit.");
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new Error("Accès de configurer-banc illisible. Rien n'est écrit.");
  }
  const acces = ACCES.safeParse(brut);
  if (!acces.success) throw new Error("Accès de configurer-banc illisible. Rien n'est écrit.");
  const url = assertDevSupabaseUrl(acces.data.url, "L'accès de configurer-banc").origin;
  if (genreDeCle(acces.data.cle) !== "secrete") throw new Error("La clé enregistrée par configurer-banc n'est pas une clé secrète de Supabase. Rien n'est écrit.");
  return { url, cleSecrete: acces.data.cle };
}

/** La clé publique saisie : une clé secrète n'ira jamais dans l'app. */
export function verifierClePublique(cle: string, cleSecrete: string): string {
  const propre = cle.trim();
  if (propre === cleSecrete || genreDeCle(propre) === "secrete") {
    throw new Error("Vous avez saisi une clé SECRÈTE : elle ne doit jamais aller dans l'app. Rien n'est écrit ; collez la clé « publishable ».");
  }
  if (genreDeCle(propre) !== "publique") throw new Error("Ce n'est pas une clé publique de Supabase (sb_publishable_…). Rien n'est écrit.");
  return propre;
}

/** Le nouveau texte d'un .env ; refusé si une autre ligne de l'ancien fichier venait à manquer. */
function nouveauTexte(chemin: string, valeurs: Readonly<Record<string, string>>): string {
  const ancien = readFileSync(chemin, "utf8");
  const nouveau = avecVariables(ancien, valeurs);
  const gardees = ancien.split("\n").filter((ligne) => ligne && !Object.keys(valeurs).some((nom) => ligne.startsWith(`${nom}=`)));
  if (!gardees.every((ligne) => nouveau.split("\n").includes(ligne))) throw new Error(`Contrôle de sécurité : ${basename(chemin)} aurait perdu une ligne. Rien n'est écrit.`);
  return nouveau;
}

export interface OptionsEnvDev {
  acces: string;
  envServeur: string;
  envApp: string;
  demanderClePublique: () => Promise<string>;
  journal: (ligne: string) => void;
  /** Suffixe des copies des anciens fichiers (date et heure). */
  horodatage: string;
}

/** Remplit les deux .env pour spotto-dev-2 : tout est contrôlé avant la moindre écriture ; aucune valeur affichée. */
export async function configurerEnvDev(o: OptionsEnvDev): Promise<void> {
  const { url, cleSecrete } = lireAcces(o.acces);
  for (const f of [o.envServeur, o.envApp]) if (!existsSync(f)) throw new Error(`Fichier absent : ${f}. Rien n'est écrit.`);
  const clePublique = verifierClePublique(await o.demanderClePublique(), cleSecrete);
  const fichiers = [
    { libelle: "serveur", chemin: o.envServeur, texte: nouveauTexte(o.envServeur, { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: cleSecrete, SUPABASE_ANON_KEY: clePublique }) },
    { libelle: "app", chemin: o.envApp, texte: nouveauTexte(o.envApp, { EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: clePublique }) },
  ].map((f) => ({ ...f, copie: `${f.chemin}.sauvegarde-${o.horodatage}` }));
  for (const f of fichiers) {
    copyFileSync(f.chemin, f.copie);
    chmodSync(f.copie, 0o600);
  }
  try {
    for (const f of fichiers) {
      writeFileSync(f.chemin, f.texte, { mode: 0o600 });
      chmodSync(f.chemin, 0o600);
    }
  } catch {
    // Tout ou rien : chaque fichier retrouve son ancienne version.
    for (const f of fichiers) copyFileSync(f.copie, f.chemin);
    throw new Error("Écriture impossible : les deux fichiers ont retrouvé leur ancienne version.");
  }
  for (const f of fichiers) o.journal(`${f.libelle} : ${basename(f.chemin)} mis à jour pour spotto-dev-2 ; ancienne version copiée dans ${basename(f.copie)} (lisible par vous seul).`);
  o.journal("Variables écrites (valeurs jamais affichées) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY ; EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY.");
  if (/^DEV_DATABASE_URL=.*sbtwsmxfdfxzgcohbznd/m.test(readFileSync(o.envServeur, "utf8"))) {
    o.journal("DEV_DATABASE_URL vise encore l'ancien spotto-dev : lancez « pnpm --filter backend configurer-base-dev ».");
  }
}
