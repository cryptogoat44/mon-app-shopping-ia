// Mesure de la voie C : le rapport (rapport.md, hors de Git), en français
// simple, construit à partir des JSON bruts des cas. Refaisable à tout moment
// sans rien dépenser (--refaire-rapport), par exemple quand la règle « bonne
// pièce » ou le jugement du fondateur change. Logique pure, testée
// (tests/mesureVoieC.test.ts).
import { VOIE_C_BUDGET } from "../../../src/lib/deadline.js";
import { FENETRE_BANC, jugeDuCas, jugerListe, paliers, REGLE_BONNE_PIECE, type EtatJugements, type JugementListe, type PropositionJugee } from "./jugement.js";
import { entreesDeCache, lensARepondu, lensDuCache, partsDuCache, type MetaMesure, type Passe, type Proposition, type ResultatCas } from "./resultats.js";

/** Scores du banc d'essai au 30 octobre (images floutées, sa propre voie C). */
export const BANC_30_OCTOBRE = {
  lens: { marqueVisible: "9/9", autres: "11/16", troisPrix: "18/25", mediane: "4,4 s", sous15s: null },
  voieC: { marqueVisible: "8/9", autres: "10/16", troisPrix: "25/25", mediane: "8,8 s", sous15s: "21/25" },
} as const;

/** La promesse : le complément ne dépasse jamais T0 + 14 s. */
const LIMITE_14S = VOIE_C_BUDGET.totalMs;
const LIMITE_15S = 15_000;
/** Ce que l'écran Résultat de l'app montre avant « Voir plus » : la
 * proposition en grand et 11 autres de Lens (spot/result.tsx,
 * OTHERS_SHOWN_FIRST), 6 boutiques (result-sections.ts, COMPLEMENT_SHOWN_FIRST). */
export const LENS_VISIBLES = 12;
export const BOUTIQUES_VISIBLES = 6;

const NOMS_PASSES: Record<Passe, string> = { unique: "Mesure", "avec-mots": "Passe 1 — avec vos mots", "sans-mots": "Passe 2 — sans vos mots (IA coupée, Lens servi par le cache)" };

/** Commande qui supprime les comptes restés d'une mesure. */
function commandeNettoyer(dossier: string | null): string {
  return `pnpm --filter backend mesure-voie-c --nettoyer ${dossier ?? "<dossier de la mesure>"}`;
}

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

/** « Lens, requête » : ce qui vient du cache du serveur pour ce cas ; « non » sinon. */
function celluleCache(r: ResultatCas): string {
  if (r.issue !== "mesure") return "—";
  const parts = partsDuCache(r);
  const noms = [parts.lens ? "Lens" : "", parts.requete ? "requête" : "", parts.boutiques ? "boutiques" : ""].filter(Boolean);
  return noms.length > 0 ? noms.join(", ") : "non";
}

export interface Totaux {
  mesures: number;
  /** Cas par groupe : tous (scores de Lens). */
  marqueVisible: number;
  autres: number;
  /** Cas par groupe, sans ceux dont Lens vient du cache (boutiques, durées, issues). */
  horsCache: { cas: number; marqueVisible: number; autres: number };
  /** Cas mesurés dont Lens vient du cache de 24 h : exclus des boutiques et des durées. */
  duCache: number;
  lens: { marqueVisible: number; autres: number; premiere: number; troisPremieres: number; nimporteOu: number; troisPrix: number };
  boutiques: { marqueVisible: number; autres: number; premiere: number; troisPremieres: number; nimporteOu: number; troisPrix: number };
  ensemble: { marqueVisible: number; autres: number };
  /** Bonne pièce visible sans « Voir plus » : dans les 12 premières de Lens ou les 6 premières boutiques. */
  visibles: number;
  issues: Record<string, number>;
  raisonsSansRequete: Record<string, number>;
  durees: {
    medianeLancement: number | null;
    sous14: number;
    sous15: number;
    avecDuree: number;
    /** Préparation + lancement : l'attente minimale de la personne. */
    medianeAttente: number | null;
    attenteSous14: number;
    attenteSous15: number;
    avecAttente: number;
    medianeLens: number | null;
    medianeIa: number | null;
    medianeBoutiques: number | null;
    medianeTotalServeur: number | null;
    /** Total du serveur moins Lens, IA et Google Shopping : base, envoi de l'image, enregistrement. */
    medianeBaseEtEnvoi: number | null;
  };
  credits: { lens: number; shopping: number; total: number; estimes: number; ecartsJournal: number };
  ia: { appels: number; jetonsLus: number; jetonsEcrits: number };
}

