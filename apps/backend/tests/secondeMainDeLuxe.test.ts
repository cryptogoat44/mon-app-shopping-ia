import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOUTIQUES_CONNUES } from "../src/listes/boutiquesConnues.js";
import { BOUTIQUES_MASQUEES } from "../src/listes/boutiquesMasquees.js";
import { AUTRES_NOMS_DES_MARQUES, BOUTIQUES_OFFICIELLES } from "../src/listes/boutiquesOfficielles.js";
import { MAISONS_DE_LUXE, SITES_DE_REVENTE, type SiteDeRevente } from "../src/listes/secondeMainDeLuxe.js";
import { isHiddenShop } from "../src/lib/shopTrust.js";
import { wordsOf } from "../src/lib/wordSort.js";

// Seconde main de luxe : le fichier unique que le fondateur modifie
// (src/listes/secondeMainDeLuxe.ts). Les règles qu'une ligne doit suivre
// pour être acceptée, et les décisions du fondateur (23 novembre 2026) :
// Vestiaire Collective seul pour l'instant ; jamais Vinted ni Leboncoin ;
// 23 maisons, dont 9 qui ne servent qu'à cette entrée.

const PLACEHOLDER = "{mots}";

/** Les fautes d'une liste de sites ; [] : la liste est acceptable. */
function siteListFaults(sites: readonly SiteDeRevente[]): string[] {
  const faults: string[] = [];
  if (sites.length > 5) faults.push("plus de 5 sites");
  const names = sites.map((site) => wordsOf(site.nom).join(" "));
  if (new Set(names).size !== names.length) faults.push("deux sites de même nom");
  for (const site of sites) {
    if (site.nom.trim() === "" || site.nom.length > 40) faults.push(`nom : ${site.nom}`);
    if (!site.recherche.startsWith("https://")) faults.push(`pas https : ${site.recherche}`);
    if (site.recherche.split(PLACEHOLDER).length !== 2) faults.push(`un seul {mots} : ${site.recherche}`);
    let host = "";
    try {
      const url = new URL(site.recherche.replace(PLACEHOLDER, "x"));
      host = url.hostname;
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") faults.push(`adresse : ${site.recherche}`);
    } catch {
      faults.push(`illisible : ${site.recherche}`);
    }
    if (/(^|\.)vinted\.|(^|\.)leboncoin\./.test(host)) faults.push(`refusé par le fondateur : ${host}`);
    if (host !== "" && isHiddenShop(`https://${host}/`)) faults.push(`masqué : ${host}`);
  }
  return faults;
}

