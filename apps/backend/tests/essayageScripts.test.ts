import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  balanceRefusal,
  COSTS_MONEY_FLAG,
  describeTarget,
  FASHN_BALANCE_FLAG,
  flagRequest,
  formatMonthReport,
  isInsideDirectory,
  optionValue,
  smokeRequest,
  targetProjectOf,
} from "../scripts/lib/tryon-admin.js";
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from "../scripts/lib/dev-database.js";

// Essayage virtuel : les garde-fous des scripts d'administration, sans base
// ni réseau. Le drapeau ne s'allume jamais sans --confirm (et --production
// hors de spotto-dev-2) ; l'essai réel (tryon:smoke) ne part jamais sans la
// clé, les deux fichiers et --i-understand-this-costs-money ; le rapport ne
// lit le solde FASHN qu'avec --solde-fashn ; la base visée est toujours
// dite. Aucun script n'est lancé ici.

const DEV = targetProjectOf(`https://${DEV_PROJECT_REF}.supabase.co`);
const PROD = targetProjectOf(`https://${PROD_PROJECT_REF}.supabase.co`);
const OTHER = targetProjectOf("https://abcdefghijklmnopqrst.supabase.co");

describe("base visée", () => {
  it("reconnaît spotto-dev-2, la production et un autre projet ; l'affiche toujours", () => {
    expect(DEV).toMatchObject({ name: "spotto-dev-2", isDev: true, isProduction: false });
    expect(PROD).toMatchObject({ isDev: false, isProduction: true });
    expect(PROD.name).toContain("PRODUCTION");
    expect(OTHER).toMatchObject({ ref: "abcdefghijklmnopqrst", isDev: false, isProduction: false });
    expect(describeTarget(DEV)).toBe(`Base visée : spotto-dev-2 (référence ${DEV_PROJECT_REF}).`);
  });
});

describe("tryon:flag : allumer demande --confirm, et --production hors de spotto-dev-2", () => {
  it("sans option : simple lecture ; --off : toujours permis", () => {
    expect(flagRequest([], DEV)).toEqual({ action: "show" });
    expect(flagRequest(["--off"], PROD)).toEqual({ action: "off" });
  });

  it("--on sans --confirm : refusé, avec l'explication", () => {
    const refused = flagRequest(["--on"], DEV);
    expect(refused).toHaveProperty("refused");
    expect((refused as { refused: string }).refused).toContain("--on --confirm");
    expect((refused as { refused: string }).refused).toContain("avocat");
  });

  it("--on --confirm : permis sur spotto-dev-2, refusé ailleurs sans --production", () => {
    expect(flagRequest(["--on", "--confirm"], DEV)).toEqual({ action: "on" });
    for (const project of [PROD, OTHER]) {
      const refused = flagRequest(["--on", "--confirm"], project);
      expect((refused as { refused: string }).refused).toContain("--production");
      expect(flagRequest(["--on", "--confirm", "--production"], project)).toEqual({ action: "on" });
    }
    expect(flagRequest(["--on", "--off", "--confirm"], DEV)).toHaveProperty("refused");
  });
});

describe("tryon:smoke : jamais d'appel payant sans tout confirmer", () => {
  const files = ["--photo", "/tmp/moi.jpg", "--garment", "/tmp/veste.jpg"];

  it("refusé sans --i-understand-this-costs-money, sans clé, ou sans les deux fichiers", () => {
    expect(smokeRequest(files, true)).toHaveProperty("refused");
    expect((smokeRequest(files, true) as { refused: string }).refused).toContain("0,075 $");
    expect(smokeRequest([...files, COSTS_MONEY_FLAG], false)).toEqual({ refused: "Refusé : FASHN_API_KEY manque dans apps/backend/.env." });
    expect(smokeRequest(["--photo", "/tmp/moi.jpg", COSTS_MONEY_FLAG], true)).toHaveProperty("refused");
    expect(smokeRequest(["--photo", "--garment", "/tmp/veste.jpg", COSTS_MONEY_FLAG], true)).toHaveProperty("refused");
  });

  it("tout confirmé : les deux fichiers, et la langue du bandeau", () => {
    expect(smokeRequest([...files, COSTS_MONEY_FLAG], true)).toEqual({ photo: "/tmp/moi.jpg", garment: "/tmp/veste.jpg", locale: "fr" });
    expect(smokeRequest([...files, COSTS_MONEY_FLAG, "--lang", "en"], true)).toMatchObject({ locale: "en" });
    expect(optionValue(["--user", "--confirm"], "--user")).toBeNull();
  });

  it("le résultat n'est jamais écrit dans le dépôt", () => {
    const repository = join(__dirname, "../../..");
    expect(isInsideDirectory(join(repository, "apps/backend/x.jpg"), repository)).toBe(true);
    expect(isInsideDirectory(repository, repository)).toBe(true);
    expect(isInsideDirectory(join(tmpdir(), "essayage-smoke-abc/resultat.jpg"), repository)).toBe(false);
    expect(isInsideDirectory(`${repository}-autre/x.jpg`, repository)).toBe(false);
  });

  it("seul tryon:smoke envoie un vrai essai à FASHN, avec une confirmation explicite ; aucun test ne le lance", () => {
    const smoke = readFileSync(join(__dirname, "../scripts/tryon-smoke.ts"), "utf8");
    expect(smoke).toContain("smokeRequest(process.argv.slice(2)");
    const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["tryon:smoke"]).toBe("tsx scripts/tryon-smoke.ts");
    for (const name of ["tryon:report", "tryon:flag", "tryon:grant-bonus", "tryon:reset-age", "tryon:purge"]) expect(packageJson.scripts[name], name).toMatch(/^tsx scripts\/tryon-[a-z-]+\.ts$/);
  });
});

