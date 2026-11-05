// Mesure de la voie C sur les photos du jeu de vérité du fondateur, avant de
// l'allumer en production. Elle mesure EXACTEMENT la voie C de main : le vrai
// serveur de cette branche tourne sur ce Mac (processus à part, voie C et son
// IA allumées pour lui seul, base spotto-dev-2), et chaque photo suit le
// parcours HTTP de l'app (préparer, lancer avec cadre et mots, résultat final
// avec le complément).
//
//   pnpm --filter backend mesure-voie-c               essai à blanc : contrôles, plan, aucun appel payant
//   pnpm --filter backend mesure-voie-c --confirmer   mesure réelle, après l'accord écrit du fondateur
//
// Options : --jeu <dossier> (reponses.txt et les photos), --cadres <fichier>,
// --sortie <dossier>, --plafond-credits <n> (60 par défaut, pour la journée),
// --sans-mots, --les-deux (une passe avec vos mots, puis une sans, IA coupée
// et Lens lu dans le cache de 24 h), --reprendre <dossier d'une mesure> (finir
// une mesure arrêtée : seuls ses cas absents ou en panne sont relancés),
// --refaire-rapport <dossier> (sans rien lancer), --nettoyer <dossier>
// (supprimer les comptes d'essai restés, listés dans comptes.json).
// Un seul Ctrl-C, puis attendre « Rapport : … » : le nettoyage ne s'interrompt
// pas (un second Ctrl-C, SIGHUP ou SIGTERM sont ignorés) ; seul SIGKILL laisse
// des comptes, que --nettoyer supprime.
// Sorties HORS de Git (par défaut ~/Downloads/spotto-mesure-voie-c/<date-heure>/) :
// un JSON brut par cas, comptes.json, mesure.json, rapport.md et zones/ (image
// analysée de chaque cas). Jamais : une clé affichée ou écrite, une photo
// copiée dans le dépôt.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lireCleEssai } from "./lib/anthropic-essai.js";
import { emplacementsParDefaut, environnementEffectif, lireOptions, masquerSecrets, secretsDe, verifierHorsDuDepot, verifierSpottoDev2 } from "./lib/mesure-voie-c/environnement.js";
import { chargerJeu } from "./lib/mesure-voie-c/jeu-de-verite.js";
import { lireJugementsFondateur } from "./lib/mesure-voie-c/jugement.js";
import { COMMIT_MAIN, lancerMesure, nettoyerDossier, refaireRapport } from "./lib/mesure-voie-c/mesure.js";
import { DOSSIER_BACKEND, gardesDuMac, portsReels } from "./lib/mesure-voie-c/reel.js";

const RACINE = fileURLToPath(new URL("../../../", import.meta.url));
/** Tout ce qui est affiché ou écrit est d'abord débarrassé de ces valeurs. */
const secrets: string[] = [];

/** Commit de cette branche, et code du serveur identique ou non à main en ligne. */
function infosDepot(): { commit: string | null; identiqueAMain: boolean | null } {
  const git = (args: string[]) => spawnSync("git", ["-C", RACINE, ...args], { encoding: "utf8" });
  const tete = git(["rev-parse", "--short", "HEAD"]);
  if (tete.status !== 0) return { commit: null, identiqueAMain: null };
  const chemins = ["apps/backend/src", "packages/shared-types/src"];
  const ecart = git(["diff", "--quiet", COMMIT_MAIN, "--", ...chemins]);
  const nouveaux = git(["status", "--porcelain", "--", ...chemins]);
  const identique = ecart.status === 0 && nouveaux.status === 0 && nouveaux.stdout.trim() === "" ? true : ecart.status === 1 || nouveaux.stdout.trim() !== "" ? false : null;
  return { commit: tete.stdout.trim(), identiqueAMain: identique };
}

/** Nom du dossier d'une mesure : la date et l'heure de ce Mac (2026-11-05_09-14-03). */
function horodatage(date = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}_${deux(date.getHours())}-${deux(date.getMinutes())}-${deux(date.getSeconds())}`;
}

const fichiers = {
  lire: (chemin: string) => (existsSync(chemin) ? readFileSync(chemin, "utf8") : null),
  lister: (dossier: string) => readdirSync(dossier),
  ecrire: (chemin: string, texte: string) => writeFileSync(chemin, texte),
};

async function main(): Promise<void> {
  const maison = homedir();
  const options = lireOptions(process.argv.slice(2), maison, process.env.INIT_CWD ?? process.cwd());
  const gardes = gardesDuMac(maison);
  const jugements = lireJugementsFondateur(options.jeu);
  if (options.refaireRapport) {
    verifierHorsDuDepot(options.refaireRapport, RACINE, gardes);
    console.log(`Rapport refait, sans aucun appel : ${refaireRapport(options.refaireRapport, jugements, fichiers)}`);
    return;
  }
  const fichierEnv = join(DOSSIER_BACKEND, ".env");
  const environnement = environnementEffectif(existsSync(fichierEnv) ? readFileSync(fichierEnv, "utf8") : null, process.env);
  secrets.push(...secretsDe(environnement));
  // Marqueur de cette exécution, dans l'adresse de ses comptes d'essai (balayage de nettoyage).
  const execution = randomBytes(3).toString("hex");
  const ports = portsReels({ environnement, secrets, execution });
  if (options.nettoyer) {
    verifierHorsDuDepot(options.nettoyer, RACINE, gardes);
    verifierSpottoDev2(environnement);
    await nettoyerDossier(options.nettoyer, ports, jugements);
    return;
  }
  verifierHorsDuDepot(options.sortie, RACINE, gardes);
  if (options.reprendre) verifierHorsDuDepot(options.reprendre, RACINE, gardes);
  await lancerMesure(
    {
      options,
      environnement,
      chargerJeu: () => chargerJeu(options.jeu, options.cadres),
      jugements,
      lireCleAnthropic: () => {
        const cle = lireCleEssai();
        secrets.push(cle);
        return cle;
      },
      depot: infosDepot(),
      dossierSortie: join(options.sortie, horodatage()),
      // Fichier qui n'existe pas : le serveur local ne relit pas apps/backend/.env.
      envAbsent: join(tmpdir(), `spotto-mesure-voie-c-sans-env-${randomUUID()}`),
      cadresTracesParClaude: options.cadres === emplacementsParDefaut(maison).cadres,
      execution,
    },
    ports
  );
}

main().catch((erreur: unknown) => {
  try {
    console.error(`Arrêt : ${masquerSecrets(erreur instanceof Error ? erreur.message : String(erreur), secrets)}`);
  } catch {
    // Terminal fermé.
  }
  process.exitCode = 1;
});
