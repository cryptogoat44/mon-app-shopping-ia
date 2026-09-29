// Chantier « serveur à Francfort » : la politique de confidentialité change
// (serveur dans l'UE) sans nouvelle acceptation. Les comptes existants
// voient UNE fois un court message d'information, avec un lien vers la
// politique ; les comptes récents ne le voient pas.
//
//   pnpm --filter backend parcours-ecran francfort
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Page } from "playwright-core";
import type { Parcours, TestAccount } from "../boite-a-outils.js";

export const name = "Francfort — information de mise à jour de la politique";
export const outputDir = "francfort-captures";

const NOTICE = "Notre politique de confidentialité a été mise à jour : votre serveur est désormais en Europe.";
const SPOTTER = "Retrouvez une pièce vue dans une vidéo ou sur une photo.";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

async function acceptances(p: Parcours, account: TestAccount, privacyVersion: string) {
  const now = new Date().toISOString();
  await p.admin.from("consents").insert([
    { user_id: account.id, type: "terms", granted_at: now, document_version: CONSENT_VERSIONS.terms },
    { user_id: account.id, type: "age_declaration", granted_at: now, document_version: CONSENT_VERSIONS.age_declaration },
    { user_id: account.id, type: "privacy_policy", granted_at: now, document_version: privacyVersion },
  ]);
}

async function noticeVisible(page: Page, waitMs = 6000): Promise<boolean> {
  return page
    .getByText(NOTICE)
    .waitFor({ timeout: waitMs })
    .then(() => true)
    .catch(() => false);
}

export async function run(p: Parcours): Promise<void> {
  await p.step("Compte existant : l'information s'affiche, le lien mène à la politique, puis plus jamais", async () => {
    const ancienne = await p.createAccount("fa", "Ancienne (test)");
    await acceptances(p, ancienne, "projet-2026-09-25");
    const phone = await p.newPhone();
    await ancienne.signIn(phone);
    check(await noticeVisible(phone), "information affichée au compte existant");
    await p.capture(phone, "01-information-affichee");
    await phone.getByRole("link", { name: "Lire la politique" }).click();
    await phone.getByText("Nos prestataires et les services tiers").scrollIntoViewIfNeeded();
    check((await phone.getByText("Francfort", { exact: false }).count()) > 0, "la politique mentionne Francfort");
    await p.capture(phone, "02-politique-francfort");
    await phone.getByText("Sa dernière mise à jour est une simple information", { exact: false }).scrollIntoViewIfNeeded();
    await p.capture(phone, "03-politique-acceptation-anterieure");
    await phone.goto(`${p.siteUrl}/`);
    await phone.getByText(SPOTTER).waitFor({ timeout: 30_000 });
    check(!(await noticeVisible(phone, 4000)), "information non réaffichée après avoir été lue");
    await p.capture(phone, "04-plus-d-information");
    await phone.goto(`${p.siteUrl}/settings`);
    await phone.getByText("la dernière mise à jour ne demande pas de nouvelle acceptation", { exact: false }).waitFor();
    check((await phone.getByText("pas encore acceptée", { exact: false }).count()) === 0, "aucune nouvelle acceptation demandée");
    await p.capture(phone, "05-reglages-a-jour");
  });

  await p.step("Compte existant : « OK » ferme l'information pour de bon", async () => {
    const autre = await p.createAccount("fc", "Autre (test)");
    await acceptances(p, autre, "projet-2026-09-25");
    const phone = await p.newPhone();
    await autre.signIn(phone);
    check(await noticeVisible(phone), "information affichée");
    await phone.getByRole("button", { name: "Fermer cette information" }).click();
    check(!(await noticeVisible(phone, 2000)), "information fermée");
    await phone.reload();
    await phone.getByText(SPOTTER).waitFor({ timeout: 30_000 });
    check(!(await noticeVisible(phone, 4000)), "information non réaffichée après rechargement");
    await p.capture(phone, "06-fermee-avec-ok");
  });

  await p.step("Compte récent (version en vigueur acceptée) : aucune information", async () => {
    const recente = await p.createAccount("fb", "Récente (test)");
    await acceptances(p, recente, CONSENT_VERSIONS.privacy_policy);
    const phone = await p.newPhone();
    await recente.signIn(phone);
    check(!(await noticeVisible(phone, 5000)), "aucune information pour un compte récent");
    await p.capture(phone, "07-compte-recent-sans-information");
  });
}
