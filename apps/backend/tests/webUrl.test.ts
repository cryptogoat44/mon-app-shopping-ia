import { describe, expect, it } from "vitest";
import { WEB_URL_MAX_LENGTH, isWebUrl, webUrlOrNull, webUrlSchema } from "../src/lib/validation.js";

// Liens reçus de l'app (envies : image et lien marchand) : seulement http et
// https, lus par le parseur d'URL standard. Aucune base, aucun réseau.

/** Un lien https d'exactement `length` caractères. */
function httpsLinkOfLength(length: number): string {
  const start = "https://marchand.example/";
  return start + "a".repeat(length - start.length);
}

describe("isWebUrl : liens web ordinaires acceptés", () => {
  it.each([
    ["https avec chemin, paramètres et ancre", "https://www.example-shop.test/sac?taille=38&couleur=noir#avis"],
    ["http", "http://example.com"],
    ["HTTP en majuscules", "HTTP://EXAMPLE.COM/PAGE"],
    ["majuscules et minuscules mêlées", "HtTpS://example.com/a"],
    ["port", "https://shop.example:8443/produit?q=1"],
    ["nom de domaine accentué (IDN)", "https://exämple.fr/sac"],
    ["nom de domaine accentué déjà encodé", "https://xn--exmple-cua.fr/sac"],
    ["paramètres encodés de suivi", "https://www.marchand.example/robe-noire?utm_source=google&ref=lens%20test&p=1%2C2"],
    ["@ dans le chemin, pas dans le nom de site", "https://medium.com/@marque/collection"],
    ["vignette de Google", "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR0abc&s"],
  ])("%s", (_label, link) => {
    expect(isWebUrl(link)).toBe(true);
    expect(webUrlSchema.safeParse(link).success).toBe(true);
  });
});

describe("isWebUrl : tout le reste est refusé", () => {
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["JAVASCRIPT: en majuscules", "JAVASCRIPT:alert(1)"],
    ["JaVaScRiPt: mêlé", "JaVaScRiPt:alert(document.cookie)"],
    ["espace avant javascript:", " javascript:alert(1)"],
    ["espace après", "javascript:alert(1) "],
    ["tabulation avant", "\tjavascript:alert(1)"],
    ["caractère de contrôle avant", "\u0001javascript:alert(1)"],
    ["tabulation dans le protocole", "java\tscript:alert(1)"],
    ["retour à la ligne dans le protocole", "java\nscript:alert(1)"],
    ["retour chariot dans le protocole", "java\rscript:alert(1)"],
    ["data: (page HTML)", "data:text/html,<script>alert(1)</script>"],
    ["data: en base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["DATA: en majuscules", "DATA:text/html,<b>x</b>"],
    ["data: image", "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["blob:", "blob:https://www.example.com/0b6e8f1c-2f43-4c1e-9d6e-3a1f2b4c5d6e"],
    ["ftp:", "ftp://ftp.example.com/fichier"],
    ["about:", "about:blank"],
    ["mailto:", "mailto:contact@example.com"],
    ["sans protocole (« //site »)", "//evil.example/x"],
    ["sans protocole, barres obliques inverses", "\\\\evil.example"],
    ["chemin seul", "/chemin/relatif"],
    ["nom de site seul", "example.com"],
    ["https: sans « // »", "https:evil.example"],
    ["https: avec barres obliques inverses", "https:\\\\evil.example"],
    ["https:/// (aucun nom de site juste après)", "https:///evil.example"],
    ["https:// vide", "https://"],
    ["http:// vide", "http://"],
    ["espace dans le nom de site", "https://exa mple.com/"],
    ["espace avant https", " https://example.com"],
    ["espace après https", "https://example.com "],
    ["retour à la ligne après https", "https://example.com\n"],
    ["espace insécable avant", " https://example.com"],
    ["marque d'ordre des octets avant", "﻿https://example.com"],
    ["caractère de contrôle au milieu", "https://example.com/a\u0000b"],
    ["identifiants dans le lien", "https://nom:secret@example.com/"],
    ["faux nom de site avant @", "https://www.marque.example@evil.example/"],
    ["texte vide", ""],
  ])("%s", (_label, link) => {
    expect(isWebUrl(link)).toBe(false);
    expect(webUrlSchema.safeParse(link).success).toBe(false);
  });
});

describe("webUrlSchema", () => {
  it("2 048 caractères au plus", () => {
    expect(WEB_URL_MAX_LENGTH).toBe(2048);
    expect(webUrlSchema.safeParse(httpsLinkOfLength(2048)).success).toBe(true);
    expect(webUrlSchema.safeParse(httpsLinkOfLength(2049)).success).toBe(false);
  });

  it("garde le lien tel qu'il a été envoyé (aucune réécriture)", () => {
    expect(webUrlSchema.parse("HTTP://EXAMPLE.COM/Page?a=b c")).toBe("HTTP://EXAMPLE.COM/Page?a=b c");
    expect(webUrlSchema.parse("https://exämple.fr/sac")).toBe("https://exämple.fr/sac");
  });

  it("refuse ce qui n'est pas un texte", () => {
    for (const value of [null, undefined, 42, { href: "https://example.com" }, ["https://example.com"]]) {
      expect(webUrlSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("webUrlOrNull : un lien rangé plus tôt n'est renvoyé que s'il est un lien web", () => {
  it("garde un lien web, tel quel, même long", () => {
    expect(webUrlOrNull("https://marchand.example/robe?taille=38")).toBe("https://marchand.example/robe?taille=38");
    const long = httpsLinkOfLength(3000);
    expect(webUrlOrNull(long)).toBe(long);
  });

  it("remplace tout le reste par null", () => {
    expect(webUrlOrNull(null)).toBeNull();
    expect(webUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(webUrlOrNull("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(webUrlOrNull(" https://marchand.example/robe")).toBeNull();
  });
});
