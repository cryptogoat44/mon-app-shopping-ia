// Rapport du mois de l'essayage virtuel (migration 0042), pour le fondateur :
// dépense du mois et budget restant, essais réussis et échoués, taux d'échec
// par code, signalements par motif, alertes du mois, et le solde de crédits
// FASHN (seulement avec TRYON_PROVIDER=fashn et une clé : la lecture du
// solde est gratuite chez FASHN). Aucune donnée personnelle : des nombres et
// des codes.
//
//   pnpm --filter backend tryon:report                  mois en cours (heure de Paris)
//   pnpm --filter backend tryon:report --mois 2026-11   un autre mois
//
// Utilise SUPABASE_URL, la clé du serveur et les réglages TRYON_* de
// apps/backend/.env (budget, prix du crédit, seuil d'alerte). La base visée
// est toujours affichée ; rien de secret n'est affiché.
import "dotenv/config";
import { z } from "zod";
import { readAll } from "../src/lib/pagedReads.js";
import { monthKeyAt, zonedMidnight } from "../src/lib/tryon/calendar.js";
import { readTryonSettings, type TryonEnvSource, type TryonSettings } from "../src/lib/tryon/config.js";
import { FashnProvider } from "../src/lib/tryon/providers/fashn.js";
import { describeTarget, formatMonthReport, optionValue, serviceClient } from "./lib/tryon-admin.js";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const EVENT_ROWS = z.array(z.object({ status: z.enum(["pending", "succeeded", "failed"]), error_code: z.string().nullable() }));
const REPORT_ROWS = z.array(z.object({ reason: z.string() }));
const ALERT_ROWS = z.array(z.object({ kind: z.string(), period: z.string() }));

/** Combien de fois chaque valeur revient. */
function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Le solde FASHN (lecture gratuite), seulement si FASHN est le fournisseur réglé avec une clé. */
async function providerBalance(settings: TryonSettings): Promise<number | string> {
  const apiKey = process.env.FASHN_API_KEY?.trim();
  if (settings.provider !== "fashn" || !apiKey) return "non lu (TRYON_PROVIDER n'est pas « fashn », ou FASHN_API_KEY est absente)";
  try {
    return await new FashnProvider({ apiKey, baseUrl: settings.apiBaseUrl }).getCreditBalance();
  } catch {
    return "illisible (FASHN injoignable ou clé refusée)";
  }
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const settings = readTryonSettings(process.env as unknown as TryonEnvSource, problems);
  if (problems.length > 0) throw new Error(`Réglages de l'essayage invalides : ${problems.join(" ; ")}`);
  const asked = optionValue(process.argv.slice(2), "--mois");
  const month = asked ?? monthKeyAt(new Date(), settings.timeZone);
  const parts = MONTH.exec(month);
  if (!parts) throw new Error("Mois invalide : écrivez-le AAAA-MM, par exemple 2026-11.");
  const [year, monthNumber] = [Number(parts[1]), Number(parts[2])];
  const start = zonedMidnight({ year, month: monthNumber, day: 1 }, settings.timeZone).toISOString();
  const end = zonedMidnight(monthNumber === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: monthNumber + 1, day: 1 }, settings.timeZone).toISOString();

  const { client, project } = serviceClient(process.env);
  console.log(describeTarget(project));
  const events = EVENT_ROWS.parse(await readAll("Essais du mois", () => client.from("tryon_events").select("id, status, error_code", { count: "exact" }).eq("month", month), ["id"]));
  const reports = REPORT_ROWS.parse(
    await readAll("Signalements du mois", () => client.from("tryon_reports").select("id, reason", { count: "exact" }).gte("created_at", start).lt("created_at", end), ["id"])
  );
  const usage = await client.from("tryon_usage_months").select("credits_used").eq("month", month).maybeSingle();
  if (usage.error) throw new Error("Lecture des compteurs du mois impossible (la migration 0042 est-elle appliquée ?).");
  const alerts = await client.from("tryon_alerts").select("kind, period").like("period", `${month}%`).order("period");
  if (alerts.error) throw new Error("Lecture des alertes impossible.");

  const failed = events.filter((event) => event.status === "failed");
  const lines = formatMonthReport({
    month,
    budgetUsd: settings.monthlyBudgetUsd,
    pricePerCreditUsd: settings.pricePerCreditUsd,
    alertThreshold: settings.alertThreshold,
    creditsUsed: Number((usage.data as { credits_used?: number } | null)?.credits_used ?? 0),
    succeeded: events.filter((event) => event.status === "succeeded").length,
    failed: failed.length,
    pending: events.filter((event) => event.status === "pending").length,
    failuresByCode: tally(failed.map((event) => event.error_code ?? "inconnu")),
    reportsByReason: tally(reports.map((report) => report.reason)),
    alerts: ALERT_ROWS.parse(alerts.data ?? []).map((alert) => `${alert.kind} (${alert.period})`),
    providerBalance: await providerBalance(settings),
  });
  for (const line of lines) console.log(line);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
