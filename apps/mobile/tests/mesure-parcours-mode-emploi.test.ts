import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS } from "../src/lib/analytics-events";

// Lot « mesure du parcours » : le mode d'emploi du fondateur
// (apps/mobile/STATISTIQUES.md) doit mener aux bons chiffres. Ses entonnoirs
// ne comptent que des étapes qui arrivent dans l'ordre du parcours, et ses
// recettes ne mélangent pas des cas différents.
const guide = readFileSync(join(__dirname, "../STATISTIQUES.md"), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

/** Le texte d'une partie « ## titre », jusqu'à la suivante. */
function part(title: string): string {
  const start = guide.indexOf(`## ${title}`);
  expect(start, title).toBeGreaterThanOrEqual(0);
  const end = guide.indexOf("\n## ", start + 3);
  return guide.slice(start, end === -1 ? undefined : end);
}

/** Les étapes numérotées qui suivent `heading` (première liste « 1. `…` »). */
function steps(text: string, heading: string): string[] {
  const from = text.indexOf(heading);
  expect(from, heading).toBeGreaterThanOrEqual(0);
  const lines = text.slice(from).split("\n");
  const first = lines.findIndex((line) => /^1\. `/.test(line));
  const list: string[] = [];
  for (const line of lines.slice(first)) {
    if (!/^\d+\. `/.test(line)) break;
    list.push(line.replace(/^\d+\. /, ""));
  }
  return list;
}

const eventOf = (step: string) => step.match(/^`([a-z_]+)`/)![1]!;

describe("STATISTIQUES.md : les entonnoirs", () => {
  const funnels = part("Créer les deux entonnoirs dans PostHog");
  const link = steps(funnels, "**Entonnoir « depuis un lien de vidéo »**");
  const withoutAi = steps(funnels, "faites aussi l'entonnoir **sans l'IA**");
  const photo = steps(funnels, "**Entonnoir « depuis une photo »**");

  it("refusé : spot_completed n'est l'étape d'aucun entonnoir (il part souvent après la boutique ou « Garder »)", () => {
    for (const funnel of [link, withoutAi, photo]) expect(funnel.map(eventOf)).not.toContain("spot_completed");
    expect(flat(funnels)).toContain("**Pourquoi `spot_completed` n'est dans aucun entonnoir**");
  });

  it("admis : les étapes du parcours, dans l'ordre où elles arrivent, toutes au catalogue", () => {
    expect(link).toEqual([
      "`journey_started` avec `entry` contient `link`",
      "`video_link_ai_result` avec `outcome` = `found`",
      "`spot_launched`",
      "`merchant_link_opened`",
      "`wishlist_item_added`",
    ]);
    expect(withoutAi).toEqual(["`journey_started` avec `entry` contient `link`", "`spot_launched`", "`merchant_link_opened`", "`wishlist_item_added`"]);
    expect(photo).toEqual(["`journey_started` avec `entry` contient `photo`", "`spot_launched`", "`merchant_link_opened`", "`wishlist_item_added`"]);
    for (const step of [...link, ...withoutAi, ...photo]) expect(Object.keys(ANALYTICS_EVENTS)).toContain(eventOf(step));
  });

  it("l'étape de l'IA : seulement le chemin de l'analyse, allumée sur le serveur ; les autres chemins sont nommés", () => {
    const text = flat(funnels);
    expect(text).toContain("L'étape 2 ne compte que le chemin de l'**analyse par l'IA**");
    expect(text).toContain("`VIDEO_LINK_ANALYSIS_ENABLED`");
    expect(text).toContain("(`player_spot`, app iPhone)");
    expect(text).toContain("« Pièces déjà repérées »");
    expect(text).toContain("une image choisie à la main (`video_frame_chosen`) ne passe pas par `video_ai_result`");
  });

  it("spot_started est décrit avec la recherche (au moment de « Lancer »), plus avec l'entrée du parcours", () => {
    expect(part("Le parcours, étape par étape").split("### 3a.")[0]).not.toContain("`spot_started`");
    expect(flat(guide)).toContain("**`spot_started`** : la recherche est préparée (gratuit), au moment de « Lancer », juste avant `spot_launched`.");
    expect(flat(guide)).not.toContain("la réponse est là");
  });
});
