import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import marque from "@monapp/shared-types/marque.json" with { type: "json" };
import { brandFileSlug } from "@monapp/shared-types";
import { BRAND, BRAND_FILE_SLUG, BRAND_HTTP_TOKEN, PUBLIC_SITE_URL } from "../src/lib/brand.js";
import { IMAGE_REQUEST_HEADERS } from "../src/lib/publicImage.js";
import { PUSH_TITLE } from "../src/lib/push.js";

// Lot « nom et identifiants configurables ». Le nom du produit CHANGERA : il
// est écrit à UN seul endroit, packages/shared-types/marque.json (MARQUE.md).
// Ce garde-fou échoue dès que le serveur écrit le nom en dur dans ce que les
// personnes voient : messages d'erreur (et leur traduction), titre des
// notifications, fichier de l'export, identité annoncée aux boutiques.
// Pas besoin de la base : ce fichier tourne aussi dans « Tests serveur hors base ».

const SRC = join(__dirname, "../src");

/** Un autre nom, pour l'essai : rien de commun avec le nom actuel. */
const AUTRE = { ...marque, nom: "Zorglub Été", adresseSite: "https://zorglub.exemple.test" };

/** Le nom actuel, où qu'il soit et quelle que soit la casse. */
const NOM = new RegExp(marque.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

// Noms internes que personne ne voit (classe C de MARQUE.md) : le code du
// serveur n'en contient aucun aujourd'hui (l'en-tête « x-spotto-build » est
// dans packages/shared-types, les projets Supabase et les services Render dans
// scripts/, hors de ce contrôle). Tout ajout ici se justifie.
const INTERNES: RegExp[] = [];

const sansInternes = (texte: string) => INTERNES.reduce((reste, interne) => reste.replace(interne, ""), texte);

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : nom.endsWith(".ts") ? [chemin] : [];
  });
}

/** Morceaux de code (chaînes, gabarits, noms de variables — jamais les
 * commentaires) où le nom est écrit en dur : « ligne : début du morceau ». */
function nomsEnDurDans(fichier: string, code: string): string[] {
  const source = ts.createSourceFile(fichier, code, ts.ScriptTarget.Latest, true);
  const trouves: string[] = [];
  const visiter = (noeud: ts.Node) => {
    let feuille = true;
    ts.forEachChild(noeud, (enfant) => {
      feuille = false;
      visiter(enfant);
    });
    if (feuille && NOM.test(sansInternes(noeud.getText(source)))) {
      const { line } = source.getLineAndCharacterOfPosition(noeud.getStart(source));
      trouves.push(`${line + 1} : ${noeud.getText(source).slice(0, 80)}`);
    }
  };
  visiter(source);
  return trouves;
}

/** Tous les textes d'un module : les chaînes, et pour une fonction son code. */
function textes(valeur: unknown, sortie: string[] = [], vus = new Set<unknown>()): string[] {
  if (typeof valeur === "string") sortie.push(valeur);
  else if (typeof valeur === "function") sortie.push(String(valeur));
  else if (valeur !== null && typeof valeur === "object" && !vus.has(valeur)) {
    vus.add(valeur);
    for (const [cle, element] of Object.entries(valeur)) {
      sortie.push(cle);
      textes(element, sortie, vus);
    }
  }
  return sortie;
}

afterEach(() => {
  vi.doUnmock("@monapp/shared-types/marque.json");
  vi.resetModules();
});

