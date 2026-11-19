import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Parcours à l'écran « nouveautés » (pnpm --filter backend parcours-ecran) :
// il attend des textes EXACTS de l'app (getByText, exact: true). Une phrase
// changée dans l'app sans l'être ici fait échouer le parcours du fondateur
// sur son Mac, bien après coup (cas de la bio retirée, devenue « … avec le
// lien de votre profil s'il y en avait un. » avec 0049). Lus comme du texte,
// sans base ni navigateur.

const SCENARIO = readFileSync(join(__dirname, "../scripts/parcours-ecran/scenarios/nouveautes.ts"), "utf8");
const FR = readFileSync(join(__dirname, "../../mobile/src/i18n/fr.ts"), "utf8");

/** La valeur entre guillemets d'une clé, dans un des deux fichiers. */
function quoted(source: string, key: string): string {
  const match = new RegExp(`\\b${key}: "([^"]*)"`).exec(source);
  if (!match) throw new Error(`clé introuvable : ${key}`);
  return match[1]!;
}

describe("parcours « nouveautés » : la modération des profils attend les phrases de l'app", () => {
  it("la personne lit dans son Activité la phrase de la bio retirée, telle que l'app l'affiche", () => {
    expect(quoted(SCENARIO, "bioRetireeMembre")).toBe(quoted(FR, "moderationBioRemoved"));
    expect(quoted(SCENARIO, "bioRetireeMembre")).toContain("avec le lien de votre profil");
  });

  it("le bouton et le message de réussite de l'administrateur", () => {
    expect(quoted(SCENARIO, "retirerBio")).toBe(quoted(FR, "removeBio"));
    expect(quoted(SCENARIO, "bioRetiree")).toBe(quoted(FR, "bioRemovedSaved"));
  });
});