describe("les sites de revente : adresses de recherche", () => {
  it("permis : la liste du fondateur — une adresse https avec un seul {mots}", () => {
    expect(siteListFaults(SITES_DE_REVENTE)).toEqual([]);
    expect(siteListFaults([{ nom: "Exemple", recherche: "https://www.exemple.com/recherche?q={mots}" }])).toEqual([]);
  });

  it("refusé : http, aucun {mots}, deux {mots}, un identifiant ou un port dans l'adresse", () => {
    expect(siteListFaults([{ nom: "A", recherche: "http://www.exemple.com/recherche?q={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "A", recherche: "https://www.exemple.com/recherche" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "A", recherche: "https://www.exemple.com/{mots}?q={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "A", recherche: "https://moi@www.exemple.com/?q={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "A", recherche: "https://www.exemple.com:8443/?q={mots}" }])).not.toEqual([]);
  });

  it("l'adresse de Vestiaire Collective, vérifiée par le fondateur, est dans le fichier avec la note qui le dit", () => {
    expect(SITES_DE_REVENTE).toEqual([{ nom: "Vestiaire Collective", recherche: "https://fr.vestiairecollective.com/search/?q={mots}" }]);
    const file = readFileSync(join(__dirname, "../src/listes/secondeMainDeLuxe.ts"), "utf8");
    expect(file).toContain("VÉRIFIÉE PAR LE FONDATEUR le 23 novembre 2026");
    // Refusé : la note d'avant l'essai, qui dirait encore que personne ne l'a ouverte.
    expect(file).not.toContain("pas encore\n  // essayée dans un navigateur");
    expect(file).not.toContain("À VÉRIFIER PAR LE FONDATEUR avant la mise en ligne");
    expect(file).toContain("https://fr.vestiairecollective.com/search/?q=Dior%20Saddle");
  });
});

describe("les sites de revente : taille de la liste", () => {
  const site = (index: number): SiteDeRevente => ({ nom: `Site ${index}`, recherche: `https://site${index}.exemple.com/?q={mots}` });

  it("permis : de 1 à 5 sites de noms différents ; une liste vide (l'entrée n'apparaît plus, voir luxuryResale.test.ts)", () => {
    expect(siteListFaults([1, 2, 3, 4, 5].map(site))).toEqual([]);
    expect(siteListFaults([])).toEqual([]);
  });

  it("refusé : plus de 5 sites, ou deux sites de même nom (majuscules et accents ne comptent pas)", () => {
    expect(siteListFaults([1, 2, 3, 4, 5, 6].map(site))).toContain("plus de 5 sites");
    expect(siteListFaults([site(1), { ...site(2), nom: "SITE 1" }])).toContain("deux sites de même nom");
  });
});

describe("les sites de revente : décision du fondateur (« pas vinted ni leboncoin »)", () => {
  it("permis : Vestiaire Collective seul pour l'instant", () => {
    expect(SITES_DE_REVENTE.map((entry) => entry.nom)).toEqual(["Vestiaire Collective"]);
  });

  it("refusé : un site Vinted ou Leboncoin, quel que soit le pays ou le sous-domaine ; un site masqué", () => {
    expect(siteListFaults([{ nom: "Vinted", recherche: "https://www.vinted.fr/catalog?search_text={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "Vinted", recherche: "https://vinted.de/catalog?search_text={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "Leboncoin", recherche: "https://www.leboncoin.fr/recherche?text={mots}" }])).not.toEqual([]);
    expect(siteListFaults([{ nom: "Copies", recherche: "https://luxe-replica.exemple.com/?q={mots}" }])).not.toEqual([]);
    for (const domain of BOUTIQUES_MASQUEES) expect(siteListFaults([{ nom: "Masqué", recherche: `https://${domain}/?q={mots}` }])).not.toEqual([]);
  });
});

describe("les maisons", () => {
  const ADDRESS = /^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

  it("permis : les 23 maisons décidées par le fondateur, adresses écrites comme dans les autres listes, sans doublon", () => {
    expect(MAISONS_DE_LUXE.map((house) => house.nom)).toEqual([
      "Dior", "Chanel", "Louis Vuitton", "Hermès", "Gucci", "Prada", "Balenciaga", "Saint Laurent", "Celine", "Burberry", "Versace", "Moncler", "Stone Island", "Canada Goose",
      "Fendi", "Givenchy", "Valentino", "Bottega Veneta", "Loewe", "Miu Miu", "Chloé", "Balmain", "Goyard",
    ]);
    const addresses = MAISONS_DE_LUXE.flatMap((house) => house.adresses);
    for (const domain of addresses) expect(domain, domain).toMatch(ADDRESS);
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const house of MAISONS_DE_LUXE) expect(house.adresses.length, house.nom).toBeGreaterThan(0);
  });

  it("les 14 maisons d'aujourd'hui gardent leurs adresses et leurs autres noms de boutiquesOfficielles.ts ; les 9 nouvelles n'y sont pas (aucune mention, aucun effet sur l'ordre)", () => {
    for (const house of MAISONS_DE_LUXE.slice(0, 14)) {
      for (const domain of house.adresses) {
        expect(BOUTIQUES_OFFICIELLES, domain).toContain(domain);
        const others = (AUTRES_NOMS_DES_MARQUES.get(domain) ?? []).filter((name) => name !== house.nom);
        expect([...(house.aussi ?? [])].sort(), domain).toEqual([...others].sort());
      }
    }
    for (const house of MAISONS_DE_LUXE.slice(14)) for (const domain of house.adresses) expect(BOUTIQUES_OFFICIELLES, domain).not.toContain(domain);
  });

  it("refusé : une adresse de maison qui est aussi un revendeur connu, ou masquée ; un nom vide ou trop long ; un nom qui est celui d'une autre maison", () => {
    for (const house of MAISONS_DE_LUXE) {
      for (const domain of house.adresses) {
        expect(BOUTIQUES_CONNUES, domain).not.toContain(domain);
        expect(isHiddenShop(`https://${domain}/`), domain).toBe(false);
      }
      for (const name of [house.nom, ...(house.aussi ?? [])]) {
        expect(wordsOf(name).length, name).toBeGreaterThan(0);
        expect(house.nom.length, name).toBeLessThanOrEqual(40);
      }
    }
    const names = MAISONS_DE_LUXE.flatMap((house) => [house.nom, ...(house.aussi ?? [])].map((name) => wordsOf(name).join(" ")));
    expect(new Set(names).size).toBe(names.length);
  });

  it("refusé : « sauf » ne nomme jamais une maison de la liste, et contient bien le nom de sa maison (sinon il ne servirait à rien)", () => {
    const names = new Set(MAISONS_DE_LUXE.flatMap((house) => [house.nom, ...(house.aussi ?? [])].map((name) => wordsOf(name).join(" "))));
    for (const house of MAISONS_DE_LUXE) {
      for (const other of house.sauf ?? []) {
        expect(names.has(wordsOf(other).join(" ")), other).toBe(false);
        expect(` ${wordsOf(other).join(" ")} `, other).toContain(` ${wordsOf(house.nom).join(" ")} `);
      }
    }
  });

  it("« siteRequis » : Valentino, Celine et Chloé (noms aussi prénoms ou autres lignes) demandent leur site officiel ; permis : les autres maisons s'en passent", () => {
    const required = MAISONS_DE_LUXE.filter((house) => house.siteRequis === true).map((house) => house.nom);
    expect(required.sort()).toEqual(["Celine", "Chloé", "Valentino"]);
    expect(MAISONS_DE_LUXE.find((house) => house.nom === "Valentino")!.sauf).toContain("Valentino Bags");
  });
});
