// Mesure de la voie C : Ctrl-C, fermeture du Terminal (SIGHUP) et arrêt par
// une session Claude (SIGTERM). Le PREMIER signal lance le nettoyage (arrêt
// du serveur local, suppression des comptes d'essai, rapport) ; les suivants
// sont ignorés. Un second Ctrl-C — ou celui que tsx relaie à l'outil en plus
// de celui du Terminal (chaîne pnpm → sh → tsx → node du Mac) — ne coupe
// jamais le nettoyage : le gestionnaire reste en place jusqu'à la fin du
// programme. Seul SIGKILL, que rien n'arrête, peut encore laisser des comptes
// d'essai : comptes.json les liste, et « --nettoyer <dossier> » les supprime.
// Module sans dépendance lourde : testé dans un vrai processus lancé par tsx
// (tests/mesureVoieC.test.ts).
import { constants } from "node:os";

export const SIGNAUX_INTERRUPTION = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export type SignalInterruption = (typeof SIGNAUX_INTERRUPTION)[number];

/** Affiche sans jamais lever d'erreur : une fois le Terminal fermé (SIGHUP),
 * écrire peut échouer ; le nettoyage continue, sans affichage. */
export function afficherSansRisque(texte: string): void {
  try {
    process.stdout.write(`${texte}\n`);
  } catch {
    // Terminal fermé : rien à faire.
  }
}

let sortiesProtegees = false;

/** Une écriture sur un Terminal fermé échoue plus tard, par un événement
 * « error » du flux : ignoré, jamais fatal pendant le nettoyage. */
function protegerSorties(): void {
  if (sortiesProtegees) return;
  sortiesProtegees = true;
  for (const flux of [process.stdout, process.stderr]) flux.on("error", () => undefined);
}

/** Installe le gestionnaire de SIGINT, SIGTERM et SIGHUP. Au premier signal :
 * `action`, puis fin du programme (128 + numéro du signal). Les signaux
 * suivants sont ignorés, avec un rappel. Rend de quoi l'enlever, ce qui n'a
 * d'effet que si aucun signal n'est encore arrivé : une fois le nettoyage
 * commencé, rien ne doit pouvoir l'interrompre. `attendre` : ce que la
 * personne doit attendre à l'écran (« « Rapport : … » »). */
export function surInterruption(action: (signal: SignalInterruption) => Promise<void>, attendre: string): () => void {
  protegerSorties();
  let lance = false;
  const gestion = (recu: NodeJS.Signals) => {
    const signal = recu as SignalInterruption;
    if (lance) {
      afficherSansRisque(`\nNettoyage en cours : ne pas interrompre, attendre ${attendre}.`);
      return;
    }
    lance = true;
    afficherSansRisque(`\nInterruption (${signal}) : nettoyage en cours. Ne plus rien toucher (ni Ctrl-C, ni fermer le Terminal) : attendre ${attendre}.`);
    void action(signal)
      .catch(() => afficherSansRisque("⚠ Nettoyage arrêté par une erreur inattendue : voir comptes.json, puis --nettoyer <dossier de la mesure>."))
      .finally(() => process.exit(128 + (constants.signals[signal] ?? constants.signals.SIGINT)));
  };
  for (const signal of SIGNAUX_INTERRUPTION) process.on(signal, gestion);
  return () => {
    if (lance) return;
    for (const signal of SIGNAUX_INTERRUPTION) process.off(signal, gestion);
  };
}
