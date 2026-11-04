// Mesure de la voie C : le rapport (rapport.md, hors de Git), en français
// simple, construit à partir des JSON bruts des cas. Refaisable à tout moment
// sans rien dépenser (--refaire-rapport), par exemple quand la règle « bonne
// pièce » ou le jugement du fondateur change. Logique pure, testée
// (tests/mesureVoieC.test.ts).
import { VOIE_C_BUDGET } from "../../../src/lib/deadline.js";
import { FENETRE_BANC, jugeDuCas, jugerListe, paliers, type EtatJugements, type JugementListe, type PropositionJugee } from "./jugement.js";
import type { MetaMesure, Passe, Proposition, ResultatCas } from "./resultats.js";

/** Scores du banc d'essai au 30 octobre (images floutées, sa propre voie C). */
export const BANC_30_OCTOBRE = {
  lens: { marqueVisible: "9/9", autres: "11/16", troisPrix: "18/25", mediane: "4,4 s", sous15s: null },
  voieC: { marqueVisible: "8/9", autres: "10/16", troisPrix: "25/25", mediane: "8,8 s", sous15s: "21/25" },
} as const;

/** La promesse : le complément ne dépasse jamais T0 + 14 s. */
const LIMITE_14S = VOIE_C_BUDGET.totalMs;
const LIMITE_15S = 15_000;

const NOMS_PASSES: Record<Passe, string> = { unique: "Mesure", "avec-mots": "Passe 1 — avec vos mots", "sans-mots": "Passe 2 — sans vos mots (servie par le cache)" };

export interface CasJuge {
  resultat: ResultatCas;
  lens: JugementListe;
  boutiques: JugementListe;
}

function jugees(propositions: readonly Proposition[], origine: "lens" | "shopping"): PropositionJugee[] {
  return propositions.map((p) => ({ position: p.position, titre: p.titre, site: p.site, origine }));
}

export function jugerCas(resultat: ResultatCas, jugements: EtatJugements): CasJuge {
  const juge = jugeDuCas(resultat.cas, resultat.verite, jugements);
  return {
    resultat,
    lens: jugerListe(jugees(resultat.propositions.lens, "lens"), juge),
    boutiques: jugerListe(jugees(resultat.propositions.boutiques, "shopping"), juge),
  };
}

export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 1 ? triees[milieu]! : (triees[milieu - 1]! + triees[milieu]!) / 2;
}

