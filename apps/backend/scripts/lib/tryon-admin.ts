// Outils communs aux scripts d'administration de l'essayage virtuel (lot
// « essayage virtuel ») : la base visée (toujours affichée), les options de
// la ligne de commande, la décision d'allumer ou d'éteindre le drapeau, le
// texte du rapport du mois, les garde-fous de l'essai réel (tryon:smoke).
// Fonctions pures : testées sans base ni réseau (tests/essayageScripts.test.ts).
// Rien de secret n'est jamais affiché : ni clé, ni mot de passe.
import { isAbsolute, relative, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DEV_PROJECT_NAME, DEV_PROJECT_REF, PROD_PROJECT_REF } from "./dev-database.js";

/** La base visée par SUPABASE_URL. */
export interface TargetProject {
  ref: string;
  name: string;
  isDev: boolean;
  isProduction: boolean;
}

/** La base visée, d'après l'adresse du projet Supabase (https://<ref>.supabase.co). */
export function targetProjectOf(supabaseUrl: string): TargetProject {
  const ref = new URL(supabaseUrl).hostname.split(".")[0] ?? "";
  if (ref === DEV_PROJECT_REF) return { ref, name: DEV_PROJECT_NAME, isDev: true, isProduction: false };
  if (ref === PROD_PROJECT_REF) return { ref, name: "spotto-prod (PRODUCTION)", isDev: false, isProduction: true };
  return { ref, name: "projet inconnu (ni spotto-dev-2, ni spotto-prod)", isDev: false, isProduction: false };
}

export function describeTarget(project: TargetProject): string {
  return `Base visée : ${project.name} (référence ${project.ref}).`;
}

const SERVICE_SETTINGS = z.object({ SUPABASE_URL: z.url({ protocol: /^https?$/ }), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) });

/** Le client de la base, avec la clé du serveur (apps/backend/.env), et la base visée. */
export function serviceClient(source: NodeJS.ProcessEnv): { client: SupabaseClient; project: TargetProject } {
  const settings = SERVICE_SETTINGS.safeParse(source);
  if (!settings.success) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manque dans apps/backend/.env.");
  return {
    client: createClient(settings.data.SUPABASE_URL, settings.data.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }),
    project: targetProjectOf(settings.data.SUPABASE_URL),
  };
}

/** Une option « --nom » est-elle présente ? */
export function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

/** La valeur de « --nom valeur », ou null (jamais une autre option). */
export function optionValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value !== undefined && !value.startsWith("--") ? value : null;
}

// ---- tryon:flag ----

export type FlagRequest = { action: "show" } | { action: "off" } | { action: "on" } | { refused: string };

/** Ce que demande la ligne de commande de tryon:flag, ou pourquoi c'est refusé.
 * Éteindre est toujours permis ; allumer demande --confirm, et --production
 * en plus si la base visée n'est pas spotto-dev-2. */
export function flagRequest(args: readonly string[], project: TargetProject): FlagRequest {
  const on = hasFlag(args, "--on");
  const off = hasFlag(args, "--off");
  if (on && off) return { refused: "Choisissez --on ou --off, pas les deux." };
  if (off) return { action: "off" };
  if (!on) return { action: "show" };
  if (!hasFlag(args, "--confirm")) {
    return {
      refused:
        "Refusé : allumer l'essayage virtuel l'ouvre aux membres (photos envoyées à FASHN, essais payants). " +
        "À faire seulement après l'accord de l'avocat. Relancez avec --on --confirm pour confirmer.",
    };
  }
  if (!project.isDev && !hasFlag(args, "--production")) {
    return {
      refused: `Refusé : la base visée n'est pas ${DEV_PROJECT_NAME} (${project.name}). Pour l'allumer quand même, ajoutez --production en plus de --on --confirm.`,
    };
  }
  return { action: "on" };
}

// ---- tryon:report ----

export interface MonthReport {
  month: string;
  budgetUsd: number;
  pricePerCreditUsd: number;
  alertThreshold: number;
  /** Crédits consommés dans le mois (compteur sans membre). */
  creditsUsed: number;
  succeeded: number;
  failed: number;
  pending: number;
  failuresByCode: Readonly<Record<string, number>>;
  reportsByReason: Readonly<Record<string, number>>;
  alerts: readonly string[];
  /** Solde de crédits FASHN, ou la raison pour laquelle il n'est pas lu. */
  providerBalance: number | string;
}