/** Totaux d'une passe. `exclureCache` (première passe ou passe unique) : les
 * cas dont Lens vient du cache (relance dans les 24 h) gardent leurs scores
 * Lens — même réponse de Google —, mais sortent des boutiques, des issues du
 * complément et des durées, qu'ils fausseraient. */
export function totaux(cas: readonly CasJuge[], options: { exclureCache: boolean } = { exclureCache: true }): Totaux {
  const t: Totaux = {
    mesures: 0,
    marqueVisible: 0,
    autres: 0,
    horsCache: { cas: 0, marqueVisible: 0, autres: 0 },
    duCache: 0,
    lens: { marqueVisible: 0, autres: 0, premiere: 0, troisPremieres: 0, nimporteOu: 0, troisPrix: 0 },
    boutiques: { marqueVisible: 0, autres: 0, premiere: 0, troisPremieres: 0, nimporteOu: 0, troisPrix: 0 },
    ensemble: { marqueVisible: 0, autres: 0 },
    visibles: 0,
    issues: {},
    raisonsSansRequete: {},
    durees: {
      medianeLancement: null,
      sous14: 0,
      sous15: 0,
      avecDuree: 0,
      medianeAttente: null,
      attenteSous14: 0,
      attenteSous15: 0,
      avecAttente: 0,
      medianeLens: null,
      medianeIa: null,
      medianeBoutiques: null,
      medianeTotalServeur: null,
      medianeBaseEtEnvoi: null,
    },
    credits: { lens: 0, shopping: 0, total: 0, estimes: 0, ecartsJournal: 0 },
    ia: { appels: 0, jetonsLus: 0, jetonsEcrits: 0 },
  };
  const lancements: number[] = [];
  const attentes: number[] = [];
  const lens: number[] = [];
  const ia: number[] = [];
  const boutiquesMs: number[] = [];
  const totalServeur: number[] = [];
  const baseEtEnvoi: number[] = [];
  for (const { resultat: r, lens: jl, boutiques: jb } of cas) {
    const groupe = r.verite.marqueVisible ? "marqueVisible" : "autres";
    const exclu = options.exclureCache && r.issue === "mesure" && lensDuCache(r);
    t[groupe] += 1;
    if (!exclu) {
      t.horsCache.cas += 1;
      t.horsCache[groupe] += 1;
    }
    t.credits.lens += r.credits.lens;
    t.credits.shopping += r.credits.shopping;
    t.credits.total += r.credits.total;
    if (r.credits.estime) t.credits.estimes += 1;
    if (r.credits.selonJournal !== null && r.credits.selonJournal !== r.credits.lens + r.credits.shopping) t.credits.ecartsJournal += 1;
    if (r.issue !== "mesure") continue;
    t.mesures += 1;
    const complement = r.journal?.complement ?? null;
    // Appels à l'IA réellement faits (même pour un cas servi par le cache) : comptés.
    const aiMs = nombreOuNull(complement?.aiMs);
    if (aiMs !== null) t.ia.appels += 1;
    t.ia.jetonsLus += nombreOuNull(complement?.inputTokens) ?? 0;
    t.ia.jetonsEcrits += nombreOuNull(complement?.outputTokens) ?? 0;
    const pl = paliers(jl.premiere);
    if (pl.dixPremieres) t.lens[groupe] += 1;
    if (pl.premiere) t.lens.premiere += 1;
    if (pl.troisPremieres) t.lens.troisPremieres += 1;
    if (pl.nimporteOu) t.lens.nimporteOu += 1;
    if (avecPrix(r.propositions.lens) >= 3) t.lens.troisPrix += 1;
    if (exclu) {
      t.duCache += 1;
      continue;
    }
    const pb = paliers(jb.premiere);
    if (pb.dixPremieres) t.boutiques[groupe] += 1;
    if (pl.dixPremieres || pb.dixPremieres) t.ensemble[groupe] += 1;
    if (pb.premiere) t.boutiques.premiere += 1;
    if (pb.troisPremieres) t.boutiques.troisPremieres += 1;
    if (pb.nimporteOu) t.boutiques.nimporteOu += 1;
    if (avecPrix(r.propositions.boutiques) >= 3) t.boutiques.troisPrix += 1;
    if ((jl.premiere !== null && jl.premiere <= LENS_VISIBLES) || (jb.premiere !== null && jb.premiere <= BOUTIQUES_VISIBLES)) t.visibles += 1;
    const issue = issueComplement(r);
    t.issues[issue] = (t.issues[issue] ?? 0) + 1;
    const raison = complement?.noQueryReason;
    if (typeof raison === "string") t.raisonsSansRequete[raison] = (t.raisonsSansRequete[raison] ?? 0) + 1;
    if (r.durees.lancementMs !== null) {
      lancements.push(r.durees.lancementMs);
      if (r.durees.lancementMs < LIMITE_14S) t.durees.sous14 += 1;
      if (r.durees.lancementMs < LIMITE_15S) t.durees.sous15 += 1;
      if (r.durees.preparationMs !== null) {
        const attente = r.durees.preparationMs + r.durees.lancementMs;
        attentes.push(attente);
        if (attente < LIMITE_14S) t.durees.attenteSous14 += 1;
        if (attente < LIMITE_15S) t.durees.attenteSous15 += 1;
      }
    }
    const appelLens = r.ligne?.lens_from_cache === false ? nombreOuNull(r.ligne.call_seconds) : null;
    if (appelLens !== null) lens.push(appelLens * 1000);
    if (aiMs !== null) ia.push(aiMs);
    const shoppingMs = nombreOuNull(complement?.shoppingMs);
    if (shoppingMs !== null) boutiquesMs.push(shoppingMs);
    const totalMs = nombreOuNull(complement?.totalMs);
    if (totalMs !== null) {
      totalServeur.push(totalMs);
      if (appelLens !== null) baseEtEnvoi.push(Math.max(0, totalMs - appelLens * 1000 - (aiMs ?? 0) - (shoppingMs ?? 0)));
    }
  }
  t.durees.avecDuree = lancements.length;
  t.durees.medianeLancement = mediane(lancements);
  t.durees.avecAttente = attentes.length;
  t.durees.medianeAttente = mediane(attentes);
  t.durees.medianeLens = mediane(lens);
  t.durees.medianeIa = mediane(ia);
  t.durees.medianeBoutiques = mediane(boutiquesMs);
  t.durees.medianeTotalServeur = mediane(totalServeur);
  t.durees.medianeBaseEtEnvoi = mediane(baseEtEnvoi);
  return t;
}

