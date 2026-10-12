// Lot 5 — modération minimaliste (5.B), sur le site.
//
//   pnpm --filter backend parcours-ecran lot-5
//
// Trois comptes par combinaison : une administratrice (Alix, ajoutée à la
// table « admins » de spotto-dev), l'autrice d'une publication (Louise) et la
// personne qui signale (Camille). Camille signale la publication et le
// profil de Louise ; Alix masque la publication puis suspend le compte, avec
// motif et précision ; Louise est informée (motif), Camille aussi
// (« traité ») ; l'entrée « Modération » n'existe que pour Alix ; enfin Alix
// annule tout et Louise en est informée. Dans les 4 combinaisons (français
// clair et sombre, anglais clair et sombre). Statistiques : clé PostHog
// FACTICE, envois interceptés (rien ne sort) ; aucun appel à SerpApi ni à
// l'IA.
import type { Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { attendreEnvoi, check, ouvrirSpotter, visible, type Envoi } from "./spotter-outils.js";
import { capteur, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Lot 5 — modération minimaliste (site)";
export const outputDir = "lot-5-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const TEXTES_MODERATION = {
  fr: {
    entree: "Modération",
    aTraiter: "À traiter",
    traites: "Traités",
    publication: "Publication · 1 signalement",
    profil: "Profil · 1 signalement",
    motifs: "Harcèlement × 1",
    masquer: "Masquer la publication",
    suspendre: "Suspendre le compte",
    precision: "Précision pour la personne concernée (facultatif)",
    confirmerMasquage: "Confirmer le masquage",
    avertissement: /^Suspendre ce compte \?/,
    confirmerSuspension: "Confirmer la suspension",
    enregistree: "Décision enregistrée.",
    vide: "Aucun signalement à traiter.",
    retablir: "Rétablir la publication",
    lever: "Lever la suspension",
    annulee: "Décision annulée.",
    masquee: "Votre publication a été masquée par la modération.",
    motif: "Motif : Harcèlement",
    suspendu: /^Votre compte a été suspendu/,
    traitePublication: "Votre signalement d'une publication a été traité. Merci.",
    traiteProfil: "Votre signalement d'un profil a été traité. Merci.",
    supprimerCompte: "Supprimer mon compte",
    retablie: "Votre publication a été rétablie.",
    levee: "La suspension de votre compte a été levée.",
    activite: "Activité",
  },
  en: {
    entree: "Moderation",
    aTraiter: "To review",
    traites: "Reviewed",
    publication: "Post · 1 report",
    profil: "Profile · 1 report",
    motifs: "Harassment × 1",
    masquer: "Hide the post",
    suspendre: "Suspend the account",
    precision: "Details for the person concerned (optional)",
    confirmerMasquage: "Confirm hiding",
    avertissement: /^Suspend this account\?/,
    confirmerSuspension: "Confirm suspension",
    enregistree: "Decision saved.",
    vide: "No reports to review.",
    retablir: "Restore the post",
    lever: "Lift the suspension",
    annulee: "Decision reversed.",
    masquee: "Your post was hidden by moderation.",
    motif: "Reason: Harassment",
    suspendu: /^Your account was suspended/,
    traitePublication: "Your report about a post has been reviewed. Thank you.",
    traiteProfil: "Your report about a profile has been reviewed. Thank you.",
    supprimerCompte: "Delete my account",
    retablie: "Your post was restored.",
    levee: "Your account suspension was lifted.",
    activite: "Activity",
  },
} as const satisfies Record<Locale, Record<string, string | RegExp>>;

interface Comptes {
  alix: TestAccount;
  louise: TestAccount;
  camille: TestAccount;
  postId: string;
}

async function ok(response: Response, what: string): Promise<Response> {
  check(response.ok, `${what} (${response.status})`);
  return response;
}

/** Trois comptes neufs ; Louise publie, Camille la suit puis signale la publication et le profil (données neutres). */
async function preparer(p: Parcours, combo: Combo): Promise<Comptes> {
  const id = combo.id.replace("-", "").slice(0, 4);
  const [alix, louise, camille] = [
    await nouveauCompte(p, `a${id}`),
    await nouveauCompte(p, `l${id}`),
    await nouveauCompte(p, `c${id}`),
  ];
  await p.admin.from("profiles").update({ display_name: "Alix (test)" }).eq("id", alix.id);
  await p.admin.from("profiles").update({ display_name: "Camille (test)" }).eq("id", camille.id);
  const { error } = await p.admin.from("admins").insert({ user_id: alix.id });
  check(!error, "rôle d'administratrice d'Alix (spotto-dev)");

  const photo = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#6B4A3A" } }).jpeg().toBuffer();
  const form = new FormData();
  form.append("type", "lifestyle");
  form.append("privacy", "public");
  form.append("caption", "Kelly 28");
  form.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "kelly.jpg");
  const post = z.object({ id: z.string().uuid() }).parse(await (await ok(await p.api(louise, "POST", "/api/posts", form), "publication de Louise")).json());
  await ok(await p.api(camille, "POST", `/api/follows/${louise.id}`), "abonnement de Camille");
  await ok(await p.api(camille, "POST", "/api/reports", { targetType: "post", targetId: post.id, reason: "harassment", note: "✦ 1" }), "signalement");
  await ok(await p.api(camille, "POST", "/api/reports", { targetType: "user", targetId: louise.id, reason: "spam", note: "✦ 2" }), "signalement");
  return { alix, louise, camille, postId: post.id };
}

