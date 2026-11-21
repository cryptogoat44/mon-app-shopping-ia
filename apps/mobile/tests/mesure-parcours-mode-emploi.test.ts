import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import { READ_TIMEOUT_MS } from "../src/lib/spot-recovery";

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

describe("STATISTIQUES.md : les recettes de lecture", () => {
  it("temps d'attente : filtrés sur l'issue avant la médiane ; shops_wait_ms sans les recherches où l'IA est coupée", () => {
    const recipe = flat(part("Lire les temps d'attente"));
    expect(recipe).toContain("2. Filtrez sur l'issue");
    expect(recipe.indexOf("2. Filtrez sur l'issue")).toBeLessThan(recipe.indexOf("**Property value**"));
    expect(recipe).toContain("`spot_completed` : `outcome` = `results` ; pour `shops_wait_ms`, en plus `complement` **is not** `skipped`");
    expect(recipe).toContain("`video_link_ai_result` et `video_ai_result` : `outcome` = `found`");
    // Le cas mélangé est dit là où l'événement est décrit.
    expect(flat(guide)).toContain("égale à `wait_ms` quand cette recherche n'a pas eu lieu : aucun résultat, ou IA coupée, `complement` = `skipped`");
    expect(ANALYTICS_EVENTS.spot_completed.complement).toEqual({ kind: "enum", values: expect.arrayContaining(["skipped"]) });
  });

  it("refusé : aucun événement proposé à l'étape 1 sans son filtre sur l'issue à l'étape 2 (« Que cherchez-vous ? » compris)", () => {
    const recipe = part("Lire les temps d'attente");
    const step1 = recipe.slice(recipe.indexOf("1. **New insight**"), recipe.indexOf("2. Filtrez sur l'issue"));
    const step2 = flat(recipe.slice(recipe.indexOf("2. Filtrez sur l'issue"), recipe.indexOf("3. À la place")));
    const events = [...step1.matchAll(/`([a-z_]+)`/g)].map((found) => found[1]!);
    expect(events).toEqual(["spot_completed", "text_search_completed", "video_link_ai_result", "video_ai_result"]);
    for (const event of events) expect(step2, event).toMatch(new RegExp(`\`${event}\`[^;.]*: \`outcome\` = \``));
  });

  it("permis : « Que cherchez-vous ? » filtré sur `shown`, une issue du catalogue ; toutes ses issues sont décrites avec l'événement", () => {
    expect(flat(part("Lire les temps d'attente"))).toContain("`text_search_completed` : `outcome` = `shown` ;");
    expect(ANALYTICS_EVENTS.text_search_completed.outcome).toEqual({ kind: "enum", values: ["shown", "empty", "shopping_failed", "failed"] });
    expect(flat(guide)).toContain(
      "`outcome` = `shown` (des résultats), `empty` (aucun), `shopping_failed` (la recherche en ligne a échoué) ou `failed` (panne du réseau ou du serveur, souvent immédiate sans réseau)"
    );
  });

  it("mark : « is set » dans la recette ; les cartes « Pièces déjà repérées » (sans mention) sont nommées", () => {
    const text = flat(guide);
    expect(text).toContain("**et le filtre `mark` is set**");
    expect(text).toContain("ni sur les cartes « Pièces déjà repérées » de l'écran « vidéo partagée », ni depuis les versions de l'app d'avant ce lot");
    expect(text).not.toContain("Ailleurs (Envies, Vault, publications…), pas de `mark`.");
    // Ce que dit la recette est bien ce que fait l'app : ces cartes ouvrent la boutique en « result », sans mention.
    const cards = readFileSync(join(__dirname, "../src/components/video-products.tsx"), "utf8");
    expect(cards).toMatch(/<MerchantLinkButton [^>]*context="result"[^>]*\/>/);
    expect(cards).not.toMatch(/<MerchantLinkButton [^>]*mark=/);
  });

  describe("serveur endormi : la série B, à partir de 10 secondes", () => {
    const sleeping = flat(part("Le serveur endormi : `server_first_response`"));
    /** wait_ms tel que PostHog le reçoit (arrondi à 100 ms) : la série B le compte-t-elle ? */
    const inSeriesB = (ms: number) => (sanitizeProps("server_first_response", { wait_ms: ms }).wait_ms as number) > 9_900;

    it("refusé : pas de « greater than 10000 », qui laisse de côté 10000 tout rond ; une attente sous 10 s n'entre pas", () => {
      expect(sleeping).not.toContain("**greater than** `10000`");
      expect(sleeping).not.toContain("Au-dessus de **10 secondes**");
      expect(inSeriesB(9_849)).toBe(false);
    });

    it("permis : la relecture d'une recherche que l'app abandonne au bout de 10 s (10000 une fois arrondie) entre, et elle est nommée avec ok = non", () => {
      expect(sleeping).toContain("À partir de **10 secondes**");
      expect(sleeping).toContain("Série B : `server_first_response` avec le filtre `wait_ms` **greater than** `9900` (c'est-à-dire 10 secondes ou plus");
      // Mesurée après la lecture de la session (quelques ms), minuterie un peu en retard : toujours 10000.
      expect(inSeriesB(READ_TIMEOUT_MS - 4 + 16)).toBe(true);
      expect(inSeriesB(READ_TIMEOUT_MS)).toBe(true);
      expect(sleeping).toContain("10 secondes pour relire une recherche au retour dans l'app, avec `wait_ms` autour de `10000`");
      expect(flat(guide)).toContain("(par exemple au bout de 15 secondes pour le profil, ou de 10 secondes pour relire une recherche au retour dans l'app)");
    });
  });

  it("la clé PostHog du site : le vrai nom du service chez Render, pas un surnom", () => {
    const check = flat(part("⚠️ À vérifier avant de lire les chiffres"));
    expect(check).toContain("la variable `EXPO_PUBLIC_POSTHOG_KEY` du service **mon-app-shopping-ia-web** chez Render (le site, pas spotto-api)");
    expect(check).not.toContain("« site » chez Render");
    expect(readFileSync(join(__dirname, "../../../MISE-EN-LIGNE.md"), "utf8")).toContain("Render, service **mon-app-shopping-ia-web**");
  });
});
