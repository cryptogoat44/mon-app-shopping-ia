import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { deviceTimeZone, exportFile, exportFileName, receivedFormat } from "../src/lib/export-file";

// Lot 5 : export des données au choix, fichier lisible (HTML rendu par le
// serveur) ou format technique (JSON). Nom, type et contenu du fichier.
const HTML = "text/html; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
// 13 octobre 2026, 9 h 05, heure locale de l'appareil.
const NOW = new Date(2026, 9, 13, 9, 5);

afterEach(() => setActiveLocale("fr"));

describe("fuseau de l'appareil envoyé au serveur", () => {
  it("un fuseau IANA est envoyé tel quel", () => {
    expect(deviceTimeZone(() => "Europe/Paris")).toBe("Europe/Paris");
    expect(deviceTimeZone(() => "America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(deviceTimeZone(() => "Etc/GMT+5")).toBe("Etc/GMT+5");
  });

  it("introuvable, trop long ou d'une forme inattendue : rien n'est envoyé", () => {
    expect(deviceTimeZone(() => undefined)).toBeNull();
    expect(deviceTimeZone(() => "")).toBeNull();
    expect(deviceTimeZone(() => "Europe/Paris\r\nX-Autre: 1")).toBeNull();
    expect(deviceTimeZone(() => "Europe/Pa ris")).toBeNull();
    expect(deviceTimeZone(() => "A".repeat(65))).toBeNull();
    expect(
      deviceTimeZone(() => {
        throw new RangeError("Intl indisponible");
      })
    ).toBeNull();
  });

  it("lecture réelle : un fuseau valide ou rien", () => {
    const zone = deviceTimeZone();
    expect(zone === null || /^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)).toBe(true);
  });
});

describe("format réellement reçu", () => {
  it("fichier lisible demandé et reçu", () => {
    expect(receivedFormat("html", HTML)).toBe("html");
    expect(receivedFormat("html", "TEXT/HTML")).toBe("html");
  });

  it("serveur plus ancien (pendant un déploiement) : le JSON reçu reste un .json", () => {
    expect(receivedFormat("html", JSON_TYPE)).toBe("json");
    expect(receivedFormat("html", null)).toBe("json");
    expect(receivedFormat("html", "text/htmlx")).toBe("json");
  });

  it("format technique demandé : toujours du JSON", () => {
    expect(receivedFormat("json", JSON_TYPE)).toBe("json");
    expect(receivedFormat("json", HTML)).toBe("json");
  });
});

describe("nom du fichier", () => {
  it("dans la langue de l'app, daté et heuré en heure locale", () => {
    expect(exportFileName("html", NOW)).toBe("spotto-mes-donnees-2026-10-13-0905.html");
    expect(exportFileName("json", new Date(2026, 0, 2, 23, 59))).toBe("spotto-mes-donnees-2026-01-02-2359.json");
    setActiveLocale("en");
    expect(exportFileName("html", NOW)).toBe("spotto-my-data-2026-10-13-0905.html");
  });

  it("construit au moment de l'export : la date et la langue du moment", () => {
    const before = Date.now();
    const name = exportFileName("json");
    const today = new Date(before);
    expect(name.startsWith(`spotto-mes-donnees-${today.getFullYear()}-`)).toBe(true);
    expect(name).toMatch(/^spotto-mes-donnees-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    setActiveLocale("en");
    expect(exportFileName("json")).toMatch(/^spotto-my-data-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  });
});

describe("fichier enregistré", () => {
  it("fichier lisible : le HTML du serveur, intact, en text/html", () => {
    const html = "<!doctype html><html lang=\"fr\"><body>Vos données</body></html>";
    expect(exportFile("html", { text: html, contentType: HTML }, NOW)).toEqual({
      format: "html",
      name: "spotto-mes-donnees-2026-10-13-0905.html",
      content: html,
      mimeType: "text/html",
      uti: "public.html",
    });
  });

  it("format technique : le JSON remis en forme, en application/json", () => {
    const file = exportFile("json", { text: "{\"profile\":{\"username\":\"lea\"},\"posts\":[]}", contentType: JSON_TYPE }, NOW);
    expect(file).toEqual({
      format: "json",
      name: "spotto-mes-donnees-2026-10-13-0905.json",
      content: "{\n  \"profile\": {\n    \"username\": \"lea\"\n  },\n  \"posts\": []\n}",
      mimeType: "application/json",
      uti: "public.json",
    });
  });

  it("fichier lisible demandé à un serveur plus ancien : enregistré en .json", () => {
    const file = exportFile("html", { text: "{\"posts\":[]}", contentType: JSON_TYPE }, NOW);
    expect(file.name).toBe("spotto-mes-donnees-2026-10-13-0905.json");
    expect(file.mimeType).toBe("application/json");
    expect(file.uti).toBe("public.json");
    expect(file.content).toBe("{\n  \"posts\": []\n}");
  });

  it("un texte qui n'est pas du JSON valide est gardé tel quel", () => {
    expect(exportFile("json", { text: "{tronqué", contentType: JSON_TYPE }, NOW).content).toBe("{tronqué");
  });
});