function tableauCas(cas: readonly CasJuge[]): string[] {
  const lignes = [
    "| Cas | Marque visible | Cadre | Mots envoyés | Lens : propositions (avec prix) | Lens : bonne pièce | Complément | Boutiques (avec prix) | Boutiques : bonne pièce | Requête de l'IA | Cache | Durée | Crédits |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { resultat: r, lens, boutiques } of cas) {
    const mesure = r.issue === "mesure";
    const requete = r.reponse?.complement?.query ?? "";
    lignes.push(
      `| ${r.cas} | ${r.verite.marqueVisible ? "oui" : "non"} | ${r.envoi.cadreTrace ? "oui" : "image entière"} | ${r.envoi.mots ? "oui" : "non"} | ${
        mesure ? `${r.propositions.lens.length} (${avecPrix(r.propositions.lens)})` : cellule(`non mesuré : ${r.erreur ?? r.issue}`)
      } | ${mesure ? place(lens.premiere) : "—"} | ${cellule(issueComplement(r))} | ${mesure ? `${r.propositions.boutiques.length} (${avecPrix(r.propositions.boutiques)})` : "—"} | ${
        mesure ? place(boutiques.premiere) : "—"
      } | ${cellule(requete)} | ${celluleCache(r)} | ${secondes(r.durees.lancementMs)} | ${r.credits.total}${r.credits.estime ? " (estimé)" : ""} |`
    );
  }
  return lignes;
}

