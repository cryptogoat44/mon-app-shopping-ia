// Lot 5 — suppression de son compte, sur le site.
//
//   pnpm --filter backend parcours-ecran lot-5-suppression
//
// Dans les 4 combinaisons (français clair et sombre, anglais clair et sombre) :
// - Alix, administratrice (table « admins » de spotto-dev) : « Supprimer mon
//   compte » ; bouton désactivé tant que le mot n'est pas tapé ; mot tapé (en
//   minuscules) ; le serveur refuse, avec le message clair ; le compte existe
//   toujours.
// - Louise, compte ordinaire avec une publication (vraie photo) : mauvais mot
//   (bouton désactivé), bon mot, suppression ; retour à l'accueil ; compte et
//   fichiers effacés.
// Statistiques : clé PostHog FACTICE, envois interceptés (rien ne sort) ;
// aucun appel à SerpApi ni à l'IA.
import type { Locator, Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import { ACCOUNT_DELETION_WORDS } from "@monapp/shared-types";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { check, ouvrirSpotter, visible, type Envoi } from "./spotter-outils.js";
import { capteur, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Lot 5 — suppression de son compte (site)";
export const outputDir = "lot-5-suppression-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const TEXTES_SUPPRESSION = {
  fr: {
    supprimer: "Supprimer mon compte",
    consigne: "Pour confirmer, tapez SUPPRIMER ci-dessous.",
    champ: "Mot de confirmation : SUPPRIMER",
    confirmer: "Confirmer la suppression",
    refus: "Ce compte est administrateur et ne peut pas être supprimé tant qu'il a ce rôle. Retirez d'abord le rôle d'administrateur, puis recommencez.",
    mauvaisMot: "SUPPRIME",
    accueil: "Commencer",
  },
  en: {
    supprimer: "Delete my account",
    consigne: "To confirm, type DELETE below.",
    champ: "Confirmation word: DELETE",
    confirmer: "Confirm deletion",
    refus: "This account is an administrator and can't be deleted while it has this role. Remove the administrator role first, then try again.",
    mauvaisMot: "DELET",
    accueil: "Get started",
  },
} as const satisfies Record<Locale, Record<string, string>>;

interface Formulaire {
  champ: Locator;
  bouton: Locator;
}

/** Réglages → « Supprimer mon compte » : la consigne, le champ et le bouton de confirmation. */
async function ouvrirSuppression(p: Parcours, page: Page, combo: Combo): Promise<Formulaire> {
  const M = TEXTES_SUPPRESSION[combo.locale];
  await page.goto(`${p.siteUrl}/settings`);
  await visible(page, M.supprimer).waitFor({ timeout: 30_000 });
  await visible(page, M.supprimer).scrollIntoViewIfNeeded();
  await visible(page, M.supprimer).click();
  await visible(page, M.consigne).waitFor();
  const formulaire = { champ: page.getByLabel(M.champ, { exact: true }), bouton: page.getByRole("button", { name: M.confirmer, exact: true }) };
  await centrerBouton(page, M.confirmer);
  check(await desactive(formulaire.bouton), "bouton désactivé tant que le mot n'est pas tapé");
  return formulaire;
}

const POSITION = z.object({
  haut: z.number(),
  bas: z.number(),
  fenetre: z.number(),
  zone: z.object({ defilement: z.number(), hauteur: z.number(), visible: z.number() }).nullable(),
});

/** Centre à l'écran le bouton visible `texte` avant une capture, une fois les
 * Réglages entièrement chargés, et vérifie qu'il est bien dans la fenêtre :
 * une capture doit montrer l'état du bouton. */
async function centrerBouton(page: Page, texte: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  const position = POSITION.parse(
    await page.evaluate(`(() => {
      const bouton = [...document.querySelectorAll('[role="button"]')].find((b) => b.textContent.trim() === ${JSON.stringify(texte)} && b.getClientRects().length > 0);
      if (!bouton) return null;
      bouton.scrollIntoView({ block: "center" });
      let zone = bouton.parentElement;
      while (zone && !(zone.scrollHeight > zone.clientHeight && ["auto", "scroll"].includes(getComputedStyle(zone).overflowY))) zone = zone.parentElement;
      const r = bouton.getBoundingClientRect();
      return { haut: Math.round(r.top), bas: Math.round(r.bottom), fenetre: window.innerHeight, zone: zone ? { defilement: Math.round(zone.scrollTop), hauteur: zone.scrollHeight, visible: zone.clientHeight } : null };
    })()`)
  );
  check(position.haut >= 0 && position.bas <= position.fenetre, `bouton « ${texte} » dans l'écran (${JSON.stringify(position)})`);
}

async function desactive(bouton: Locator): Promise<boolean> {
  return (await bouton.getAttribute("aria-disabled")) === "true";
}

async function existe(p: Parcours, compte: TestAccount): Promise<boolean> {
  const { data } = await p.admin.auth.admin.getUserById(compte.id);
  return Boolean(data?.user);
}

/** Alix, administratrice : le serveur refuse, avec le message clair ; le compte reste. */
async function administratrice(p: Parcours, combo: Combo, envois: Envoi[], problemes: string[]): Promise<void> {
  const M = TEXTES_SUPPRESSION[combo.locale];
  const alix = await nouveauCompte(p, `a${combo.id.replace("-", "").slice(0, 4)}`);
  await p.admin.from("profiles").update({ display_name: "Alix (test)" }).eq("id", alix.id);
  check(!(await p.admin.from("admins").insert({ user_id: alix.id })).error, "rôle d'administratrice d'Alix (spotto-dev)");

  const page = await ouvrirSpotter(p, alix, combo, envois, TEXTES[combo.locale].ajouterVideo);
  const capture = capteur(p, page, combo, problemes);
  const { champ, bouton } = await ouvrirSuppression(p, page, combo);
  await centrerBouton(page, M.confirmer);
  await capture("01-confirmation-champ-vide");
  await champ.fill(ACCOUNT_DELETION_WORDS[combo.locale].toLowerCase());
  check(!(await desactive(bouton)), "bouton actif avec le bon mot, même en minuscules");
  await bouton.click();
  await visible(page, M.refus).waitFor({ timeout: 20_000 });
  await centrerBouton(page, M.confirmer);
  await capture("02-refus-administratrice");
  check(await existe(p, alix), "le compte de l'administratrice existe toujours");
  await page.context().close();
}

/** Louise, compte ordinaire avec une publication : mauvais mot refusé, bon mot, compte et fichiers effacés. */
async function compteOrdinaire(p: Parcours, combo: Combo, envois: Envoi[], problemes: string[], complet: boolean): Promise<void> {
  const M = TEXTES_SUPPRESSION[combo.locale];
  const louise = await nouveauCompte(p, `l${combo.id.replace("-", "").slice(0, 4)}`);
  const photo = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#6B4A3A" } }).jpeg().toBuffer();
  const form = new FormData();
  form.append("type", "lifestyle");
  form.append("privacy", "public");
  form.append("caption", "Kelly 28");
  form.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "kelly.jpg");
  const publication = await p.api(louise, "POST", "/api/posts", form);
  check(publication.ok, `publication de Louise (${publication.status})`);
  z.object({ id: z.string().uuid() }).parse(await publication.json());
  const avant = await p.admin.storage.from("post-media").list(louise.id);
  check((avant.data ?? []).length >= 1, "photo de la publication enregistrée");

  const page = await ouvrirSpotter(p, louise, combo, envois, TEXTES[combo.locale].ajouterVideo);
  const capture = capteur(p, page, combo, problemes);
  const { champ, bouton } = await ouvrirSuppression(p, page, combo);
  await champ.fill(M.mauvaisMot);
  check(await desactive(bouton), "bouton désactivé avec un mot incorrect");
  await centrerBouton(page, M.confirmer);
  if (complet) await capture("03-mot-incorrect");
  await champ.fill(ACCOUNT_DELETION_WORDS[combo.locale]);
  check(!(await desactive(bouton)), "bouton actif avec le bon mot");
  await centrerBouton(page, M.confirmer);
  if (complet) await capture("04-bon-mot");
  await bouton.click();
  await page.getByText(M.accueil, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  await capture("05-compte-supprime-accueil");
  check(!(await existe(p, louise)), "compte de Louise supprimé");
  const apres = await p.admin.storage.from("post-media").list(louise.id);
  check((apres.data ?? []).length === 0, "fichiers de Louise effacés");
  await page.context().close();
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  for (const combo of COMBOS) {
    const complet = combo.id === "fr-clair";
    await p.step(`${combo.id} : administratrice refusée, compte ordinaire supprimé`, async () => {
      const envois: Envoi[] = [];
      await administratrice(p, combo, envois, problemes);
      await compteOrdinaire(p, combo, envois, problemes, complet);
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