async function ouvrir(p: Parcours, compte: TestAccount, combo: Combo, envois: Envoi[], chemin: string, attendu: string | RegExp): Promise<Page> {
  const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
  await page.goto(`${p.siteUrl}${chemin}`);
  await page.getByText(attendu).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  return page;
}

/** Alix : entrée des Réglages, file « À traiter », masquage puis suspension (motif, précision, confirmation). */
async function decider(p: Parcours, page: Page, combo: Combo, c: Comptes, envois: Envoi[], capture: (nom: string) => Promise<void>, complet: boolean) {
  const M = TEXTES_MODERATION[combo.locale];
  await page.getByRole("link", { name: M.entree, exact: true }).scrollIntoViewIfNeeded();
  await capture("01-reglages-administratrice");
  await page.getByRole("link", { name: M.entree, exact: true }).click();
  await visible(page, M.publication).waitFor({ timeout: 30_000 });
  check((await visible(page, M.profil).count()) === 1, "file : le profil signalé");
  check((await visible(page, M.motifs).count()) === 1, `file : motifs « ${M.motifs} »`);
  const ecran = await page.evaluate("document.body.innerText");
  for (const secret of [c.camille.username, "Camille (test)"]) check(!String(ecran).includes(secret), "jamais l'auteur d'un signalement");
  await capture("02-a-traiter");

  const publication = page.getByTestId(`moderation-post-${c.postId}`);
  const profil = page.getByTestId(`moderation-user-${c.louise.id}`);
  await publication.getByRole("button", { name: M.masquer, exact: true }).click();
  await page.getByLabel(M.precision, { exact: true }).fill("✦✦");
  await page.getByRole("button", { name: M.confirmerMasquage, exact: true }).scrollIntoViewIfNeeded();
  await capture("03-masquer-motif-et-precision");
  await page.getByRole("button", { name: M.confirmerMasquage, exact: true }).click();
  await visible(page, M.enregistree).waitFor({ timeout: 15_000 });
  await attendreEnvoi(page, envois, "moderation_decision", { decision: "hide", target_type: "post" });
  const envoi = envois.find((e) => e.event === "moderation_decision");
  check(!JSON.stringify(envoi?.properties ?? {}).includes(c.postId), "statistique : jamais l'identifiant du contenu");

  await visible(page, M.enregistree).waitFor({ state: "hidden", timeout: 10_000 });
  await profil.getByRole("button", { name: M.suspendre, exact: true }).click();
  await page.getByText(M.avertissement).filter({ visible: true }).waitFor();
  await page.getByRole("button", { name: M.confirmerSuspension, exact: true }).scrollIntoViewIfNeeded();
  await capture("04-suspendre-confirmation");
  await page.getByRole("button", { name: M.confirmerSuspension, exact: true }).click();
  await visible(page, M.vide).waitFor({ timeout: 15_000 });
  if (complet) await capture("05-a-traiter-vide");
  // « Traités » est commun à tout le service : les combinaisons précédentes y figurent aussi.
  await page.getByRole("radio", { name: M.traites, exact: true }).click();
  await publication.getByRole("button", { name: M.retablir, exact: true }).waitFor({ timeout: 15_000 });
  check((await profil.getByRole("button", { name: M.lever, exact: true }).count()) === 1, "« Traités » : lever la suspension");
  await visible(page, M.enregistree).waitFor({ state: "hidden", timeout: 10_000 });
  await capture("06-traites-historique");
}

