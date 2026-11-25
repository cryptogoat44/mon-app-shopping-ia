import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderExportHtml } from "../src/lib/exportHtml.js";
import { STORAGE, fixture, lookups } from "./exportFixture.js";

// Lot « couleurs et logo » (« Noir et ivoire », décision du 25 novembre 2026) :
// les trois e-mails du compte (collés à la main dans Supabase) et la page
// « Mes données » suivent les couleurs de l'app. Plus aucun vert : boutons et
// liens à l'encre sur fond clair (à l'ivoire sur fond sombre pour la page),
// liens soulignés. Les modèles gardent exactement leurs variables.

const EMAILS = join(__dirname, "../supabase/emails");
const MODELES = ["confirmation-inscription.html", "mot-de-passe-oublie.html", "changement-adresse.html"] as const;
const modele = (nom: string) => readFileSync(join(EMAILS, nom), "utf8");

const ENCRE = "#1D1D1F";
const IVOIRE = "#F4F2EE";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(a: string, b: string): number {
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (haut! + 0.05) / (bas! + 0.05);
}

/** Un vert (ou bleu-vert) : teinte entre le jaune-vert et le pétrole, et pas un gris. */
function vert(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.15) return false; // un gris, ou presque
  const teinte = max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240;
  return teinte >= 75 && teinte <= 200;
}

const couleurs = (texte: string) => [...texte.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());

/** Les liens `<a …>` qui ne sont pas un bouton (le bouton est un bloc : display:inline-block). */
function liensDuCorps(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((balise) => !balise.includes("display:inline-block"));
}
const lienConforme = (balise: string) => balise.includes(`color:${ENCRE};`) && balise.includes("text-decoration:underline");

