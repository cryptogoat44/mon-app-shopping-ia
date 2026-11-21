import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS } from "../src/lib/analytics-events";

// Lot « mesure du parcours » : les temps d'attente partent chez PostHog avec
// l'identifiant du compte (accord aux statistiques). Le brouillon des
// réponses « App Privacy » (app-store/CONFIDENTIALITE-APPLE.md), d'où le
// fondateur remplira App Store Connect, doit les déclarer. La case d'Apple
// n'a pas pu être vérifiée sur son site : la mention « à vérifier » le dit.
const apple = readFileSync(join(__dirname, "../app-store/CONFIDENTIALITE-APPLE.md"), "utf8");
const CHECK = "⚠️ À vérifier dans la documentation officielle d'Apple";

/** Les cases d'une ligne de tableau dont la première case commence par `name`. */
function row(name: string): string[] {
  const line = apple.split("\n").find((text) => text.startsWith(`| ${name}`) || text.startsWith(`| **${name}**`));
  expect(line, name).toBeDefined();
  return line!.split("|").slice(1, -1).map((cell) => cell.trim());
}

/** [événement, propriété] de chaque temps d'attente du catalogue fermé. */
const durations = Object.entries(ANALYTICS_EVENTS).flatMap(([event, rules]) =>
  Object.entries(rules as Record<string, { kind: string }>)
    .filter(([, rule]) => rule.kind === "duration")
    .map(([property]) => [event, property] as const)
);

describe("fiche Apple : les temps d'attente en « Données de performances »", () => {
  it("admis : cochée, liée au compte, finalité Analyses, la mention à vérifier à côté du nom ; chaque temps d'attente du catalogue cité", () => {
    const [type, collected, linked, purposes, proof] = row("Données de performances");
    expect(type).toBe(`**Données de performances** (*Performance Data*) ${CHECK}`);
    expect(collected).toBe("✅");
    expect(linked).toBe("Oui");
    expect(purposes).toContain("Analyses");
    expect(proof).toContain("avec accord seulement");
    expect(proof).toContain("l'identifiant interne du compte (`apps/mobile/src/lib/analytics.ts:69`), jamais pour le suivi");
    expect(durations.length).toBeGreaterThanOrEqual(6);
    for (const [event, property] of durations) {
      expect(proof, event).toContain(`\`${event}\``);
      expect(proof, property).toContain(`\`${property}\``);
    }
  });

  it("refusé : plus de ligne « non cochée » justifiée par la seule mesure coupée de Sentry (gardée en note)", () => {
    expect(apple).not.toMatch(/^\| Données de performances \| — \|/m);
    expect(apple).not.toContain("| Mesure de performance coupée");
    expect(row("Données de performances")[4]).toContain("Note : Sentry, lui, ne mesure toujours pas les performances");
  });

  it("le lot est dans « Quand revoir ces réponses », et le résumé de la fiche reste juste (Diagnostics y est déjà)", () => {
    const review = apple.slice(apple.indexOf("## 6. Quand revoir ces réponses"), apple.indexOf("## 7. BROUILLON"));
    expect(review).toContain("le **lot « mesure du parcours »**");
    for (const event of ["journey_started", "server_first_response", "plan_b_screenshot_chosen", "first_search_guide", "merchant_link_opened.mark", "link_platform"]) expect(review).toContain(`\`${event}\``);
    expect(review).toContain(`**« Données de performances »** (partie 2, Diagnostics : liées, Analyses, pas de suivi) ${CHECK}`);
    expect(apple).toContain("- **Données liées à vous** : Achats, Coordonnées, Contacts, Contenu de l'utilisateur, Historique des recherches, Identifiants, Données d'utilisation, Diagnostics, Autres données.");
    expect(apple).toContain("**Suivi : non partout**");
  });
});