const AMOUNT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const PRICE = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
const PERCENT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
const usd = (value: number) => `${AMOUNT.format(value)} $`;
const percent = (share: number) => `${PERCENT.format(share * 100)} %`;

/** Le rapport du mois, en lignes de texte (aucune donnée personnelle). */
export function formatMonthReport(report: MonthReport): string[] {
  const micro = (value: number) => Math.round(value * 1_000_000);
  const spent = (report.creditsUsed * micro(report.pricePerCreditUsd)) / 1_000_000;
  const remaining = Math.max(micro(report.budgetUsd) - micro(spent), 0) / 1_000_000;
  const tries = report.succeeded + report.failed;
  const lines = [
    `Mois : ${report.month} (heure de Paris)`,
    `Dépense du mois : ${usd(spent)} sur ${usd(report.budgetUsd)} (${percent(report.budgetUsd > 0 ? spent / report.budgetUsd : 1)} ; alerte à ${percent(report.alertThreshold)})`,
    `Budget restant : ${usd(remaining)} (${report.creditsUsed} crédits consommés à ${PRICE.format(report.pricePerCreditUsd)} $ le crédit)`,
    `Essais réussis : ${report.succeeded} ; échoués : ${report.failed} ; en cours : ${report.pending}`,
    `Taux d'échec : ${tries > 0 ? percent(report.failed / tries) : "aucun essai"}`,
  ];
  const codes = Object.entries(report.failuresByCode).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  if (codes.length > 0) {
    lines.push("Échecs par code (part des essais du mois) :");
    for (const [code, count] of codes) lines.push(`  - ${code} : ${count} (${percent(count / tries)})`);
  }
  const reasons = Object.entries(report.reportsByReason).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  lines.push(reasons.length > 0 ? `Signalements du mois : ${reasons.map(([reason, count]) => `${reason} ${count}`).join(", ")}` : "Signalements du mois : aucun");
  lines.push(report.alerts.length > 0 ? `Alertes du mois : ${report.alerts.join(", ")}` : "Alertes du mois : aucune");
  lines.push(typeof report.providerBalance === "number" ? `Solde FASHN : ${report.providerBalance} crédits` : `Solde FASHN : ${report.providerBalance}`);
  return lines;
}

// ---- tryon:smoke ----

/** Option qui confirme qu'on accepte de payer un vrai essai (1 crédit). */
export const COSTS_MONEY_FLAG = "--i-understand-this-costs-money";

export type SmokeRequest = { photo: string; garment: string; locale: "fr" | "en" } | { refused: string };

/** Les fichiers de l'essai réel, ou pourquoi il est refusé : clé FASHN,
 * --photo, --garment et --i-understand-this-costs-money obligatoires. */
export function smokeRequest(args: readonly string[], hasApiKey: boolean): SmokeRequest {
  if (!hasFlag(args, COSTS_MONEY_FLAG)) {
    return { refused: `Refusé : ce script appelle FASHN pour de vrai (1 crédit, soit 0,075 $). Ajoutez ${COSTS_MONEY_FLAG} pour confirmer.` };
  }
  if (!hasApiKey) return { refused: "Refusé : FASHN_API_KEY manque dans apps/backend/.env." };
  const photo = optionValue(args, "--photo");
  const garment = optionValue(args, "--garment");
  if (!photo || !garment) return { refused: "Refusé : indiquez --photo <chemin de votre photo> et --garment <chemin de l'image de la pièce>." };
  return { photo, garment, locale: optionValue(args, "--lang") === "en" ? "en" : "fr" };
}

/** Vrai si `path` est dans le dossier `directory` (ou est ce dossier). */
export function isInsideDirectory(path: string, directory: string): boolean {
  const fromDirectory = relative(resolve(directory), resolve(path));
  return fromDirectory === "" || (!fromDirectory.startsWith("..") && !isAbsolute(fromDirectory));
}
