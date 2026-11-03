import { describe, expect, it } from "vitest";
import { isWebUrl } from "../src/lib/web-url";

// Liens ouverts par l'app : seulement des adresses web ordinaires (http,
// https). Même règle que le serveur pour les liens qu'il reçoit.

describe("isWebUrl : liens web ordinaires acceptés", () => {
  it.each([
    ["https avec chemin, paramètres et ancre", "https://www.example-shop.test/sac?taille=38&couleur=noir#avis"],
    ["http", "http://example.com"],
    ["HTTP en majuscules", "HTTP://EXAMPLE.COM/PAGE"],
    ["majuscules et minuscules mêlées", "HtTpS://example.com/a"],
    ["port", "https://shop.example:8443/produit?q=1"],
    ["nom de domaine accentué (IDN)", "https://exämple.fr/sac"],
    ["lien affilié avec paramètres encodés", "https://marchand.example/robe?aff=spotto&ref=lens%20test"],
    ["très long (aucune limite de longueur à l'ouverture)", `https://marchand.example/${"a".repeat(3000)}`],
  ])("%s", (_label, link) => {
    expect(isWebUrl(link)).toBe(true);
  });
});

describe("isWebUrl : tout le reste est refusé", () => {
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["JAVASCRIPT: en majuscules", "JAVASCRIPT:alert(1)"],
    ["espace avant javascript:", " javascript:alert(1)"],
    ["tabulation dans le protocole", "java\tscript:alert(1)"],
    ["retour à la ligne dans le protocole", "java\nscript:alert(1)"],
    ["caractère de contrôle avant", "\u0001javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["data: en base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["blob:", "blob:https://www.example.com/0b6e8f1c-2f43-4c1e-9d6e-3a1f2b4c5d6e"],
    ["ftp:", "ftp://ftp.example.com/fichier"],
    ["sans protocole (« //site »)", "//evil.example/x"],
    ["nom de site seul", "example.com"],
    ["https: sans « // »", "https:evil.example"],
    ["https:/// (aucun nom de site juste après)", "https:///evil.example"],
    ["https:// vide", "https://"],
    ["espace avant https", " https://example.com"],
    ["espace après https", "https://example.com "],
    ["retour à la ligne après https", "https://example.com\n"],
    ["espace insécable avant", " https://example.com"],
    ["texte vide", ""],
  ])("%s", (_label, link) => {
    expect(isWebUrl(link)).toBe(false);
  });

  it("refuse ce qui n'est pas un texte", () => {
    for (const value of [null, undefined, 42, { href: "https://example.com" }, ["https://example.com"]]) {
      expect(isWebUrl(value)).toBe(false);
    }
  });
});