/** « 8,8 s » ; « — » sans valeur. */
export function secondes(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function cellule(texte: string): string {
  return texte.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

function avecPrix(propositions: readonly Proposition[]): number {
  return propositions.filter((p) => p.prix !== null).length;
}

function issueComplement(r: ResultatCas): string {
  return r.reponse?.complement?.status ?? r.ligne?.complement_status ?? (r.issue === "mesure" ? "aucune" : "non mesuré");
}

/** Place de la première bonne pièce : « 1re », « 4e », ou « — ». */
function place(premiere: number | null): string {
  if (premiere === null) return "—";
  return premiere === 1 ? "1re" : `${premiere}e`;
}

export interface Totaux {
  mesures: number;
  marqueVisible: number;
  autres: number;
  lens: { marqueVisible: number; autres: number; premiere: number; troisPremieres: number; nimporteOu: number; troisPrix: number };
  boutiques: { marqueVisible: number; autres: number; premiere: number; troisPremieres: number; nimporteOu: number; troisPrix: number };
  ensemble: { marqueVisible: number; autres: number };
  issues: Record<string, number>;
  raisonsSansRequete: Record<string, number>;
  durees: { medianeLancement: number | null; sous14: number; sous15: number; avecDuree: number; medianeLens: number | null; medianeIa: number | null; medianeBoutiques: number | null; medianeTotalServeur: number | null };
  credits: { lens: number; shopping: number; total: number; estimes: number; ecartsJournal: number };
  ia: { appels: number; jetonsLus: number; jetonsEcrits: number };
}

export function totaux(cas: readonly CasJuge[]): Totaux {
  const t: Totaux = {
    mesures: 0,
    marqueVisible: 0,
    autres: 0,
    lens: { marqueVisible: 0, autres: 0, premiere: 0, troisPremieres: 0, nimporteOu: 0, troisPrix: 0 },
    boutiques: { marqueVisible: 0, autres: 0, premiere: 0, troisPremieres: 0, nimporteOu: 0, troisPrix: 0 },
    ensemble: { marqueVisible: 0, autres: 0 },
    issues: {},
    raisonsSansRequete: {},
    durees: { medianeLancement: null, sous14: 0, sous15: 0, avecDuree: 0, medianeLens: null, medianeIa: null, medianeBoutiques: null, medianeTotalServeur: null },
    credits: { lens: 0, shopping: 0, total: 0, estimes: 0, ecartsJournal: 0 },
    ia: { appels: 0, jetonsLus: 0, jetonsEcrits: 0 },
  };
  const lancements: number[] = [];
  const lens: number[] = [];
  const ia: number[] = [];
  const boutiquesMs: number[] = [];
  const totalServeur: number[] = [];
  for (const { resultat: r, lens: jl, boutiques: jb } of cas) {
    const groupe = r.verite.marqueVisible ? "marqueVisible" : "autres";
    t[groupe] += 1;
    t.credits.lens += r.credits.lens;
    t.credits.shopping += r.credits.shopping;
    t.credits.total += r.credits.total;
    if (r.credits.estime) t.credits.estimes += 1;
    if (r.credits.selonJournal !== null && r.credits.selonJournal !== r.credits.lens + r.credits.shopping) t.credits.ecartsJournal += 1;
    if (r.issue !== "mesure") continue;
    t.mesures += 1;
    const pl = paliers(jl.premiere);
    const pb = paliers(jb.premiere);
    if (pl.dixPremieres) t.lens[groupe] += 1;
    if (pb.dixPremieres) t.boutiques[groupe] += 1;
    if (pl.dixPremieres || pb.dixPremieres) t.ensemble[groupe] += 1;
    for (const [compte, p, liste] of [
      [t.lens, pl, r.propositions.lens],
      [t.boutiques, pb, r.propositions.boutiques],
    ] as const) {
      if (p.premiere) compte.premiere += 1;
      if (p.troisPremieres) compte.troisPremieres += 1;
      if (p.nimporteOu) compte.nimporteOu += 1;
      if (avecPrix(liste) >= 3) compte.troisPrix += 1;
    }
    const issue = issueComplement(r);
    t.issues[issue] = (t.issues[issue] ?? 0) + 1;
    const complement = r.journal?.complement ?? null;
    const raison = complement?.noQueryReason;
    if (typeof raison === "string") t.raisonsSansRequete[raison] = (t.raisonsSansRequete[raison] ?? 0) + 1;
    if (r.durees.lancementMs !== null) {
      lancements.push(r.durees.lancementMs);
      if (r.durees.lancementMs < LIMITE_14S) t.durees.sous14 += 1;
      if (r.durees.lancementMs < LIMITE_15S) t.durees.sous15 += 1;
    }
    const appelLens = r.ligne?.lens_from_cache === false ? nombreOuNull(r.ligne.call_seconds) : null;
    if (appelLens !== null) lens.push(appelLens * 1000);
    const aiMs = nombreOuNull(complement?.aiMs);
    if (aiMs !== null) {
      ia.push(aiMs);
      t.ia.appels += 1;
    }
    t.ia.jetonsLus += nombreOuNull(complement?.inputTokens) ?? 0;
    t.ia.jetonsEcrits += nombreOuNull(complement?.outputTokens) ?? 0;
    const shoppingMs = nombreOuNull(complement?.shoppingMs);
    if (shoppingMs !== null) boutiquesMs.push(shoppingMs);
    const totalMs = nombreOuNull(complement?.totalMs);
    if (totalMs !== null) totalServeur.push(totalMs);
  }
  t.durees.avecDuree = lancements.length;
  t.durees.medianeLancement = mediane(lancements);
  t.durees.medianeLens = mediane(lens);
  t.durees.medianeIa = mediane(ia);
  t.durees.medianeBoutiques = mediane(boutiquesMs);
  t.durees.medianeTotalServeur = mediane(totalServeur);
  return t;
}

function tableauCas(cas: readonly CasJuge[]): string[] {
  const lignes = [
    "| Cas | Marque visible | Cadre | Mots envoyés | Lens : propositions (avec prix) | Lens : bonne pièce | Complément | Boutiques (avec prix) | Boutiques : bonne pièce | Requête de l'IA | Durée | Crédits |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { resultat: r, lens, boutiques } of cas) {
    const mesure = r.issue === "mesure";
    const requete = r.reponse?.complement?.query ?? "";
    lignes.push(
      `| ${r.cas} | ${r.verite.marqueVisible ? "oui" : "non"} | ${r.envoi.cadreTrace ? "oui" : "image entière"} | ${r.envoi.mots ? "oui" : "non"} | ${
        mesure ? `${r.propositions.lens.length} (${avecPrix(r.propositions.lens)})` : cellule(`non mesuré : ${r.erreur ?? r.issue}`)
      } | ${mesure ? place(lens.premiere) : "—"} | ${cellule(issueComplement(r))} | ${mesure ? `${r.propositions.boutiques.length} (${avecPrix(r.propositions.boutiques)})` : "—"} | ${
        mesure ? place(boutiques.premiere) : "—"
      } | ${cellule(requete)} | ${secondes(r.durees.lancementMs)} | ${r.credits.total}${r.credits.estime ? " (estimé)" : ""} |`
    );
  }
  return lignes;
}

function liste(compte: Record<string, number>): string {
  const entrees = Object.entries(compte).sort((a, b) => b[1] - a[1]);
  return entrees.length === 0 ? "aucune" : entrees.map(([cle, n]) => `${cle} ${n}`).join(", ");
}

function sectionPasse(passe: Passe, cas: readonly CasJuge[]): string[] {
  const t = totaux(cas);
  const fr = (n: number, sur: number) => `${n}/${sur}`;
  const lignes = [`## ${NOMS_PASSES[passe]}`, ""];
  lignes.push(
    `${t.mesures} cas mesurés sur ${cas.length}. « Bonne pièce » : dans les ${FENETRE_BANC} premières propositions de la liste, comme au banc.`,
    "",
    "| | Lens (cette mesure) | A du banc (Lens) | Boutiques de la voie C (cette mesure) | C du banc | Lens ou boutiques |",
    "|---|---|---|---|---|---|",
    `| Bonne pièce, marque visible | ${fr(t.lens.marqueVisible, t.marqueVisible)} | ${BANC_30_OCTOBRE.lens.marqueVisible} | ${fr(t.boutiques.marqueVisible, t.marqueVisible)} | ${BANC_30_OCTOBRE.voieC.marqueVisible} | ${fr(t.ensemble.marqueVisible, t.marqueVisible)} |`,
    `| Bonne pièce, autres cas | ${fr(t.lens.autres, t.autres)} | ${BANC_30_OCTOBRE.lens.autres} | ${fr(t.boutiques.autres, t.autres)} | ${BANC_30_OCTOBRE.voieC.autres} | ${fr(t.ensemble.autres, t.autres)} |`,
    `| Au moins 3 propositions avec prix | ${fr(t.lens.troisPrix, cas.length)} | ${BANC_30_OCTOBRE.lens.troisPrix} | ${fr(t.boutiques.troisPrix, cas.length)} | ${BANC_30_OCTOBRE.voieC.troisPrix} | |`,
    `| Bonne pièce en 1re place | ${fr(t.lens.premiere, cas.length)} | | ${fr(t.boutiques.premiere, cas.length)} | | |`,
    `| Bonne pièce dans les 3 premières | ${fr(t.lens.troisPremieres, cas.length)} | | ${fr(t.boutiques.troisPremieres, cas.length)} | | |`,
    `| Bonne pièce n'importe où | ${fr(t.lens.nimporteOu, cas.length)} | | ${fr(t.boutiques.nimporteOu, cas.length)} | | |`,
    "",
    `Issues du complément : ${liste(t.issues)}.${Object.keys(t.raisonsSansRequete).length > 0 ? ` Pas de requête sûre (no_query) : ${liste(t.raisonsSansRequete)}.` : ""}`,
    "",
    "Durées :",
    `- lancement complet (photo envoyée → résultat final avec le complément, sur ce Mac) : médiane ${secondes(t.durees.medianeLancement)} ; ${t.durees.sous14}/${t.durees.avecDuree} sous 14 s ; ${t.durees.sous15}/${t.durees.avecDuree} sous 15 s (banc : C ${BANC_30_OCTOBRE.voieC.mediane}, ${BANC_30_OCTOBRE.voieC.sous15s} sous 15 s ; A ${BANC_30_OCTOBRE.lens.mediane}) ;`,
    `- appel à Lens seul (à la seconde près) : médiane ${secondes(t.durees.medianeLens)} ; IA : ${secondes(t.durees.medianeIa)} ; Google Shopping : ${secondes(t.durees.medianeBoutiques)} ; total mesuré par le serveur : ${secondes(t.durees.medianeTotalServeur)}.`,
    "",
    `Crédits SerpApi dépensés : ${t.credits.total} (Lens ${t.credits.lens}, Google Shopping ${t.credits.shopping})${t.credits.estimes > 0 ? ` — dont ${t.credits.estimes} cas estimés au pire` : ""}${
      t.credits.ecartsJournal > 0 ? ` — ${t.credits.ecartsJournal} cas où le journal du serveur compte autrement (le plus grand est gardé)` : ""
    }. IA : ${t.ia.appels} appel(s), ${t.ia.jetonsLus} jetons lus, ${t.ia.jetonsEcrits} écrits.`,
    "",
    ...tableauCas(cas),
    ""
  );
  return lignes;
}

/** Effet de vos mots sur l'ordre de Lens (--les-deux) : même réponse de Google, seul le tri change. */
function sectionEffetDesMots(avec: readonly CasJuge[], sans: readonly CasJuge[]): string[] {
  const paires = avec.flatMap((a) => {
    const s = sans.find((x) => x.resultat.cas === a.resultat.cas);
    return s && a.resultat.issue === "mesure" && s.resultat.issue === "mesure" ? [[a, s] as const] : [];
  });
  const compte = (choix: (c: CasJuge) => boolean) => [paires.filter(([a]) => choix(a)).length, paires.filter(([, s]) => choix(s)).length];
  const [premiereAvec, premiereSans] = compte((c) => c.lens.premiere === 1);
  const [troisAvec, troisSans] = compte((c) => c.lens.premiere !== null && c.lens.premiere <= 3);
  const memeComplement = paires.filter(([a, s]) => a.resultat.propositions.boutiques.map((p) => p.lien).join(" ") === s.resultat.propositions.boutiques.map((p) => p.lien).join(" ")).length;
  const memeLens = paires.filter(([a, s]) => s.resultat.ligne?.lens_from_cache === true && a.resultat.envoi.empreinteZone === s.resultat.envoi.empreinteZone).length;
  return [
    "## Effet de vos mots sur Lens",
    "",
    `Sur ${paires.length} cas mesurés deux fois. Vos mots ne partent jamais chez Google : ils ne font que remonter les propositions dont le titre les contient.`,
    `- Bonne pièce en 1re place : ${premiereAvec} avec vos mots, ${premiereSans} sans.`,
    `- Bonne pièce dans les 3 premières : ${troisAvec} avec, ${troisSans} sans.`,
    `- Même image analysée et réponse de Lens lue dans le cache à la 2e passe : ${memeLens}/${paires.length} ; mêmes boutiques proposées : ${memeComplement}/${paires.length}.`,
    "",
  ];
}

const HEURE_DE_PARIS = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
const JOUR_MS = 24 * 60 * 60 * 1000;

/** « 5 novembre 2026 à 10:31 », à l'heure de Paris. */
export function dateDeParis(iso: string, decalageMs = 0): string {
  return HEURE_DE_PARIS.format(new Date(Date.parse(iso) + decalageMs));
}

export interface EntreeRapport {
  meta: MetaMesure;
  resultats: readonly ResultatCas[];
  jugements: EtatJugements;
}

/** Le rapport complet, en Markdown. */
export function construireRapport({ meta, resultats, jugements }: EntreeRapport): string {
  const passes: Passe[] = meta.mots === "les-deux" ? ["avec-mots", "sans-mots"] : ["unique"];
  const parPasse = new Map(passes.map((passe) => [passe, resultats.filter((r) => r.passe === passe).sort((a, b) => a.cas - b.cas).map((r) => jugerCas(r, jugements))]));
  const tous = [...parPasse.values()].flat();
  const credits = tous.reduce((somme, c) => somme + c.resultat.credits.total, 0);
  const { avant, entrePasses, apres } = meta.compteurs;
  const lignes = [
    `# Mesure de la voie C — ${dateDeParis(meta.debut)} (heure de Paris)`,
    "",
    "## Ce qui a été mesuré",
    "",
    `- Le VRAI serveur de Spotto, lancé sur ce Mac (commit ${meta.serveur.commit ?? "inconnu"} ; code du serveur ${
      meta.serveur.identiqueAMain === true ? `identique à main en ligne, ${meta.serveur.commitMain}` : meta.serveur.identiqueAMain === false ? `⚠ DIFFÉRENT de main en ligne (${meta.serveur.commitMain})` : "non comparé à main"
    }), voie C et son IA allumées pour lui seul, base spotto-dev-2.`,
    `- ${resultats.length} lancement(s) sur ${meta.plan.cas} photos, chacune envoyée comme l'app : réduite à 1 600 px (JPEG 0,85), puis préparation, lancement et attente du résultat final avec le complément.`,
    `- Cadres : ${meta.cadres.nombre} cas avec un cadre (${meta.cadres.chemin})${
      meta.cadres.tracesParClaude ? ", tracés par Claude le 30 octobre et À VALIDER par le fondateur" : ""
    } ; les autres en image entière. L'image analysée de chaque cas est dans zones/.`,
    `- Vos mots : ${meta.mots === "avec" ? "envoyés comme dans l'app (ils trient seulement les résultats de Lens)" : meta.mots === "sans" ? "non envoyés" : "passe 1 avec, passe 2 sans"}.`,
    `- « Bonne pièce » : ${
      jugements.etat === "lu" ? "jugement du fondateur (jugements.txt) d'abord, puis la règle du banc" : "règle du banc (semblePiece), reproduite ici d'après sa description ; seuils et traductions pas forcément identiques au banc"
    }.${jugements.etat === "format-a-venir" ? " ⚠ jugements.txt existe, mais son format n'est pas encore pris en charge : refaire le rapport quand il le sera (--refaire-rapport)." : ""}`,
    `- Google Lens chez SerpApi (page d'état, au départ) : ${meta.etatLens}.`,
    "",
    "## En bref",
    "",
    `- Crédits SerpApi dépensés : ${credits} (plafond fixé : ${meta.plan.plafond}).${
      avant && apres ? ` Compteur de spotto-dev-2 pour ce cycle : ${avant.mois} avant, ${entrePasses ? `${entrePasses.mois} entre les passes, ` : ""}${apres.mois} après (il compte aussi les autres essais faits en même temps sur spotto-dev-2).` : ""
    }`,
    meta.arret ? `- ⚠ Mesure arrêtée avant la fin : ${meta.arret}.` : "- Mesure allée au bout.",
    `- Comptes d'essai : ${meta.nettoyage.supprimes}/${meta.nettoyage.comptes} supprimés avec leurs recherches${
      meta.nettoyage.restes.length > 0 ? ` — ⚠ à supprimer à la main : ${meta.nettoyage.restes.join(", ")} (pnpm --filter backend nettoyer-comptes-test-dev)` : ""
    }.`,
    ...meta.avertissements.map((a) => `- ⚠ ${a}`),
    "",
  ];
  for (const passe of passes) lignes.push(...sectionPasse(passe, parPasse.get(passe) ?? []));
  if (meta.mots === "les-deux") lignes.push(...sectionEffetDesMots(parPasse.get("avec-mots") ?? [], parPasse.get("sans-mots") ?? []));
  lignes.push(
    "## Comment lire ce rapport",
    "",
    "- « Lens » : les résultats de Google Lens, dans l'ordre où l'app les montre. « Boutiques » : « Cette pièce dans d'autres boutiques », le complément de la voie C (l'IA lit les titres Lens, écrit une requête, Google Shopping cherche).",
    "- Complément : shown = des boutiques montrées ; empty = requête faite, rien gardé ; no_query = pas de requête sûre ; ai_failed = l'IA a échoué ; no_time = plus le temps (14 s) ; no_capacity = plafond ; skipped = IA coupée ; error = anomalie.",
    "- Le banc du 30 octobre utilisait des images floutées et sa propre voie C : la comparaison donne un ordre d'idée, pas une égalité stricte.",
    `- Le cache du serveur garde les réponses 24 h : relancée avant le ${dateDeParis(meta.debut, JOUR_MS)}, la même mesure serait en bonne partie gratuite, mais ses durées ne voudraient plus rien dire (lens_from_cache dans les JSON).`,
    "- « Lens ou boutiques » : la bonne pièce est dans l'une ou l'autre liste, c'est-à-dire ce que voit la personne.",
    "- Chaque cas a son JSON brut (cas-NN….json) : titres, prix, sites, requête de l'IA, durées, crédits, lignes de mesure du serveur.",
    ""
  );
  return lignes.join("\n");
}
