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
// --sortie <dossier>, --plafond-credits <n> (60 par défaut), --sans-mots,
// --les-deux (une passe avec vos mots, puis une sans, gratuite grâce au cache
// de 24 h), --refaire-rapport <dossier d'une mesure> (sans rien lancer).
// Sorties HORS de Git (par défaut ~/Downloads/spotto-mesure-voie-c/<date-heure>/) :
// un JSON brut par cas, mesure.json, rapport.md et zones/ (image analysée de
// chaque cas). Jamais : une clé affichée ou écrite, une photo copiée dans le dépôt.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lireCleEssai } from "./lib/anthropic-essai.js";
import { emplacementsParDefaut, environnementEffectif, lireOptions, masquerSecrets, secretsDe, verifierHorsDuDepot } from "./lib/mesure-voie-c/environnement.js";
import { chargerJeu } from "./lib/mesure-voie-c/jeu-de-verite.js";
import { lireJugementsFondateur } from "./lib/mesure-voie-c/jugement.js";
import { COMMIT_MAIN, lancerMesure, refaireRapport } from "./lib/mesure-voie-c/mesure.js";
import { DOSSIER_BACKEND, portsReels } from "./lib/mesure-voie-c/reel.js";

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

async function main(): Promise<void> {
  const maison = homedir();
  const options = lireOptions(process.argv.slice(2), maison, process.env.INIT_CWD ?? process.cwd());
  const jugements = lireJugementsFondateur(options.jeu);
  if (options.refaireRapport) {
    verifierHorsDuDepot(options.refaireRapport, RACINE);
    const chemin = refaireRapport(options.refaireRapport, jugements, {
      lire: (fichier) => readFileSync(fichier, "utf8"),
      lister: (dossier) => readdirSync(dossier),
      ecrire: (fichier, texte) => writeFileSync(fichier, texte),
    });
    console.log(`Rapport refait, sans aucun appel : ${chemin}`);
    return;
  }
  verifierHorsDuDepot(options.sortie, RACINE);
  const fichierEnv = join(DOSSIER_BACKEND, ".env");
  const environnement = environnementEffectif(existsSync(fichierEnv) ? readFileSync(fichierEnv, "utf8") : null, process.env);
  secrets.push(...secretsDe(environnement));
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
    },
    portsReels({ environnement, secrets })
  );
}

main().catch((erreur: unknown) => {
  console.error(`Arrêt : ${masquerSecrets(erreur instanceof Error ? erreur.message : String(erreur), secrets)}`);
  process.exitCode = 1;
});
