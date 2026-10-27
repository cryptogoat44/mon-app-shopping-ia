// Fiabilité des résultats — bouton « Résultat incohérent », sur le site.
//
//   pnpm --filter backend parcours-ecran fiabilite-signalement
//
// Dans les 4 combinaisons (français clair et sombre, anglais clair et sombre),
// une administratrice (Alix) puis un compte ordinaire (Louise) :
// - une recherche déjà faite, rangée directement dans spotto-dev avec des
//   images de notre stockage (aucun appel à SerpApi ni à l'IA), ouverte dans
//   l'écran des résultats ;
// - « … » ouvre la feuille ; « Envoyer » reste grisé sans motif ; un motif,
//   envoi, « Merci, c'est noté. », « Signalé : motif » ; changer de motif ;
//   retirer — et la base ne garde que le motif, rien d'autre ;
// - Louise a déjà fait 30 signalements aujourd'hui : le 31ᵉ est refusé, avec
//   le message clair dans la feuille.
// Statistiques : clé PostHog FACTICE, envois interceptés (rien ne sort).
import type { Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import { MATCH_FEEDBACK_DAILY_LIMIT } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { check, ouvrirSpotter, visible, type Envoi } from "./spotter-outils.js";
import { capteur, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Fiabilité des résultats — bouton « Résultat incohérent » (site)";
export const outputDir = "fiabilite-signalement-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const TEXTES_SIGNALEMENT = {
  fr: {
    menu: "Signaler un résultat incohérent",
    titre: "Résultat incohérent",
    question: "Qu'est-ce qui ne va pas ?",
    pieceCherchee: "Ce n'est pas la pièce cherchée (autre type, autre couleur, autre modèle)",
    prix: "Prix faux ou absent",
    envoyer: "Envoyer",
    retirer: "Retirer mon signalement",
    merci: "Merci, c'est noté.",
    retire: "Signalement retiré.",
    signale: (motif: string) => `Signalé : ${motif}`,
    limite: "Vous avez atteint la limite de signalements pour aujourd'hui. Merci de votre aide : vous pourrez en envoyer d'autres demain.",
  },
  en: {
    menu: "Report an inconsistent result",
    titre: "Inconsistent result",
    question: "What's wrong?",
    pieceCherchee: "Not the piece I was looking for (different type, color or model)",
    prix: "Wrong or missing price",
    envoyer: "Send",
    retirer: "Withdraw my report",
    merci: "Thank you, noted.",
    retire: "Report withdrawn.",
    signale: (motif: string) => `Reported: ${motif}`,
    limite: "You've reached today's limit of reports. Thank you for your help: you can send more tomorrow.",
  },
} as const satisfies Record<Locale, Record<string, unknown>>;

// Noms neutres (ni français ni anglais courant) : le contrôle de la langue de
// la page ne doit pas confondre un nom de pièce avec un texte de l'app.
const PIECES = [
  { nom: "Camel Suede Jacket", fond: "#8A5A3C", prix: 189 },
  { nom: "Cognac Bomber", fond: "#6E4B32", prix: 245 },
  { nom: "Tan Overshirt", fond: "#9C6B48", prix: null },
];

const LIGNES = z.array(z.object({ id: z.string(), rank: z.number() }));

/** Une recherche aboutie, rangée directement : propositions avec de vraies images de notre stockage. */
async function rechercheFaite(p: Parcours, compte: TestAccount, nombre = PIECES.length): Promise<{ searchId: string; matchIds: string[] }> {
  const { data: recherche, error } = await p.admin
    .from("product_searches")
    .insert({ user_id: compte.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed", outcome: "found" })
    .select("id")
    .single();
  check(!error && recherche !== null, `recherche rangée (${error?.message ?? "ok"})`);
  const lignes = [];
  for (let rang = 1; rang <= nombre; rang += 1) {
    const piece = PIECES[(rang - 1) % PIECES.length]!;
    const image = await sharp({ create: { width: 640, height: 800, channels: 3, background: piece.fond } }).jpeg({ quality: 80 }).toBuffer();
    const chemin = `${compte.id}/fiabilite-${rang}.jpg`;
    check(!(await p.admin.storage.from("post-media").upload(chemin, image, { contentType: "image/jpeg", upsert: true })).error, "image de la proposition");
    const adresse = p.admin.storage.from("post-media").getPublicUrl(chemin).data.publicUrl;
    lignes.push({
      search_id: recherche.id,
      rank: rang,
      product_name: rang <= PIECES.length ? piece.nom : `${piece.nom} ${rang}`,
      image_url: adresse,
      image_hd_url: adresse,
      price_min: piece.prix,
      price_max: piece.prix,
      currency: piece.prix === null ? null : "€",
      merchant_name: "Example",
      merchant_url: `https://example.com/piece-${rang}`,
    });
  }
  const { data, error: erreurLignes } = await p.admin.from("product_matches").insert(lignes).select("id, rank");
  check(!erreurLignes, `propositions rangées (${erreurLignes?.message ?? "ok"})`);
  return { searchId: recherche.id, matchIds: LIGNES.parse(data).sort((a, b) => a.rank - b.rank).map((l) => l.id) };
}

async function motifsRanges(p: Parcours, compte: TestAccount): Promise<string[]> {
  const { data } = await p.admin.from("match_feedback").select("*").eq("user_id", compte.id);
  const lignes = z.array(z.record(z.unknown())).parse(data ?? []);
  for (const ligne of lignes) {
    check(Object.keys(ligne).sort().join(",") === "created_at,id,match_id,reason,updated_at,user_id", "seul le motif est rangé, rien d'autre");
  }
  return lignes.map((ligne) => String(ligne.reason));
}

async function ouvrirResultats(p: Parcours, compte: TestAccount, combo: Combo, envois: Envoi[], searchId: string): Promise<Page> {
  const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
  // Une erreur de l'app (écran blanc) est remontée telle quelle, sans attendre en vain.
  const erreurs: string[] = [];
  page.on("pageerror", (erreur) => erreurs.push(erreur.message));
  page.on("console", (message) => {
    if (message.type() === "error") erreurs.push(message.text());
  });
  await page.goto(`${p.siteUrl}/spot/result?searchId=${searchId}`);
  try {
    await visible(page, PIECES[0]!.nom).waitFor({ timeout: 30_000 });
  } catch (erreur) {
    throw new Error(`écran des résultats non affiché (${erreurs.join(" | ") || "aucune erreur de la page"}) : ${String(erreur)}`);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

async function envoyerMotif(page: Page, combo: Combo, motif: string): Promise<void> {
  const M = TEXTES_SIGNALEMENT[combo.locale];
  await page.getByRole("radio", { name: motif, exact: true }).click();
  const envoyer = page.getByRole("button", { name: M.envoyer, exact: true });
  check((await envoyer.getAttribute("aria-disabled")) !== "true", "« Envoyer » actif avec un motif choisi");
  await envoyer.click();
}

/** Alix, administratrice : signaler, changer de motif, retirer. */
async function administratrice(p: Parcours, combo: Combo, envois: Envoi[], problemes: string[]): Promise<void> {
  const M = TEXTES_SIGNALEMENT[combo.locale];
  const alix = await nouveauCompte(p, `fa${combo.id.replace("-", "").slice(0, 4)}`);
  check(!(await p.admin.from("admins").insert({ user_id: alix.id })).error, "rôle d'administratrice d'Alix (spotto-dev)");
  const { searchId } = await rechercheFaite(p, alix);
  const page = await ouvrirResultats(p, alix, combo, envois, searchId);
  const capture = capteur(p, page, combo, problemes);
  await capture("01-resultats-bouton");

  await page.getByRole("button", { name: M.menu, exact: true }).click();
  await visible(page, M.question).waitFor();
  check((await page.getByRole("button", { name: M.envoyer, exact: true }).getAttribute("aria-disabled")) === "true", "« Envoyer » grisé sans motif");
  await capture("02-feuille-sans-motif");
  await page.getByRole("radio", { name: M.pieceCherchee, exact: true }).click();
  await capture("03-motif-choisi");
  await envoyerMotif(page, combo, M.pieceCherchee);
  await visible(page, M.merci).waitFor({ timeout: 20_000 });
  await visible(page, M.signale(M.pieceCherchee)).waitFor();
  await capture("04-signale");
  check((await motifsRanges(p, alix)).join() === "wrong_item", "motif rangé : pas la pièce cherchée");

  await visible(page, M.signale(M.pieceCherchee)).click();
  await visible(page, M.retirer).waitFor();
  await envoyerMotif(page, combo, M.prix);
  await visible(page, M.signale(M.prix)).waitFor({ timeout: 20_000 });
  check((await motifsRanges(p, alix)).join() === "wrong_price", "motif changé : prix");

  await visible(page, M.signale(M.prix)).click();
  await visible(page, M.retirer).click();
  await visible(page, M.retire).waitFor({ timeout: 20_000 });
  check((await visible(page, M.signale(M.prix)).count()) === 0, "mention « Signalé » retirée");
  await capture("05-signalement-retire");
  check((await motifsRanges(p, alix)).length === 0, "signalement retiré de la base");
  await page.context().close();
}

/** Louise, compte ordinaire : 30 signalements déjà faits aujourd'hui, le 31ᵉ est refusé. */
async function compteOrdinaire(p: Parcours, combo: Combo, envois: Envoi[], problemes: string[]): Promise<void> {
  const M = TEXTES_SIGNALEMENT[combo.locale];
  const louise = await nouveauCompte(p, `fl${combo.id.replace("-", "").slice(0, 4)}`);
  const { searchId } = await rechercheFaite(p, louise);
  const autre = await rechercheFaite(p, louise, MATCH_FEEDBACK_DAILY_LIMIT);
  const deja = autre.matchIds.map((match_id) => ({ user_id: louise.id, match_id, reason: "duplicate" }));
  check(!(await p.admin.from("match_feedback").insert(deja)).error, "30 signalements déjà faits aujourd'hui");

  const page = await ouvrirResultats(p, louise, combo, envois, searchId);
  const capture = capteur(p, page, combo, problemes);
  await page.getByRole("button", { name: M.menu, exact: true }).click();
  await visible(page, M.question).waitFor();
  await envoyerMotif(page, combo, M.prix);
  await visible(page, M.limite).waitFor({ timeout: 20_000 });
  await capture("06-limite-du-jour");
  check((await motifsRanges(p, louise)).length === MATCH_FEEDBACK_DAILY_LIMIT, "rien de plus n'est rangé au-delà de la limite");
  await page.context().close();
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  // « fr-clair », « en-sombre »… : seulement ces combinaisons (relance ciblée).
  const combos = p.args.length > 0 ? COMBOS.filter((combo) => p.args.includes(combo.id)) : COMBOS;
  for (const combo of combos) {
    await p.step(`${combo.id} : administratrice (signaler, changer, retirer), compte ordinaire (limite du jour)`, async () => {
      const envois: Envoi[] = [];
      await administratrice(p, combo, envois, problemes);
      await compteOrdinaire(p, combo, envois, problemes);
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