/** Louise (personne concernée) et Camille (signalement) : informées sans nom d'administratrice ; « Modération » absente pour Camille. */
async function informer(p: Parcours, combo: Combo, c: Comptes, envois: Envoi[], problemes: string[]) {
  const M = TEXTES_MODERATION[combo.locale];
  const louise = await ouvrir(p, c.louise, combo, envois, "/activite", M.masquee);
  check((await visible(louise, M.motif).count()) >= 1, `Louise : « ${M.motif} »`);
  check((await louise.getByText(M.suspendu).filter({ visible: true }).count()) === 1, "Louise : suspension annoncée");
  check(!String(await louise.evaluate("document.body.innerText")).includes(c.alix.username), "Louise : jamais le nom de l'administratrice");
  await capteur(p, louise, combo, problemes)("07-activite-personne-concernee");
  await louise.context().close();

  const camille = await ouvrir(p, c.camille, combo, envois, "/activite", M.traitePublication);
  check((await visible(camille, M.traiteProfil).count()) === 1, "Camille : signalement du profil traité");
  check(!String(await camille.evaluate("document.body.innerText")).includes("✦✦"), "Camille : jamais la précision donnée à Louise");
  await capteur(p, camille, combo, problemes)("08-activite-signalement-traite");
  await camille.goto(`${p.siteUrl}/settings`);
  await visible(camille, M.supprimerCompte).waitFor({ timeout: 30_000 });
  await visible(camille, M.supprimerCompte).scrollIntoViewIfNeeded();
  check((await visible(camille, M.entree).count()) === 0, "Camille : aucune entrée « Modération »");
  await capteur(p, camille, combo, problemes)("09-reglages-sans-moderation");
  await camille.context().close();
}

/** Alix annule les deux décisions ; Louise en est informée. */
async function annuler(p: Parcours, page: Page, combo: Combo, c: Comptes, envois: Envoi[], capture: (nom: string) => Promise<void>, problemes: string[]) {
  const M = TEXTES_MODERATION[combo.locale];
  const publication = page.getByTestId(`moderation-post-${c.postId}`);
  const profil = page.getByTestId(`moderation-user-${c.louise.id}`);
  await publication.getByRole("button", { name: M.retablir, exact: true }).click();
  await visible(page, M.annulee).waitFor({ timeout: 15_000 });
  await profil.getByRole("button", { name: M.lever, exact: true }).click();
  await page.waitForTimeout(1500);
  check((await profil.getByRole("button", { name: M.lever, exact: true }).count()) === 0, "suspension levée");
  check((await publication.getByRole("button", { name: M.retablir, exact: true }).count()) === 0, "publication rétablie");
  await visible(page, M.annulee).waitFor({ state: "hidden", timeout: 10_000 });
  await capture("10-annulations");
  const louise = await ouvrir(p, c.louise, combo, envois, "/activite", M.retablie);
  check((await visible(louise, M.levee).count()) === 1, "Louise : suspension levée annoncée");
  await capteur(p, louise, combo, problemes)("11-activite-retablissement");
  await louise.context().close();
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  for (const combo of COMBOS) {
    const complet = combo.id === "fr-clair";
    await p.step(`${combo.id} : signalements, masquage, suspension, information des personnes${complet ? ", annulations" : ""}`, async () => {
      const envois: Envoi[] = [];
      const comptes = await preparer(p, combo);
      const alix = await ouvrir(p, comptes.alix, combo, envois, "/settings", TEXTES_MODERATION[combo.locale].entree);
      const capture = capteur(p, alix, combo, problemes);
      await decider(p, alix, combo, comptes, envois, capture, complet);
      await informer(p, combo, comptes, envois, problemes);
      if (complet) await annuler(p, alix, combo, comptes, envois, capture, problemes);
      await alix.context().close();
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
