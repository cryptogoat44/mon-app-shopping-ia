// Pose une étiquette de version sur GitHub à chaque mise en ligne (lot
// « filets de sécurité », point 24 de la feuille de route V1 ; mode d'emploi :
// MISE-EN-LIGNE.md, à la racine du dépôt).
//
//   pnpm --filter backend etiqueter-version <commit> [--confirmer]
//
// <commit> : la version mise en ligne, telle que /health la donne
// (« "version": "a0212c1" »). Sans --confirmer, la commande dit seulement ce
// qu'elle ferait. Avec --confirmer, elle crée l'étiquette « v2026.11.06-1 »
// (date de Paris, puis le numéro de la mise en ligne du jour) sur ce commit
// et l'envoie sur GitHub. Garde-fous : le commit doit être dans main (sur
// GitHub) ; rien n'est jamais effacé ni déplacé ; aucune autre branche n'est
// touchée.
import { execFileSync } from "node:child_process";
import { commitValide, jourDeParis, prochaineEtiquette } from "./lib/etiquette-version.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function reussit(args: string[]): boolean {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const confirmer = args.includes("--confirmer");
  const demande = args.find((arg) => !arg.startsWith("--"));
  const commit = commitValide(demande);
  if (!commit) {
    throw new Error("Indiquez le commit mis en ligne (7 caractères, comme « version » dans https://spotto-api.onrender.com/health). Exemple : pnpm --filter backend etiqueter-version a0212c1");
  }

  // Dernier état de GitHub (main et étiquettes), en lecture seule.
  git(["fetch", "--quiet", "origin", "main", "--tags"]);
  if (!reussit(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`])) {
    throw new Error(`Commit ${commit} introuvable. Vérifiez les 7 caractères donnés par /health.`);
  }
  const complet = git(["rev-parse", `${commit}^{commit}`]);
  if (!reussit(["merge-base", "--is-ancestor", complet, "origin/main"])) {
    throw new Error(`Le commit ${commit} n'est pas dans main sur GitHub : rien n'est étiqueté.`);
  }

  const deja = git(["tag", "--points-at", complet]).split("\n").filter((etiquette) => /^v\d{4}\.\d{2}\.\d{2}-\d+$/.test(etiquette));
  const jour = jourDeParis(new Date());
  const etiquette = prochaineEtiquette(jour, git(["tag", "--list", `v${jour}-*`]).split("\n"));
  const resume = git(["log", "-1", "--format=%h — %s", complet]);
  console.log(`Commit : ${resume}`);
  if (deja.length > 0) console.log(`Déjà étiqueté : ${deja.join(", ")} (une nouvelle étiquette sera ajoutée quand même : chaque mise en ligne a la sienne).`);
  console.log(`ACTION ANNONCÉE : créer l'étiquette ${etiquette} sur ce commit et l'envoyer sur GitHub.`);
  if (!confirmer) {
    console.log("Rien n'est fait. Relancer avec --confirmer pour poser l'étiquette.");
    return;
  }
  // Étiquette simple : son nom porte déjà la date ; aucune identité Git n'est demandée.
  git(["tag", etiquette, complet]);
  git(["push", "--quiet", "origin", `refs/tags/${etiquette}`]);
  console.log(`Étiquette ${etiquette} posée et envoyée. Liste : https://github.com/cryptogoat44/mon-app-shopping-ia/tags`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
}
