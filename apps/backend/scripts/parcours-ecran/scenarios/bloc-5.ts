// Lot Q, bloc 5 — CGU et politique de confidentialité : documents lisibles
// sans compte (Bienvenue, inscription, adresse directe), acceptation
// enregistrée avec sa version à la « Dernière étape », état dans les
// Réglages, et nouvelle acceptation pour un compte dont l'acceptation est
// antérieure au suivi des versions.
//
//   pnpm --filter backend parcours-ecran bloc-5
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import type { Page } from "playwright-core";
import type { Parcours } from "../boite-a-outils.js";

export const name = "Lot Q, bloc 5 — documents juridiques et consentement";
export const outputDir = "bloc-5-captures";

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Vérification échouée : ${message}`);
}

async function consentRows(p: Parcours, userId: string) {
  const { data, error } = await p.admin.from("consents").select("type, document_version").eq("user_id", userId);
  if (error) throw new Error("Lecture des consentements impossible.");
  return data ?? [];
}

export async function run(p: Parcours): Promise<void> {
  const visitor = await p.newPhone();

  await p.step("Sans compte : documents ouverts depuis Bienvenue", async () => {
    await open(visitor, `${p.siteUrl}/bienvenue`);
    await p.capture(visitor, "01-bienvenue-liens");
    await visitor.getByRole("link", { name: "Conditions d'utilisation" }).click();
    await visitor.getByText("Projet — à faire valider par un professionnel.").waitFor();
    await p.capture(visitor, "02-conditions-haut");
    await visitor.getByText("Droit applicable et litiges").scrollIntoViewIfNeeded();
    await p.capture(visitor, "03-conditions-bas-sans-bouton");
    check((await visitor.getByRole("button", { name: "J'accepte cette version" }).count()) === 0, "pas de bouton d'acceptation sans compte");
    await visitor.getByRole("button", { name: "Retour" }).click();
    await visitor.getByRole("button", { name: "Commencer" }).waitFor();
  });

  await p.step("Sans compte : liens de l'inscription et adresse directe", async () => {
    await open(visitor, `${p.siteUrl}/sign-up`);
    await p.capture(visitor, "04-inscription-liens");
    // Deux cases obligatoires : sans « au moins 15 ans », pas d'inscription
    // possible (le formulaire n'est jamais envoyé : aucun compte créé ici).
    await visitor.getByLabel("Email", { exact: true }).fill("jamais-envoye@example.com");
    await visitor.getByLabel("Mot de passe", { exact: true }).fill("motdepasse-factice");
    await visitor.getByLabel("Confirmez le mot de passe", { exact: true }).fill("motdepasse-factice");
    await visitor.getByRole("checkbox", { name: "J'accepte les conditions d'utilisation et la politique de confidentialité." }).click();
    const create = visitor.getByRole("button", { name: "Créer mon compte" });
    check(await create.isDisabled(), "inscription impossible sans la déclaration d'âge");
    await p.capture(visitor, "04b-inscription-sans-age");
    await visitor.getByRole("checkbox", { name: "Je certifie avoir au moins 15 ans." }).click();
    check(await create.isEnabled(), "inscription possible avec les deux cases");
    await p.capture(visitor, "04c-inscription-deux-cases");
    await visitor.getByRole("link", { name: "Lire la politique de confidentialité" }).click();
    await visitor.getByText("Qui peut voir quoi dans Spotto").waitFor();
    await p.capture(visitor, "05-confidentialite-haut");
    // Adresse publique (lien App Store, partage) : rechargement direct.
    await open(visitor, `${p.siteUrl}/confidentialite`);
    await visitor.getByText("Nos prestataires et les services tiers").scrollIntoViewIfNeeded();
    await p.capture(visitor, "06-confidentialite-prestataires");
  });

  await p.step("Nouveau compte : l'acceptation est enregistrée avec sa version", async () => {
    const nouvelle = await p.createAccount("n", "Nouvelle (test)", { incompleteProfile: true });
    const phone = await p.newPhone();
    await nouvelle.signIn(phone);
    check((await consentRows(p, nouvelle.id)).length === 0, "aucun consentement avant la Dernière étape");
    await phone.getByLabel("Nom d'utilisateur").fill(nouvelle.username);
    await phone.getByLabel("Nom affiché").fill("Nouvelle (test)");
    await p.capture(phone, "07-derniere-etape");
    await phone.getByRole("button", { name: "Continuer" }).click();
    await phone.getByText("Retrouvez une pièce vue dans une vidéo ou sur une photo.").waitFor({ timeout: 30_000 });
    const rows = await consentRows(p, nouvelle.id);
    check(rows.length === 3, `trois consentements enregistrés : documents et âge (obtenu : ${rows.length})`);
    for (const row of rows) {
      const expected = CONSENT_VERSIONS[row.type as "terms" | "privacy_policy" | "age_declaration"];
      check(row.document_version === expected, `version ${row.type} = ${expected}`);
    }
    await open(phone, `${p.siteUrl}/settings`);
    await phone.getByText("Version en vigueur acceptée le", { exact: false }).first().waitFor();
    await p.capture(phone, "08-reglages-documents-acceptes");
    await phone.getByRole("link", { name: "Conditions d'utilisation" }).click();
    await phone.getByText("Vous avez accepté cette version le", { exact: false }).scrollIntoViewIfNeeded();
    await p.capture(phone, "09-conditions-deja-acceptees");
  });

  await p.step("Compte existant (acceptation sans version) : nouvelle acceptation", async () => {
    const ancienne = await p.createAccount("o", "Ancienne (test)");
    await p.admin.from("consents").insert([
      { user_id: ancienne.id, type: "terms", granted_at: "2026-09-01T10:00:00Z" },
      { user_id: ancienne.id, type: "privacy_policy", granted_at: "2026-09-01T10:00:00Z" },
    ]);
    const phone = await p.newPhone();
    await ancienne.signIn(phone);
    await open(phone, `${p.siteUrl}/settings`);
    await phone.getByText("Version en vigueur pas encore acceptée", { exact: false }).first().waitFor();
    await p.capture(phone, "10-reglages-a-accepter");
    await phone.getByRole("link", { name: "Politique de confidentialité" }).click();
    const accept = phone.getByRole("button", { name: "J'accepte cette version" });
    await accept.scrollIntoViewIfNeeded();
    await p.capture(phone, "11-confidentialite-bouton-accepter");
    await accept.click();
    await phone.getByText("Vous avez accepté cette version le", { exact: false }).waitFor();
    await p.capture(phone, "12-confidentialite-acceptee");
    const rows = await consentRows(p, ancienne.id);
    check(
      rows.some((row) => row.type === "privacy_policy" && row.document_version === CONSENT_VERSIONS.privacy_policy),
      "nouvelle acceptation de la politique enregistrée avec sa version"
    );
    check(rows.length === 3, `l'ancienne acceptation est conservée dans l'historique (obtenu : ${rows.length} lignes)`);
    await phone.getByRole("button", { name: "Retour" }).click();
    await phone.getByText("Version en vigueur acceptée le", { exact: false }).first().waitFor();
    await p.capture(phone, "13-reglages-apres-acceptation");

    // Conditions : la déclaration d'âge se confirme en même temps.
    await phone.getByRole("link", { name: "Conditions d'utilisation" }).click();
    const acceptTerms = phone.getByRole("button", { name: "J'accepte cette version" });
    await acceptTerms.scrollIntoViewIfNeeded();
    check(await acceptTerms.isDisabled(), "conditions : bouton inactif tant que l'âge n'est pas certifié");
    await p.capture(phone, "14-conditions-case-age");
    await phone.getByRole("checkbox", { name: "Je certifie avoir au moins 15 ans." }).click();
    await acceptTerms.click();
    await phone.getByText("Vous avez accepté cette version le", { exact: false }).waitFor();
    await p.capture(phone, "15-conditions-acceptees-avec-age");
    const after = await consentRows(p, ancienne.id);
    for (const type of ["terms", "age_declaration"] as const) {
      check(
        after.some((row) => row.type === type && row.document_version === CONSENT_VERSIONS[type]),
        `${type} enregistré avec sa version`
      );
    }
    await phone.getByRole("button", { name: "Retour" }).click();
    // Les Réglages rechargent l'état à l'affichage : attendre la mise à jour.
    await phone.getByText("Version en vigueur pas encore acceptée", { exact: false }).first().waitFor({ state: "hidden", timeout: 15_000 });
    check((await phone.getByText("Version en vigueur acceptée le", { exact: false }).count()) === 2, "Réglages : les deux documents à jour");
    await p.capture(phone, "16-reglages-tout-a-jour");
  });
}
