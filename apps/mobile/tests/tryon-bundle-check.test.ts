import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/verifier-essayage-paquets.js (lancé à la main, jamais par la CI),
// version de la branche de l'app iPhone avec l'essayage : sa logique de
// recherche, vérifiée sur de faux paquets compilés. Ici, l'essayage est
// attendu dans les deux paquets, le code propre à l'iPhone seulement dans le
// paquet iPhone, et l'adresse de FASHN nulle part. Le script lui-même compile
// les vrais paquets (iPhone et site) avec Expo.
const require = createRequire(import.meta.url);
type Analyse = { fichiersJs: number; pagesHtml: number; marqueurs: Record<string, number>; marqueursIphone: Record<string, number>; marqueursHtml: number; interdits: number };
const { MARQUEURS, MARQUEURS_IPHONE, analyser, ecarts } = require("../scripts/verifier-essayage-paquets.js") as {
  MARQUEURS: string[];
  MARQUEURS_IPHONE: string[];
  analyser: (dossier: string) => Analyse;
  ecarts: (ios: Analyse, site: Analyse) => string[];
};

const dossiers: string[] = [];

/** Faux paquet : fichiers JavaScript sous _expo/static/js/<plateforme>/, pages HTML à la racine. */
function paquet(plateforme: string, js: string[], html: string[] = []): string {
  const racine = mkdtempSync(join(tmpdir(), "faux-paquet-"));
  dossiers.push(racine);
  const dossierJs = join(racine, "_expo", "static", "js", plateforme);
  mkdirSync(dossierJs, { recursive: true });
  js.forEach((texte, index) => writeFileSync(join(dossierJs, `morceau-${index}.js`), texte));
  html.forEach((texte, index) => writeFileSync(join(racine, `page-${index}.html`), texte));
  return racine;
}

const SITE_COMPLET = `fetch("/api/tryon/status");const t={a:"Essayage virtuel",b:"votre essayage",c:"FASHN (Royaume-Uni)",d:"Virtual try-on"};const e="tryon_quota_exhausted";form.append("attestSelf","true");function useTryonStatus(){}`;
const ECRANS_IPHONE = "e.pickTryonPhoto=async function(){};e.saveImageToPhotos=async function(){};e.sweepTryonFiles=function(){};Object.defineProperty(e,\"tryonIphoneText\",{});";
const IPHONE_COMPLET = `${SITE_COMPLET}${ECRANS_IPHONE}`;
const BIBLIOTHEQUES = "var a='useOptimizedViewRegistryOnAndroid';var b='RNSentryOnDrawReporter';var c='tryOnce';";

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

describe("contrôle des paquets compilés (branche iPhone : l'essayage dans les deux paquets)", () => {
  it("conforme : chaque mot dans les deux paquets, ceux de l'iPhone dans l'iPhone seulement, pages HTML muettes", () => {
    const ios = analyser(paquet("ios", [BIBLIOTHEQUES, IPHONE_COMPLET]));
    const site = analyser(paquet("web", [SITE_COMPLET, "var x=1;"], ["<html><body>Chargement</body></html>"]));
    expect(MARQUEURS.every((marqueur) => ios.marqueurs[marqueur]! > 0 && site.marqueurs[marqueur]! > 0)).toBe(true);
    expect(MARQUEURS_IPHONE.every((marqueur) => ios.marqueursIphone[marqueur]! > 0 && site.marqueursIphone[marqueur] === 0)).toBe(true);
    expect(site.fichiersJs).toBe(2);
    expect(site.pagesHtml).toBe(1);
    expect(ecarts(ios, site)).toEqual([]);
  });

  it("paquet iPhone sans l'essayage (celui de la branche principale) : non conforme, chaque mot manquant est cité", () => {
    const ios = analyser(paquet("ios", [BIBLIOTHEQUES]));
    const site = analyser(paquet("web", [SITE_COMPLET]));
    expect(ecarts(ios, site)).toEqual([
      ...MARQUEURS.map((marqueur) => `paquet iPhone : « ${marqueur} » absent (contrôle positif en échec)`),
      ...MARQUEURS_IPHONE.map((marqueur) => `paquet iPhone : « ${marqueur} » absent (écrans de l'iPhone manquants)`),
    ]);
  });

  it("paquet iPhone avec la seule logique du site, sans les écrans de l'iPhone : non conforme", () => {
    const ios = analyser(paquet("ios", [SITE_COMPLET]));
    const site = analyser(paquet("web", [SITE_COMPLET]));
    expect(ecarts(ios, site)).toEqual(MARQUEURS_IPHONE.map((marqueur) => `paquet iPhone : « ${marqueur} » absent (écrans de l'iPhone manquants)`));
  });

  it("code de l'iPhone dans le site : non conforme, avec le mot et le nombre", () => {
    const ios = analyser(paquet("ios", [IPHONE_COMPLET]));
    const site = analyser(paquet("web", [SITE_COMPLET, "e.pickTryonPhoto=1;(0,h.pickTryonPhoto)()"]));
    expect(ecarts(ios, site)).toEqual(["site : « pickTryonPhoto » trouvé 2 fois (code de l'iPhone dans le site)"]);
  });

  it("adresse de FASHN dans l'un ou l'autre paquet, trace dans une page HTML : non conforme", () => {
    const ios = analyser(paquet("ios", [IPHONE_COMPLET, 'fetch("https://api.FASHN.ai/v1/run")']));
    const site = analyser(paquet("web", [SITE_COMPLET, 'fetch("https://api.fashn.ai/v1/status")'], ["<p>Essayage virtuel</p>"]));
    expect(ecarts(ios, site)).toEqual(["site : 1 trace(s) dans les pages HTML rendues à l'avance", "paquet iPhone : adresse de FASHN trouvée", "site : adresse de FASHN trouvée"]);
  });

  it("casse comprise : les noms de bibliothèques où « tryOn » se cache ne comptent pas", () => {
    expect(MARQUEURS).toEqual(expect.arrayContaining(["tryon", "Tryon"]));
    const bibliotheques = analyser(paquet("ios", [BIBLIOTHEQUES]));
    expect(Object.values(bibliotheques.marqueurs).every((nombre) => nombre === 0)).toBe(true);
    expect(Object.values(bibliotheques.marqueursIphone).every((nombre) => nombre === 0)).toBe(true);
  });

  it("aucun fichier produit : non conforme", () => {
    const dossier = mkdtempSync(join(tmpdir(), "faux-paquet-vide-"));
    dossiers.push(dossier);
    const vide = analyser(dossier);
    expect(ecarts(vide, vide)).toEqual(expect.arrayContaining(["paquet iPhone : aucun fichier JavaScript produit", "site : aucun fichier JavaScript produit"]));
  });
});