describe("e-mails du compte : « Noir et ivoire »", () => {
  it("aucun vert dans les trois modèles", () => {
    for (const nom of MODELES) {
      const html = modele(nom);
      expect(couleurs(html).length, nom).toBeGreaterThan(5);
      expect(couleurs(html).filter(vert), nom).toEqual([]);
    }
  });

  it("le garde-fou reconnaît les anciens verts, pas l'encre, l'ivoire ni les gris", () => {
    expect(vert("#1E3D32")).toBe(true);
    expect(vert("#9CC3AE")).toBe(true);
    expect(vert("#004225")).toBe(true);
    for (const permis of [ENCRE, IVOIRE, "#FBFBFA", "#E4E4E0", "#6E6E73", "#FFFFFF"]) expect(vert(permis), permis).toBe(false);
  });

  it("bouton : fond encre, texte blanc (au moins 4,5:1) ; le garde-fou refuse un bouton pâle", () => {
    for (const nom of MODELES) {
      const html = modele(nom);
      expect(html.match(/background-color:#1D1D1F;/g), nom).toHaveLength(2); // un bouton en anglais, un en français
      for (const bouton of [...html.matchAll(/<a\b[^>]*display:inline-block[^>]*>/g)].map((m) => m[0])) expect(bouton, nom).toContain("color:#FFFFFF;");
    }
    expect(contraste("#FFFFFF", ENCRE)).toBeGreaterThanOrEqual(4.5);
    // Refusé : un texte ivoire sur un bouton blanc.
    expect(contraste(IVOIRE, "#FFFFFF")).toBeLessThan(4.5);
  });

  it("le lien de secours (adresse en toutes lettres) est à l'encre et souligné, lisible sur la carte blanche", () => {
    for (const nom of MODELES) {
      const liens = liensDuCorps(modele(nom));
      expect(liens, nom).toHaveLength(2);
      for (const lien of liens) expect(lienConforme(lien), `${nom} ${lien}`).toBe(true);
    }
    expect(contraste(ENCRE, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Refusé : un lien de la couleur du texte sans soulignement ne se distingue plus.
    expect(lienConforme(`<a href="{{ .ConfirmationURL }}" style="color:#1D1D1F;">`)).toBe(false);
    expect(lienConforme(`<a href="{{ .ConfirmationURL }}" style="color:#1D1D1F;text-decoration:underline;">`)).toBe(true);
  });

  it("chaque variable de Supabase reste à sa place, dans le même ordre (les modèles sont collés tels quels)", () => {
    const variables = (html: string) => [...html.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
    const langue = ['{{ if eq .Data.locale "en" }}', "{{ else }}", "{{ end }}", '{{ if eq .Data.locale "en" }}'];
    const lien = ["{{ .ConfirmationURL }}", "{{ .ConfirmationURL }}", "{{ .ConfirmationURL }}"];
    const attendu: Record<(typeof MODELES)[number], string[]> = {
      "confirmation-inscription.html": [...langue, "{{ .Email }}", ...lien, "{{ else }}", "{{ .Email }}", ...lien, "{{ end }}"],
      "mot-de-passe-oublie.html": [...langue, "{{ .Email }}", ...lien, "{{ else }}", "{{ .Email }}", ...lien, "{{ end }}"],
      "changement-adresse.html": [...langue, "{{ .Email }}", "{{ .NewEmail }}", ...lien, "{{ else }}", "{{ .Email }}", "{{ .NewEmail }}", ...lien, "{{ end }}"],
    };
    for (const nom of MODELES) expect(variables(modele(nom)), nom).toEqual(attendu[nom]);
    // Refusé : une variable renommée ne passerait pas.
    expect(variables(`<a href="{{ .ConfirmationUrl }}">`)).not.toEqual(["{{ .ConfirmationURL }}"]);
  });

  it("le mode d'emploi dit que les trois modèles ont changé de couleur et sont à recoller", () => {
    const reglages = readFileSync(join(EMAILS, "REGLAGES-SUPABASE.md"), "utf8");
    expect(reglages).toContain("25 novembre 2026");
    expect(reglages).toMatch(/changé de couleur[^\n]*25 novembre 2026[^\n]*recoller/);
  });
});

describe("page « Mes données » : « Noir et ivoire »", () => {
  const page = renderExportHtml(fixture(), lookups(), { locale: "fr", timeZone: "Europe/Paris", storageOrigin: STORAGE });
  const style = page.slice(page.indexOf("<style>"), page.indexOf("</style>"));
  const variable = (bloc: string, nom: string) => bloc.match(new RegExp(`--${nom}:(#[0-9A-Fa-f]{6})`))?.[1];
  const clair = style.slice(0, style.indexOf("@media (prefers-color-scheme:dark)"));
  const sombre = style.slice(style.indexOf("@media (prefers-color-scheme:dark)"), style.indexOf("*{box-sizing"));

  it("aucun vert dans la feuille de style", () => {
    expect(couleurs(style).length).toBeGreaterThan(10);
    expect(couleurs(style).filter(vert)).toEqual([]);
  });

  it("l'accent est l'encre en clair, l'ivoire en sombre, au moins 4,5:1 sur le fond et sur les cartes", () => {
    expect(variable(clair, "accent")).toBe(ENCRE);
    expect(variable(sombre, "accent")).toBe(IVOIRE);
    for (const bloc of [clair, sombre]) {
      for (const fond of ["bg", "surface"]) expect(contraste(variable(bloc, "accent")!, variable(bloc, fond)!), fond).toBeGreaterThanOrEqual(4.5);
    }
    // Refusé : l'encre laissée telle quelle sur le fond sombre.
    expect(contraste(ENCRE, variable(sombre, "bg")!)).toBeLessThan(4.5);
  });

  it("les liens sont soulignés (trait fin, léger décalage) ; le garde-fou refuse un lien sans trait", () => {
    const regle = style.match(/(?:^|\n)a\{[^}]*\}/)?.[0] ?? "";
    expect(regle).toContain("color:var(--accent)");
    expect(regle).toContain("text-decoration:underline");
    expect(regle).toContain("text-underline-offset:3px");
    expect("a{color:var(--accent);overflow-wrap:anywhere}").not.toContain("text-decoration:underline");
  });
});
