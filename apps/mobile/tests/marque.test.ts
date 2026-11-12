import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import marque from "@monapp/shared-types/marque.json";
import { brandFileSlug } from "@monapp/shared-types";
import { APP_FILE_SLUG, APP_GROUP, APP_NAME, APP_NAME_DISPLAY, APP_SCHEME, PUBLIC_WEB_URL } from "../src/constants/brand";
import { configExpo, lireFichier } from "./expo-config";

// Lot « nom et identifiants configurables ». Le nom du produit CHANGERA : il
// est écrit à UN seul endroit, packages/shared-types/marque.json (MARQUE.md),
// avec les identifiants qui en dépendent. Ce garde-fou échoue dès que le nom
// est écrit en dur dans un endroit que les personnes voient (textes de l'app,
// textes juridiques, configuration Expo, pages du site).

const MOBILE = join(__dirname, "..");
const DEPOT = join(MOBILE, "../..");

/** Un autre nom, pour l'essai : rien de commun avec le nom actuel. */
const AUTRE = {
  nom: "Zorglub",
  slugExpo: "zorglub",
  schemaLiens: "zorglub",
  identifiantApple: "fr.exemple.zorglub",
  groupeApple: "group.fr.exemple.zorglub",
  identifiantExtensionPartage: "fr.exemple.zorglub.partage",
  adresseSite: "https://zorglub.exemple.test",
};

/** Le nom actuel, où qu'il soit et quelle que soit la casse. */
const NOM = new RegExp(marque.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

// Noms internes que personne ne voit (classe C de MARQUE.md) : ils gardent
// l'ancien nom de travail, exprès. Liste courte : tout ajout se justifie.
const INTERNES: RegExp[] = [
  /spotto\.[a-z][a-z-]*/g, // clés de rangement sur l'appareil (« spotto.langue »…)
  /spotto-(?:verification-robot|player)/g, // étiquettes des messages entre l'app et ses pages
  /data-spotto/g, // marque posée sur le lecteur intégré
  /spottoTurnstileLoaded/g, // fonction de la page anti-robots
  /x-spotto-build/g, // en-tête technique entre l'app et le serveur
  /spotto-api\.onrender\.com/g, // adresse du service Render (se change à la main, MARQUE.md)
  /spotto-(?:prod|dev)(?:-\d)?/g, // noms des projets Supabase, cités au fondateur pendant un build
  /Spotto\.icon/g, // fichier de l'icône (assets/marque)
  /SpottoPlayerSnapshot/g, // nom du module natif local de l'instantané (modules/spotto-player-snapshot), jamais montré
];

const sansInternes = (texte: string) => INTERNES.reduce((reste, interne) => reste.replace(interne, ""), texte);

function fichiers(dossier: string, extensions: string[]): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin, extensions);
    return extensions.some((extension) => nom.endsWith(extension)) ? [chemin] : [];
  });
}

/** Morceaux de code (chaînes, gabarits, textes d'écran, noms de variables — jamais
 * les commentaires) où le nom est écrit en dur : « ligne : début du morceau ». */
function nomsEnDurDans(fichier: string, code: string): string[] {
  const source = ts.createSourceFile(fichier, code, ts.ScriptTarget.Latest, true);
  const trouves: string[] = [];
  const visiter = (noeud: ts.Node) => {
    let feuille = true;
    ts.forEachChild(noeud, (enfant) => {
      feuille = false;
      visiter(enfant);
    });
    // « {/* … */} » dans un écran : un commentaire, rien d'autre.
    if (!feuille || ts.isJsxExpression(noeud)) return;
    if (NOM.test(sansInternes(noeud.getText(source)))) {
      const { line } = source.getLineAndCharacterOfPosition(noeud.getStart(source));
      trouves.push(`${line + 1} : ${noeud.getText(source).slice(0, 80)}`);
    }
  };
  visiter(source);
  return trouves;
}

const nomsEnDur = (chemin: string) => nomsEnDurDans(chemin, lireAbsolu(chemin)).map((trouve) => `${chemin.slice(DEPOT.length + 1)}:${trouve}`);

const lireAbsolu = (chemin: string) => readFileSync(chemin, "utf8");

/** Tous les textes d'un catalogue : les chaînes, et pour une fonction son code et ce qu'elle renvoie. */
function textes(valeur: unknown, sortie: string[] = []): string[] {
  if (typeof valeur === "string") sortie.push(valeur);
  else if (typeof valeur === "function") {
    sortie.push(String(valeur));
    try {
      textes(valeur("a", "b", "c", "d"), sortie);
    } catch {
      // Fonction qui attend autre chose que du texte : son code suffit.
    }
  } else if (Array.isArray(valeur)) for (const element of valeur) textes(element, sortie);
  else if (valeur !== null && typeof valeur === "object") for (const element of Object.values(valeur)) textes(element, sortie);
  return sortie;
}

