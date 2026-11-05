// Essai du gestionnaire d'interruption de la mesure de la voie C dans un VRAI
// processus lancé par tsx (tests/mesureVoieC.test.ts) : un nettoyage de
// 1,5 s, que deux SIGINT de suite (Ctrl-C deux fois, ou celui que tsx relaie
// en plus du Terminal), SIGHUP ou SIGTERM ne doivent jamais couper. Aucun
// réseau : le « nettoyage » écrit seulement dans un fichier de trace.
//   tsx tests/fixtures/mesure-voie-c-interruption.ts <fichier de trace>
import { appendFileSync } from "node:fs";
import { surInterruption } from "../../scripts/lib/mesure-voie-c/interruption.js";

const trace = process.argv[2]!;
const noter = (texte: string) => appendFileSync(trace, `${texte}\n`);

surInterruption(async (signal) => {
  noter(`nettoyage commencé (${signal})`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  noter("nettoyage fini");
}, "« Rapport : … »");
noter("prêt");
// Une mesure en cours : le programme ne s'arrête que par le gestionnaire.
setInterval(() => undefined, 1000);