describe("tryon:report : le solde FASHN seulement sur demande explicite (--solde-fashn)", () => {
  it("sans l'option : non lu, et le rapport dit comment l'obtenir ; avec : seulement si FASHN est le fournisseur réglé", () => {
    expect(FASHN_BALANCE_FLAG).toBe("--solde-fashn");
    for (const args of [[], ["--mois", "2026-11"]]) {
      const refusal = balanceRefusal(args, "fashn");
      expect(refusal).toContain("--solde-fashn");
      expect(refusal).toContain("non lu");
    }
    expect(balanceRefusal([FASHN_BALANCE_FLAG], "fake")).toBe("non lu (TRYON_PROVIDER n'est pas « fashn »)");
    expect(balanceRefusal([FASHN_BALANCE_FLAG, "--mois", "2026-11"], "fashn")).toBeNull();
  });

  it("le script ne lit la clé qu'après l'option, et ne joint FASHN que pour le solde", () => {
    const report = readFileSync(join(__dirname, "../scripts/tryon-report.ts"), "utf8");
    const code = report
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/**"))
      .join("\n");
    const refusal = code.indexOf("balanceRefusal(args, settings.provider)");
    expect(refusal).toBeGreaterThan(0);
    expect(code.match(/process\.env\.FASHN_API_KEY/g)).toHaveLength(1);
    expect(code.indexOf("process.env.FASHN_API_KEY")).toBeGreaterThan(refusal);
    expect(code.match(/new FashnProvider\(/g)).toHaveLength(1);
    expect(code.indexOf("new FashnProvider(")).toBeGreaterThan(refusal);
    expect(code).not.toMatch(/\.run\(/);
  });
});

describe("tryon:report : le mois en un coup d'œil, sans donnée personnelle", () => {
  it("dépense, budget restant, essais réussis et échoués, taux d'échec par code, signalements, alertes, solde", () => {
    const lines = formatMonthReport({
      month: "2026-11",
      budgetUsd: 100,
      pricePerCreditUsd: 0.075,
      alertThreshold: 0.8,
      creditsUsed: 400,
      succeeded: 400,
      failed: 100,
      pending: 1,
      failuresByCode: { pose_not_detected: 60, timeout: 10, moderation_blocked: 30 },
      reportsByReason: { wrong_piece: 3, inappropriate: 1 },
      alerts: [],
      providerBalance: 1234,
    });
    expect(lines).toEqual([
      "Mois : 2026-11 (heure de Paris)",
      "Dépense du mois : 30,00 $ sur 100,00 $ (30,0 % ; alerte à 80,0 %)",
      "Budget restant : 70,00 $ (400 crédits consommés à 0,075 $ le crédit)",
      "Essais réussis : 400 ; échoués : 100 ; en cours : 1",
      "Taux d'échec : 20,0 %",
      "Échecs par code (part des essais du mois) :",
      "  - pose_not_detected : 60 (12,0 %)",
      "  - moderation_blocked : 30 (6,0 %)",
      "  - timeout : 10 (2,0 %)",
      "Signalements du mois : wrong_piece 3, inappropriate 1",
      "Alertes du mois : aucune",
      "Solde FASHN : 1234 crédits",
    ]);
  });

  it("mois sans essai ; solde non lu (fournisseur factice ou sans clé)", () => {
    const lines = formatMonthReport({
      month: "2026-12",
      budgetUsd: 100,
      pricePerCreditUsd: 0.075,
      alertThreshold: 0.8,
      creditsUsed: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      failuresByCode: {},
      reportsByReason: {},
      alerts: ["budget_80 (2026-12)"],
      providerBalance: "non lu",
    });
    expect(lines).toContain("Taux d'échec : aucun essai");
    expect(lines).toContain("Alertes du mois : budget_80 (2026-12)");
    expect(lines).toContain("Solde FASHN : non lu");
  });
});