afterEach(() => {
  vi.doUnmock("@monapp/shared-types/marque.json");
  vi.resetModules();
});

describe("fichier unique de la marque (packages/shared-types/marque.json)", () => {
  it("chaque ligne est remplie et a la forme attendue par Apple et Expo", () => {
    expect(marque.nom.trim()).toBe(marque.nom);
    expect(marque.nom).not.toBe("");
    expect(marque.slugExpo).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(marque.schemaLiens).toMatch(/^[a-z][a-z0-9]*$/);
    expect(marque.identifiantApple).toMatch(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/);
    // Règles d'Apple : un groupe d'apps commence par « group. » ; l'extension porte l'identifiant de l'app, suivi d'un point.
    expect(marque.groupeApple).toMatch(/^group\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/);
    expect(marque.identifiantExtensionPartage.startsWith(`${marque.identifiantApple}.`)).toBe(true);
    expect(marque.identifiantExtensionPartage).toMatch(/^[A-Za-z0-9.-]+$/);
    expect(marque.adresseSite).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it("l'app lit ce fichier, et rien d'autre", () => {
    expect(APP_NAME_DISPLAY).toBe(marque.nom);
    expect(APP_NAME).toBe(marque.nom.toLowerCase());
    expect(APP_FILE_SLUG).toBe(brandFileSlug(marque.nom));
    expect(APP_SCHEME).toBe(marque.schemaLiens);
    expect(APP_GROUP).toBe(marque.groupeApple);
    if (process.env.EXPO_PUBLIC_WEB_URL === undefined) expect(PUBLIC_WEB_URL).toBe(marque.adresseSite);
  });

  it("nom pour un nom de fichier : minuscules, sans accent ni espace", () => {
    expect(brandFileSlug("Spotto")).toBe("spotto");
    expect(brandFileSlug("Épée d'Or 2")).toBe("epee-d-or-2");
    expect(brandFileSlug("  ")).toBe("app");
  });
});

describe("configuration Expo (app.json complété par app.config.js)", () => {
  it("le nom et les identifiants viennent du fichier unique", () => {
    const expo = configExpo();
    const partage = expo.plugins.find((module: unknown) => Array.isArray(module) && module[0] === "expo-share-intent")[1];
    expect(expo.name).toBe(marque.nom);
    expect(expo.slug).toBe(marque.slugExpo);
    expect(expo.scheme).toBe(marque.schemaLiens);
    expect(expo.ios.bundleIdentifier).toBe(marque.identifiantApple);
    expect(partage.iosAppGroupIdentifier).toBe(marque.groupeApple);
    expect(partage.iosShareExtensionBundleIdentifier).toBe(marque.identifiantExtensionPartage);
    // Textes d'iOS traduits : remis à Expo déjà complétés, avec le contenu exact des fichiers.
    for (const langue of ["fr", "en"]) {
      const fichier: Record<string, string> = JSON.parse(lireFichier(`locales/${langue}.json`));
      expect(Object.keys(expo.locales[langue])).toEqual(Object.keys(fichier));
      expect(expo.locales[langue].CFBundleDisplayName).toBe(marque.nom);
      expect(expo.locales[langue].NSPhotoLibraryUsageDescription).toBe(fichier.NSPhotoLibraryUsageDescription!.replaceAll("{nom}", marque.nom));
      expect(expo.locales[langue].NSPhotoLibraryUsageDescription).toContain(marque.nom);
    }
    // Aucun repère oublié (une ligne mal orthographiée dans app.json resterait telle quelle).
    expect(JSON.stringify(expo)).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it("app.json et locales/*.json n'écrivent jamais le nom : seulement des repères", () => {
    for (const fichier of ["app.json", "locales/fr.json", "locales/en.json"]) {
      expect(sansInternes(lireFichier(fichier)), fichier).not.toMatch(NOM);
    }
  });

  it("avec un autre nom, plus rien ne porte l'ancien", () => {
    const expo = configExpo(AUTRE);
    const texte = sansInternes(JSON.stringify(expo));
    expect(texte).not.toMatch(NOM);
    expect(texte).not.toContain(marque.identifiantApple);
    expect(expo.name).toBe("Zorglub");
    expect(expo.ios.bundleIdentifier).toBe("fr.exemple.zorglub");
    expect(expo.locales.fr.CFBundleDisplayName).toBe("Zorglub");
    expect(expo.locales.en.NSPhotoLibraryUsageDescription).toContain("Zorglub only reads");
    const photos = expo.plugins.find((module: unknown) => Array.isArray(module) && module[0] === "expo-media-library")[1];
    expect(photos.photosPermission).toContain("Zorglub ne lit que");
  });
});

describe("textes de l'app avec un autre nom", () => {
  it("catalogues FR et EN, textes juridiques FR et EN, objet du message de contact : l'ancien nom a disparu partout", async () => {
    vi.resetModules();
    vi.doMock("@monapp/shared-types/marque.json", () => ({ default: AUTRE }));
    const [{ fr }, { en }, conditions, conditionsEn, confidentialite, confidentialiteEn, contact, brand] = await Promise.all([
      import("../src/i18n/fr"),
      import("../src/i18n/en"),
      import("../src/legal/conditions"),
      import("../src/legal/conditions.en"),
      import("../src/legal/confidentialite"),
      import("../src/legal/confidentialite.en"),
      import("../src/lib/contact"),
      import("../src/constants/brand"),
    ]);
    expect(brand.APP_NAME_DISPLAY).toBe("Zorglub");
    expect(brand.APP_NAME).toBe("zorglub");
    expect(brand.APP_SCHEME).toBe("zorglub");
    expect(brand.APP_GROUP).toBe("group.fr.exemple.zorglub");
    const ensembles = {
      fr,
      en,
      conditions: conditions.termsOfUse,
      conditionsEn: conditionsEn.termsOfUseEn,
      confidentialite: confidentialite.privacyPolicy,
      confidentialiteEn: confidentialiteEn.privacyPolicyEn,
      contact: contact.CONTACT_SUBJECT,
    };
    for (const [nom, ensemble] of Object.entries(ensembles)) {
      const tous = textes(ensemble);
      expect(tous.filter((texte) => NOM.test(texte)), nom).toEqual([]);
      // Le nouveau nom est bien arrivé dans les phrases (l'essai a pris).
      expect(tous.some((texte) => texte.includes("Zorglub")), nom).toBe(true);
    }
    expect(fr.welcome.explain).toBe("Ajoutez une vidéo ou une photo. Zorglub retrouve la pièce et vous dit où l'acheter.");
    expect(en.appUpdate.title).toBe("Update Zorglub");
    expect(fr.post.shareMessage("Léa", "Dimanche")).toBe("Léa sur Zorglub : « Dimanche »");
    expect(fr.settings.exportFileBase).toBe("zorglub-mes-donnees");
    expect(contact.CONTACT_SUBJECT).toBe("Zorglub — contact");
  });
});

describe("aucun nom écrit en dur dans ce que les personnes voient", () => {
  it("code de l'app, modules de configuration, scripts, pages publiques et types partagés (hors commentaires)", () => {
    const code = [
      ...fichiers(join(MOBILE, "src"), [".ts", ".tsx"]),
      ...fichiers(join(MOBILE, "plugins"), [".js"]),
      ...fichiers(join(MOBILE, "scripts"), [".js"]),
      ...fichiers(join(MOBILE, "public"), [".js"]),
      join(MOBILE, "app.config.js"),
      join(MOBILE, "web-headers.ts"),
      join(DEPOT, "packages/shared-types/src/index.ts"),
    ];
    expect(code.length).toBeGreaterThan(100);
    expect(code.flatMap(nomsEnDur)).toEqual([]);
    for (const page of fichiers(join(MOBILE, "public"), [".html"])) {
      expect(sansInternes(lireAbsolu(page)).replace(/<!--[\s\S]*?-->/g, ""), page).not.toMatch(NOM);
    }
  });

  it("le garde-fou voit bien un nom en dur (chaîne, gabarit, texte d'écran), mais ni un commentaire ni un nom interne", () => {
    const essai = (code: string) => nomsEnDurDans("essai.tsx", code).length > 0;
    expect(essai(`const a = "Bienvenue sur ${marque.nom}";`)).toBe(true);
    expect(essai("const a = (n: string) => `${n} sur " + marque.nom.toUpperCase() + "`;")).toBe(true);
    expect(essai(`const a = <Text>${marque.nom}</Text>;`)).toBe(true);
    expect(essai(`// ${marque.nom} en commentaire\nconst a = 1; /* ${marque.nom} */\nconst b = <View>{/* ${marque.nom} */}</View>;`)).toBe(false);
    expect(essai(`const cle = "spotto.langue"; const source = "spotto-player";`)).toBe(false);
  });
});
