import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS } from "../src/lib/analytics-events";

// Lot « propositions » (Parcours 2, 21 novembre 2026) : le mode d'emploi des
// statistiques, la mise en place de l'interrupteur et les notes pour Apple
// disent ce que fait le code — `mode` (words ou pieces), l'entonnoir des
// essais manqués, VIDEO_PIECES_ENABLED coupé par défaut.
const root = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("STATISTIQUES.md : le mode des analyses d'un lien", () => {
  const guide = read("apps/mobile/STATISTIQUES.md");
  const part = guide.slice(guide.indexOf("## Les propositions de l'IA (lien vidéo) : `mode`"), guide.indexOf("## Lire les temps d'attente"));

  it("la propriété est décrite là où les événements le sont, avec ses deux valeurs et le sens d'une valeur absente", () => {
    const text = flat(guide);
    expect(text).toContain("**`mode`** (nouveau, lot « propositions ») sur `video_link_ai_started`, `video_link_ai_result` et `video_link_ai_moment_chosen`");
    expect(text).toContain("Une valeur absente vient des versions d'avant : elle veut dire `words`.");
    expect(text).toContain("En mode `pieces`, `moments_count` compte les pièces proposées (une image chacune) et `rank` désigne la pièce lancée");
    for (const event of ["video_link_ai_started", "video_link_ai_result", "video_link_ai_moment_chosen"] as const) {
      expect(ANALYTICS_EVENTS[event].mode).toEqual({ kind: "enum", values: ["words", "pieces"] });
    }
  });

  it("l'entonnoir des essais manqués : propositions reçues, puis une analyse avec des mots, au catalogue et dans l'ordre", () => {
    expect(part.length).toBeGreaterThan(200);
    const steps = part.split("\n").filter((line) => /^\d+\. `/.test(line));
    expect(steps).toEqual(["1. `video_link_ai_result` avec `mode` = `pieces` et `outcome` = `found`", "2. `video_link_ai_started` avec `mode` = `words`"]);
    expect(ANALYTICS_EVENTS.video_link_ai_result.outcome).toEqual({ kind: "enum", values: expect.arrayContaining(["found", "not_found"]) });
    expect(flat(part)).toContain("**Unique users**, **1 hour**, `environment` = `production`");
    expect(flat(part)).toContain("**« Aucune pièce proposée »** : `video_link_ai_result` avec `mode` = `pieces` et `outcome` = `not_found`");
    expect(flat(part)).toContain("`VIDEO_PIECES_ENABLED`");
  });

  it("refusé : jamais un nom proposé dans les statistiques — la liste de ce qui ne part jamais le dit", () => {
    expect(flat(guide.slice(guide.indexOf("## Ce qui ne part jamais")))).toContain("ni nom d'une pièce proposée par l'IA");
    expect(flat(part)).toContain("Jamais un nom proposé ni le texte du champ : seulement `words` ou `pieces`.");
    // Les entonnoirs d'avant restent les deux de leur partie (le mode d'emploi du Parcours 1 les teste).
    expect(guide).toContain("## Créer les deux entonnoirs dans PostHog");
  });
});

describe("l'interrupteur VIDEO_PIECES_ENABLED : mise en place et notes pour Apple", () => {
  it("permis : une ligne dans le tableau de SETUP.md, coupé par défaut, valeur exacte `true`", () => {
    const row = read("SETUP.md")
      .split("\n")
      .find((line) => line.startsWith("| `VIDEO_PIECES_ENABLED` |"));
    expect(row).toBeDefined();
    expect(row).toContain("| non (`false`) |");
    expect(row).toContain("seule la valeur exacte `true` les allume, et seulement avec l'analyse des liens allumée et prête");
    expect(read("apps/backend/.env.example")).toContain("# VIDEO_PIECES_ENABLED=false");
  });

  it("refusé : jamais dans les variables que les outils peuvent changer ; nommé dans la liste des interrupteurs des notes pour Apple", () => {
    expect(read("apps/backend/scripts/lib/render-guard.ts")).not.toContain("VIDEO_PIECES_ENABLED");
    const notes = read("apps/mobile/app-store/NOTES-VALIDATION.md");
    const switches = notes.split("\n").find((line) => line.startsWith("- **SERVER SWITCHES TODAY** :"));
    expect(switches).toContain("`VIDEO_LINK_ANALYSIS_ENABLED`, `VIDEO_PIECES_ENABLED` : seule la valeur exacte `true` allume");
    expect(notes).toContain("` AI suggestions (VIDEO_PIECES_ENABLED): ON.`");
  });

  it("fiche Apple : aucun type de donnée nouveau, la propriété `mode` dans « Interaction avec le produit »", () => {
    const apple = read("apps/mobile/app-store/CONFIDENTIALITE-APPLE.md");
    const review = apple.slice(apple.indexOf("## 6. Quand revoir ces réponses"), apple.indexOf("## 7. BROUILLON"));
    expect(review).toContain("- les **propositions de l'IA** (`VIDEO_PIECES_ENABLED`, coupées par défaut, lot « propositions ») : **aucun type de donnée nouveau**.");
    expect(review).toContain("une propriété de plus, `mode` (`words` ou `pieces`), dans « Interaction avec le produit » (Analyses), jamais un nom");
  });
});