describe("nom du produit : un seul fichier (packages/shared-types/marque.json)", () => {
  it("le serveur lit ce fichier : nom, nom des fichiers remis, adresse du site", () => {
    expect(BRAND).toBe(marque.nom);
    expect(BRAND).not.toBe("");
    expect(BRAND_FILE_SLUG).toBe(brandFileSlug(marque.nom));
    expect(PUBLIC_SITE_URL).toBe(marque.adresseSite);
    expect(PUSH_TITLE).toBe(marque.nom);
    // En-tête HTTP : le nom sans accent ni espace (un autre signe ferait échouer l'appel).
    expect(BRAND_HTTP_TOKEN).toMatch(/^[A-Za-z0-9]+$/);
    expect(IMAGE_REQUEST_HEADERS["user-agent"]).toBe(`Mozilla/5.0 (compatible; ${BRAND_HTTP_TOKEN}/1.0; +${marque.adresseSite})`);
  });

  it("aucun nom écrit en dur dans le code du serveur (hors commentaires)", () => {
    const code = fichiers(SRC);
    expect(code.length).toBeGreaterThan(50);
    const trouves = code.flatMap((chemin) => nomsEnDurDans(chemin, readFileSync(chemin, "utf8")).map((trouve) => `${chemin.slice(SRC.length + 1)}:${trouve}`));
    expect(trouves).toEqual([]);
  });

  it("le garde-fou voit bien un nom en dur (chaîne, gabarit, nom de variable), mais pas un commentaire", () => {
    const essai = (code: string) => nomsEnDurDans("essai.ts", code).length > 0;
    expect(essai(`const a = { message: "Bienvenue sur ${marque.nom}." };`)).toBe(true);
    expect(essai("const a = (n: string) => `${n} sur " + marque.nom.toUpperCase() + "`;")).toBe(true);
    expect(essai(`const ${marque.nom.toUpperCase()}_URL = 1;`)).toBe(true);
    expect(essai(`// ${marque.nom} en commentaire\nconst a = 1; /* ${marque.nom} */`)).toBe(false);
  });
});

describe("textes du serveur avec un autre nom", () => {
  it("messages et leur traduction, notifications, export, identité annoncée : l'ancien nom a disparu partout", async () => {
    vi.resetModules();
    vi.doMock("@monapp/shared-types/marque.json", () => ({ default: AUTRE }));
    const [messages, contentFilter, appVersion, auth, push, exportText, publicImage, brand] = await Promise.all([
      import("../src/lib/messages.js"),
      import("../src/lib/contentFilter.js"),
      import("../src/lib/appVersion.js"),
      import("../src/plugins/auth.js"),
      import("../src/lib/push.js"),
      import("../src/lib/exportText.js"),
      import("../src/lib/publicImage.js"),
      import("../src/lib/brand.js"),
    ]);
    expect(brand.BRAND).toBe("Zorglub Été");
    expect(brand.BRAND_FILE_SLUG).toBe("zorglub-ete");
    expect(push.PUSH_TITLE).toBe("Zorglub Été");
    expect(publicImage.IMAGE_REQUEST_HEADERS["user-agent"]).toBe("Mozilla/5.0 (compatible; ZorglubEte/1.0; +https://zorglub.exemple.test)");

    // Le dictionnaire français → anglais suit : la phrase française au nouveau nom trouve sa traduction.
    expect(contentFilter.CONTENT_NOT_ALLOWED.message).toBe("Ce texte contient un mot interdit sur Zorglub Été (insulte, propos haineux ou contenu sexuel). Modifiez-le pour continuer.");
    expect(messages.localizeMessage(contentFilter.CONTENT_NOT_ALLOWED.message, 400, "en")).toBe(
      "This text contains a word that isn't allowed on Zorglub Été (insult, hateful or sexual content). Please change it to continue."
    );
    expect(messages.localizeMessage(appVersion.UPDATE_REQUIRED_MESSAGE, 426, "en")).toBe("This version of Zorglub Été is no longer supported. Please update the app from the App Store.");
    expect(messages.localizeMessage(auth.AUTH_UNAVAILABLE_MESSAGE, 503, "en")).toBe("Zorglub Été is temporarily unreachable. Please try again in a moment.");
    expect(messages.localizeMessage("Cette envie n'a pas d'image copiée par Zorglub Été : il n'y a rien à retirer.", 409, "en")).toBe(
      "This wish has no image copied by Zorglub Été: there's nothing to remove."
    );

    const ensembles = { messages: messages.EN_MESSAGES, exportText, contentFilter: contentFilter.CONTENT_NOT_ALLOWED };
    for (const [nom, ensemble] of Object.entries(ensembles)) {
      const tous = textes(ensemble);
      expect(tous.filter((texte) => NOM.test(texte)), nom).toEqual([]);
      // Le nouveau nom est bien arrivé dans les phrases (l'essai a pris).
      expect(tous.some((texte) => texte.includes("Zorglub")), nom).toBe(true);
    }
    expect(exportText.EXPORT_TEXT.documentTitle).toEqual({ fr: "Vos données Zorglub Été", en: "Your Zorglub Été data" });
  });
});