function liste(compte: Record<string, number>): string {
  const entrees = Object.entries(compte).sort((a, b) => b[1] - a[1]);
  return entrees.length === 0 ? "aucune" : entrees.map(([cle, n]) => `${cle} ${n}`).join(", ");
}

const fr = (n: number, sur: number) => `${n}/${sur}`;

function sectionPasse(passe: Exclude<Passe, "sans-mots">, cas: readonly CasJuge[]): string[] {
  const t = totaux(cas);
  const hc = t.horsCache;
  const lignes = [`## ${NOMS_PASSES[passe]}`, ""];
  lignes.push(`${t.mesures} cas mesurés sur ${cas.length}. « Bonne pièce » : dans les ${FENETRE_BANC} premières propositions de la liste, comme au banc.`, "");
  if (t.duCache > 0) {
    lignes.push(
      `⚠ ${t.duCache} cas servis par le cache (Lens déjà interrogé dans les 24 h) : exclus des durées et des boutiques ; leur premier lancement est dans la mesure précédente. Les colonnes « Boutiques » et « Lens ou boutiques » portent sur les ${hc.cas} autres cas.`,
      ""
    );
  }
  lignes.push(
    "| | Lens (cette mesure) | A du banc (Lens) | Boutiques de la voie C (cette mesure) | C du banc | Lens ou boutiques (10 premières de chaque) |",
    "|---|---|---|---|---|---|",
    `| Bonne pièce, marque visible | ${fr(t.lens.marqueVisible, t.marqueVisible)} | ${BANC_30_OCTOBRE.lens.marqueVisible} | ${fr(t.boutiques.marqueVisible, hc.marqueVisible)} | ${BANC_30_OCTOBRE.voieC.marqueVisible} | ${fr(t.ensemble.marqueVisible, hc.marqueVisible)} |`,
    `| Bonne pièce, autres cas | ${fr(t.lens.autres, t.autres)} | ${BANC_30_OCTOBRE.lens.autres} | ${fr(t.boutiques.autres, hc.autres)} | ${BANC_30_OCTOBRE.voieC.autres} | ${fr(t.ensemble.autres, hc.autres)} |`,
    `| Au moins 3 propositions avec prix | ${fr(t.lens.troisPrix, cas.length)} | ${BANC_30_OCTOBRE.lens.troisPrix} | ${fr(t.boutiques.troisPrix, hc.cas)} | ${BANC_30_OCTOBRE.voieC.troisPrix} | |`,
    `| Bonne pièce en 1re place | ${fr(t.lens.premiere, cas.length)} | | ${fr(t.boutiques.premiere, hc.cas)} | | |`,
    `| Bonne pièce dans les 3 premières | ${fr(t.lens.troisPremieres, cas.length)} | | ${fr(t.boutiques.troisPremieres, hc.cas)} | | |`,
    `| Bonne pièce n'importe où | ${fr(t.lens.nimporteOu, cas.length)} | | ${fr(t.boutiques.nimporteOu, hc.cas)} | | |`,
    `| Bonne pièce visible sans « Voir plus » (Lens : ${LENS_VISIBLES} premières ; boutiques : ${BOUTIQUES_VISIBLES} premières) | | | | | ${fr(t.visibles, hc.cas)} |`,
    "",
    `Issues du complément : ${liste(t.issues)}.${Object.keys(t.raisonsSansRequete).length > 0 ? ` Pas de requête sûre (no_query) : ${liste(t.raisonsSansRequete)}.` : ""}`,
    "",
    `Durées${t.duCache > 0 ? " (hors cas servis par le cache)" : ""} :`,
    `- temps côté serveur, vu depuis ce Mac (photo envoyée → résultat final avec le complément) : médiane ${secondes(t.durees.medianeLancement)} ; ${t.durees.sous14}/${t.durees.avecDuree} sous 14 s ; ${t.durees.sous15}/${t.durees.avecDuree} sous 15 s (banc : C ${BANC_30_OCTOBRE.voieC.mediane}, ${BANC_30_OCTOBRE.voieC.sous15s} sous 15 s ; A ${BANC_30_OCTOBRE.lens.mediane}) ;`,
    `- attente minimale de la personne (préparation + lancement : l'app prépare la recherche au moment de « Lancer ») : médiane ${secondes(t.durees.medianeAttente)} ; ${t.durees.attenteSous14}/${t.durees.avecAttente} sous 14 s ; ${t.durees.attenteSous15}/${t.durees.avecAttente} sous 15 s ;`,
    "- non mesurés ici : l'envoi de la photo par le réseau mobile et le trajet jusqu'au serveur de Render (ce Mac parle à un serveur sur lui-même) ;",
    `- appel à Lens seul (à la seconde près) : médiane ${secondes(t.durees.medianeLens)} ; IA : ${secondes(t.durees.medianeIa)} ; Google Shopping : ${secondes(t.durees.medianeBoutiques)} ; total mesuré par le serveur : ${secondes(t.durees.medianeTotalServeur)} ; base et envoi (total du serveur − Lens − IA − Google Shopping, à la seconde près) : ${secondes(t.durees.medianeBaseEtEnvoi)}.`,
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

/** Passe 2 de --les-deux : IA coupée, Lens servi par le cache. Seule la
 * liste de Lens compte (l'ordre de Google sans vos mots) : pas de boutiques,
 * et des durées sans valeur (cache). Tout appel payant y est listé. */
function sectionSecondePasse(sans: readonly CasJuge[], avec: readonly CasJuge[]): string[] {
  const t = totaux(sans, { exclureCache: false });
  const relances = new Set(sans.map((c) => c.resultat.cas));
  const nonRelances = avec.filter((a) => !relances.has(a.resultat.cas) && !lensARepondu(a.resultat)).map((a) => a.resultat.cas);
  const payants = sans.filter(({ resultat: r }) => nombreOuNull(r.journal?.complement?.aiMs) !== null || (nombreOuNull(r.journal?.complement?.calls) ?? 0) > 0 || r.credits.total > 0);
  const lignes = [
    `## ${NOMS_PASSES["sans-mots"]}`,
    "",
    `${t.mesures} cas mesurés sur ${sans.length} relancés. Seule la liste de Lens compte ici : l'ordre de Google, sans vos mots. Boutiques et durées non mesurées : IA coupée pour cette passe, réponses servies par le cache (non représentatives).`,
    "",
    "| | Lens, sans vos mots | A du banc (Lens) |",
    "|---|---|---|",
    `| Bonne pièce, marque visible | ${fr(t.lens.marqueVisible, t.marqueVisible)} | ${BANC_30_OCTOBRE.lens.marqueVisible} |`,
    `| Bonne pièce, autres cas | ${fr(t.lens.autres, t.autres)} | ${BANC_30_OCTOBRE.lens.autres} |`,
    `| Au moins 3 propositions avec prix | ${fr(t.lens.troisPrix, sans.length)} | ${BANC_30_OCTOBRE.lens.troisPrix} |`,
    `| Bonne pièce en 1re place | ${fr(t.lens.premiere, sans.length)} | |`,
    `| Bonne pièce dans les 3 premières | ${fr(t.lens.troisPremieres, sans.length)} | |`,
    `| Bonne pièce n'importe où | ${fr(t.lens.nimporteOu, sans.length)} | |`,
    "",
    `Cas non relancés (Lens sans réponse en passe 1 : il aurait été refacturé) : ${nonRelances.length > 0 ? nonRelances.join(", ") : "aucun"}.`,
    `Appels payants en passe 2 : ${
      payants.length === 0
        ? "aucun"
        : payants
            .map(({ resultat: r }) => {
              const appels = [nombreOuNull(r.journal?.complement?.aiMs) !== null ? "IA" : "", (nombreOuNull(r.journal?.complement?.calls) ?? 0) > 0 ? "Google Shopping" : "", r.credits.lens > 0 ? "Lens (cache absent)" : ""].filter(Boolean);
              return `cas ${r.cas} (${appels.join(", ") || "estimé"}, ${r.credits.total} crédit(s))`;
            })
            .join(" ; ")
    }. Crédits SerpApi de la passe 2 : ${t.credits.total}.`,
    "",
    "| Cas | Marque visible | Cadre | Lens : propositions (avec prix) | Lens : bonne pièce | Complément | Cache | Crédits |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const { resultat: r, lens } of sans) {
    const mesure = r.issue === "mesure";
    lignes.push(
      `| ${r.cas} | ${r.verite.marqueVisible ? "oui" : "non"} | ${r.envoi.cadreTrace ? "oui" : "image entière"} | ${
        mesure ? `${r.propositions.lens.length} (${avecPrix(r.propositions.lens)})` : cellule(`non mesuré : ${r.erreur ?? r.issue}`)
      } | ${mesure ? place(lens.premiere) : "—"} | ${cellule(issueComplement(r))} | ${celluleCache(r)} | ${r.credits.total}${r.credits.estime ? " (estimé)" : ""} |`
    );
  }
  lignes.push("");
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
  const memeLens = paires.filter(([a, s]) => s.resultat.ligne?.lens_from_cache === true && a.resultat.envoi.empreinteZone === s.resultat.envoi.empreinteZone).length;
  return [
    "## Effet de vos mots sur Lens",
    "",
    `Sur ${paires.length} cas mesurés deux fois. Vos mots ne partent jamais chez Google : ils ne font que remonter les propositions dont le titre les contient. Ils ne changent pas non plus les boutiques (l'IA lit les titres Lens dans l'ordre de Google) : la passe 2, IA coupée, n'en mesure pas.`,
    `- Bonne pièce en 1re place : ${premiereAvec} avec vos mots, ${premiereSans} sans.`,
    `- Bonne pièce dans les 3 premières : ${troisAvec} avec, ${troisSans} sans.`,
    `- Même image analysée et réponse de Lens lue dans le cache à la 2e passe : ${memeLens}/${paires.length}.`,
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
  /** Lancements refaits par une reprise : leurs crédits ont été dépensés. */
  remplaces?: readonly ResultatCas[];
  jugements: EtatJugements;
  /** Dossier de la mesure, pour la commande de nettoyage citée. */
  dossier?: string;
}

function ligneComptes(nettoyage: MetaMesure["nettoyage"], dossier: string | null): string {
  return `${nettoyage.supprimes}/${nettoyage.comptes} supprimés avec leurs recherches${
    nettoyage.restes.length > 0 ? ` — ⚠ à supprimer : ${nettoyage.restes.join(", ")} (${commandeNettoyer(dossier)} ; à défaut, 15 min plus tard, pnpm --filter backend nettoyer-comptes-test-dev)` : ""
  }`;
}

/** Le rapport complet, en Markdown. */
export function construireRapport({ meta, resultats, remplaces = [], jugements, dossier }: EntreeRapport): string {
  const passes: Passe[] = meta.mots === "les-deux" ? ["avec-mots", "sans-mots"] : ["unique"];
  const parPasse = new Map(passes.map((passe) => [passe, resultats.filter((r) => r.passe === passe).sort((a, b) => a.cas - b.cas).map((r) => jugerCas(r, jugements))]));
  const tous = [...parPasse.values()].flat();
  const creditsRemplaces = remplaces.reduce((somme, r) => somme + r.credits.total, 0);
  const credits = tous.reduce((somme, c) => somme + c.resultat.credits.total, 0) + creditsRemplaces;
  const premierePasse = passes[0]!;
  const duCache = (parPasse.get(premierePasse) ?? []).filter((c) => c.resultat.issue === "mesure" && lensDuCache(c.resultat)).length;
  const entreesCache = [...resultats, ...remplaces].reduce((somme, r) => somme + entreesDeCache(r), 0);
  const { avant, entrePasses, apres } = meta.compteurs;
  const dejaDepenses = meta.plan.dejaDepenses ?? 0;
  const lignes = [
    `# Mesure de la voie C — ${dateDeParis(meta.debut)} (heure de Paris)`,
    "",
    "## Ce qui a été mesuré",
    "",
    `- Le VRAI serveur de Spotto, lancé sur ce Mac (commit ${meta.serveur.commit ?? "inconnu"} ; code du serveur ${
      meta.serveur.identiqueAMain === true ? `identique à main en ligne, ${meta.serveur.commitMain}` : meta.serveur.identiqueAMain === false ? `⚠ DIFFÉRENT de main en ligne (${meta.serveur.commitMain})` : "non comparé à main"
    }), voie C et son IA allumées pour lui seul, base spotto-dev-2.`,
    `- ${meta.reprise ? `${resultats.length} cas dans ce rapport (mesure reprise)` : `${resultats.length} lancement(s) sur ${meta.plan.cas} photos`}, chaque photo envoyée comme l'app : réduite à 1 600 px (JPEG 0,85), puis préparation, lancement et attente du résultat final avec le complément.`,
    ...(meta.reprise
      ? [`- Mesure reprise (--reprendre) : ${meta.reprise.casGardes} cas gardés de la mesure du ${dateDeParis(meta.reprise.debutPrecedent)}, refaits ici : ${meta.reprise.casRefaits.length > 0 ? meta.reprise.casRefaits.join(", ") : "aucun"}.`]
      : []),
    `- Cadres : ${meta.cadres.nombre} cas avec un cadre (${meta.cadres.chemin})${
      meta.cadres.tracesParClaude ? ", tracés par Claude le 30 octobre et À VALIDER par le fondateur" : ""
    } ; chaque côté porté à 12 % au moins, comme l'app ; les autres cas en image entière. L'image analysée de chaque cas est dans zones/.`,
    `- Vos mots : ${meta.mots === "avec" ? "envoyés comme dans l'app (ils trient seulement les résultats de Lens)" : meta.mots === "sans" ? "non envoyés" : "passe 1 avec, passe 2 sans (IA coupée en passe 2)"}.`,
    `- « Bonne pièce » : ${
      jugements.etat === "lu" ? "jugement du fondateur (jugements.txt) d'abord, puis la règle du banc" : "règle du banc (semblePiece), reproduite ici d'après sa description ; seuils et traductions pas forcément identiques au banc"
    } — ${REGLE_BONNE_PIECE}.${jugements.etat === "format-a-venir" ? " ⚠ jugements.txt existe, mais son format n'est pas encore pris en charge : refaire le rapport quand il le sera (--refaire-rapport)." : ""}`,
    `- Google Lens chez SerpApi (page d'état, au départ) : ${meta.etatLens}.`,
    "",
    "## En bref",
    "",
    `- Crédits SerpApi dépensés : ${credits} (plafond fixé : ${meta.plan.plafond}${dejaDepenses > 0 ? ` pour la journée, dont ${dejaDepenses} déjà dépensés avant cette mesure` : ""})${
      creditsRemplaces > 0 ? ` — dont ${creditsRemplaces} pour des lancements refaits ensuite (cas-…remplace-….json)` : ""
    }.${
      avant && apres ? ` Compteur de spotto-dev-2 pour ce cycle : ${avant.mois} avant, ${entrePasses ? `${entrePasses.mois} entre les passes, ` : ""}${apres.mois} après (il compte aussi les autres essais faits en même temps sur spotto-dev-2).` : ""
    }`,
    meta.arret ? `- ⚠ Mesure arrêtée avant la fin : ${meta.arret}.` : "- Mesure allée au bout.",
    `- Comptes d'essai : ${ligneComptes(meta.nettoyage, dossier ?? null)}.`,
    ...(meta.precedentes ?? []).map(
      (precedente) => `- Exécution précédente du ${dateDeParis(precedente.debut)} : ${precedente.arret ? `arrêtée (${precedente.arret})` : "allée au bout"} ; comptes d'essai ${ligneComptes(precedente.nettoyage, dossier ?? null)}.`
    ),
    ...(duCache > 0
      ? [`- ⚠ ${duCache} cas de ${premierePasse === "unique" ? "cette mesure" : "la passe 1"} servis par le cache (Lens déjà interrogé dans les 24 h) : exclus des durées et des boutiques ; leur premier lancement est dans une mesure précédente.`]
      : []),
    `- Cache du serveur sur spotto-dev-2 : environ ${entreesCache} entrée(s) laissée(s) (réponses de Lens, requêtes de l'IA, Google Shopping), sans compte ni recherche ; ignorées après 24 h et effacées par le serveur au premier « préparer » qui suit.`,
    ...meta.avertissements.map((a) => `- ⚠ ${a}`),
    "",
  ];
  for (const passe of passes) {
    if (passe === "sans-mots") lignes.push(...sectionSecondePasse(parPasse.get("sans-mots") ?? [], parPasse.get("avec-mots") ?? []));
    else lignes.push(...sectionPasse(passe, parPasse.get(passe) ?? []));
  }
  if (meta.mots === "les-deux") lignes.push(...sectionEffetDesMots(parPasse.get("avec-mots") ?? [], parPasse.get("sans-mots") ?? []));
  lignes.push(
    "## Comment lire ce rapport",
    "",
    "- « Lens » : les résultats de Google Lens, dans l'ordre où l'app les montre, c'est-à-dire triés par vos mots ; l'ordre de Google sans vos mots ne se lit que dans la passe 2 de --les-deux. « Boutiques » : « Cette pièce dans d'autres boutiques », le complément de la voie C (l'IA lit les titres Lens, écrit une requête, Google Shopping cherche).",
    "- Complément : shown = des boutiques montrées ; empty = requête faite, rien gardé ; no_query = pas de requête sûre ; ai_failed = l'IA a échoué ; no_time = plus le temps (14 s) ; no_capacity = plafond ; skipped = IA coupée ; error = anomalie.",
    "- Le banc du 30 octobre utilisait des images floutées et sa propre voie C : la comparaison donne un ordre d'idée, pas une égalité stricte.",
    "- Deux écarts de méthode avec le banc : (1) la liste Lens d'ici est triée par vos mots (l'ordre de Google est dans la passe 2 de --les-deux) ; (2) avec la règle 12 stricte (approuvée le 2 novembre), l'IA n'écrit aucune requête quand aucune marque n'apparaît dans au moins deux titres Lens : les « autres cas » finissent souvent en no_query, et ne sont pas comparables à C du banc.",
    `- « Lens ou boutiques (10 premières de chaque) » : la bonne pièce est dans l'une ou l'autre liste. La personne n'en voit d'emblée que les ${LENS_VISIBLES} premières de Lens et les ${BOUTIQUES_VISIBLES} premières boutiques, le reste derrière « Voir plus » : ligne « visible sans « Voir plus » ».`,
    `- Le cache du serveur garde les réponses 24 h : relancée avant le ${dateDeParis(meta.debut, JOUR_MS)}, la même mesure serait en partie servie par le cache (colonne « Cache », lens_from_cache dans les JSON) ; ces cas sont alors exclus des durées et des boutiques. Pour finir une mesure arrêtée : --reprendre <dossier> (seuls les cas absents ou en panne sont relancés).`,
    "- Durées : « temps côté serveur, vu depuis ce Mac » va de l'envoi de la photo au résultat final ; l'attente de la personne y ajoute au moins la préparation (faite au moment de « Lancer »), puis l'envoi par le réseau mobile et le trajet jusqu'à Render, non mesurés ici.",
    "- Chaque cas a son JSON brut (cas-NN….json) : titres, prix, sites, requête de l'IA, durées, crédits, lignes de mesure du serveur.",
    ""
  );
  return lignes.join("\n");
}
