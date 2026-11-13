import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/verifier-essayage-paquets.js (lancé à la main, jamais par la CI) :
// sa logique de recherche, vérifiée sur de faux paquets compilés. Le script
// lui-même compile les vrais paquets (iPhone et site) avec Expo.
const require = createRequire(import.meta.url);
const { MARQUEURS, analyser, ecarts } = require("../scripts/verifier-essayage-paquets.js") as {
  MARQUEURS: string[];
  analyser: (dossier: string) => { fichiersJs: number; pagesHtml: number; marqueurs: Record<string, number>; marqueursHtml: number; interdits: number };
  ecarts: (ios: ReturnType<typeof analyser>, site: ReturnType<typeof analyser>) => string[];
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

const SITE_COMPLET = `fetch("/api/tryon/status");const t={a:"Essayage virtuel",b:"votre essayage",c:"FASHN (Royaume-Uni)",d:"Virtual try-on"};const e="tryon_quota_exhausted";form.append("attestSelf","true");`;

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

describe("contrôle des paquets compilés (iPhone sans trace, site avec)", () => {
  it("conforme : iPhone sans aucun mot cherché, site avec chacun d'eux, pages HTML muettes", () => {
    const ios = analyser(paquet("ios", ["var a='useOptimizedViewRegistryOnAndroid';var b='RNSentryOnDrawReporter';"]));
    const site = analyser(paquet("web", [SITE_COMPLET, "var x=1;"], ["<html><body>Chargement</body></html>"]));
    expect(Object.values(ios.marqueurs).every((nombre) => nombre === 0)).toBe(true);
    expect(MARQUEURS.every((marqueur) => site.marqueurs[marqueur]! > 0)).toBe(true);
    expect(site.fichiersJs).toBe(2);
    expect(site.pagesHtml).toBe(1);
    expect(ecarts(ios, site)).toEqual([]);
  });

  it("une trace dans le paquet iPhone : non conforme, avec le mot et le nombre", () => {
    const ios = analyser(paquet("ios", ['var u="/api/tryon/status";']));
    const site = analyser(paquet("web", [SITE_COMPLET]));
    expect(ecarts(ios, site)).toEqual(["paquet iPhone : « /api/tryon » trouvé 1 fois"]);
  });

  it("contrôle positif : un mot absent du site, une trace dans une page HTML, une adresse de FASHN", () => {
    const ios = analyser(paquet("ios", ["var a=1;"]));
    const site = analyser(paquet("web", [SITE_COMPLET.replace("attestSelf", "attest"), 'fetch("https://api.fashn.ai/v1/run")'], ["<p>Essayage virtuel</p>"]));
    expect(ecarts(ios, site)).toEqual([
      "site : « attestSelf » absent (contrôle positif en échec)",
      "site : 1 trace(s) dans les pages HTML rendues à l'avance",
      "site : adresse de FASHN trouvée",
    ]);
  });

  it("aucun fichier produit : non conforme", () => {
    const dossier = mkdtempSync(join(tmpdir(), "faux-paquet-vide-"));
    dossiers.push(dossier);
    const vide = analyser(dossier);
    expect(ecarts(vide, vide)).toEqual(expect.arrayContaining(["paquet iPhone : aucun fichier JavaScript produit", "site : aucun fichier JavaScript produit"]));
  });
});
