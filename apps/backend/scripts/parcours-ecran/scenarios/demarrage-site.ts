// Démarrage du site : jamais une page vide (demande du fondateur, 2026-10-16).
//
//   pnpm --filter backend parcours-ecran demarrage-site [fr-clair|…]
//
// Un compte connecté rouvre le site pendant que le serveur tarde à donner son
// profil (réponse retardée par le navigateur lui-même, rien ne change côté
// serveur) :
// 1. réponse lente (8 s) : « Connexion à Spotto… », puis, après 3 s, « Spotto
//    se réveille… », puis l'app ;
// 2. premier essai sans réponse : abandonné au bout de 15 s, l'écran
//    « connexion » patiente (avec « Se déconnecter »), le second essai réussit ;
// 3. tous les essais en échec : « Spotto est momentanément injoignable. »,
//    puis « Réessayer » ouvre l'app.
// Dans les 4 combinaisons. Statistiques : clé PostHog FACTICE, envois
// interceptés ; aucun appel à SerpApi ni à l'IA.
import type { Page, Route } from "playwright-core";
import type { Parcours } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { check, ouvrirSpotter, visible, type Envoi } from "./spotter-outils.js";
import { capteur, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";
import { allerA } from "./lot-5-partage.js";

export const name = "Démarrage du site : jamais une page vide";
export const outputDir = "demarrage-site-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const T = {
  fr: {
    connexion: "Connexion à Spotto…",
    reveil: "Spotto se réveille…",
    deconnecter: "Se déconnecter",
    injoignable: "Spotto est momentanément injoignable.",
    reessayer: "Réessayer",
  },
  en: {
    connexion: "Connecting to Spotto…",
    reveil: "Spotto is waking up…",
    deconnecter: "Sign out",
    injoignable: "Spotto is temporarily unreachable.",
    reessayer: "Try again",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const PROFIL = "**/api/me";
const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rouvre le site (le site redémarre) et attend l'accueil du Spotter. */
async function rouvrir(p: Parcours, page: Page, combo: Combo, attente: (page: Page) => Promise<void>): Promise<void> {
  await allerA(p, page, "/", () => attente(page));
  await visible(page, TEXTES[combo.locale].ajouterVideo).waitFor({ timeout: 60_000 });
}

/** 1. Profil lent : connexion, puis réveil, puis l'app. */
async function profilLent(p: Parcours, page: Page, combo: Combo, capture: (nom: string) => Promise<void>) {
  const M = T[combo.locale];
  const lent = async (route: Route) => {
    await attendre(8_000);
    await route.continue().catch(() => {});
  };
  await page.route(PROFIL, lent);
  await rouvrir(p, page, combo, async () => {
    await visible(page, M.connexion).waitFor({ timeout: 2_500 });
    await capture("01-connexion");
    await visible(page, M.reveil).waitFor({ timeout: 6_000 });
    await capture("02-reveil");
  });
  await page.unroute(PROFIL, lent);
}

/** 2. Premier essai sans réponse : abandonné, relancé, réussi. */
async function essaiSansReponse(p: Parcours, page: Page, combo: Combo, capture: (nom: string) => Promise<void>) {
  const M = T[combo.locale];
  let essais = 0;
  const muet = async (route: Route) => {
    essais += 1;
    if (essais === 1) await attendre(20_000);
    await route.continue().catch(() => {});
  };
  await page.route(PROFIL, muet);
  await rouvrir(p, page, combo, async () => {
    // L'écran « connexion » (avec « Se déconnecter ») : l'essai muet a été abandonné.
    await visible(page, M.deconnecter).waitFor({ timeout: 25_000 });
    await visible(page, M.reveil).waitFor({ timeout: 2_000 });
    await capture("03-relance");
  });
  await page.unroute(PROFIL, muet);
}

/** 3. Tous les essais en échec : « injoignable », puis « Réessayer ». */
async function echec(p: Parcours, page: Page, combo: Combo, capture: (nom: string) => Promise<void>) {
  const M = T[combo.locale];
  const refus = (route: Route) => route.abort("failed");
  await page.route(PROFIL, refus);
  await allerA(p, page, "/", () => visible(page, M.injoignable).waitFor({ timeout: 90_000 }));
  await capture("04-injoignable");
  await page.unroute(PROFIL, refus);
  await page.getByRole("button", { name: M.reessayer, exact: true }).click();
  await visible(page, TEXTES[combo.locale].ajouterVideo).waitFor({ timeout: 30_000 });
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  const combos = p.args.length > 0 ? COMBOS.filter((combo) => p.args.includes(combo.id)) : COMBOS;
  for (const combo of combos) {
    await p.step(`${combo.id} : profil lent, essai sans réponse, serveur injoignable`, async () => {
      const envois: Envoi[] = [];
      const compte = await nouveauCompte(p, `ds${combo.id.replace("-", "").slice(0, 4)}`);
      const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
      const capture = capteur(p, page, combo, problemes);
      await profilLent(p, page, combo, capture);
      await essaiSansReponse(p, page, combo, capture);
      await echec(p, page, combo, capture);
      await page.context().close();
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
