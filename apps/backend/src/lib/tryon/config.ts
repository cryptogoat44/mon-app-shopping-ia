// Réglages de l'essayage virtuel photo (lot « essayage virtuel »), lus et
// vérifiés une seule fois, au démarrage. La fonction est ÉTEINTE par défaut
// et le reste au moindre doute : interrupteur absent ou différent de "true",
// fournisseur inconnu, clé FASHN absente, adresse qui n'est pas en https,
// nombre illisible ou hors des bornes, fuseau inconnu, faux fournisseur en
// production. Un réglage invalide n'arrête jamais le serveur : l'essayage
// reste éteint et le journal dit quelle variable corriger, avec une raison
// fixe, jamais sa valeur (la clé n'y apparaît jamais).
// Interrupteur coupé : la clé FASHN n'est même pas lue (aucun accès à
// FASHN_API_KEY), comme le demande la mission.
// Le second interrupteur (drapeau feature_flags.tryon de la base) est lu par
// lib/tryon/featureFlag.ts : les deux doivent être allumés.
import { z } from "zod";
import type { env } from "../../env.js";

/** Fournisseurs connus. En ajouter un : un fichier dans providers/, une
 * ligne dans providers/index.ts, puis TRYON_PROVIDER chez Render. */
export const TRYON_PROVIDER_NAMES = ["fake", "fashn"] as const;
export type TryonProviderName = (typeof TRYON_PROVIDER_NAMES)[number];

export const DEFAULT_FASHN_API_BASE_URL = "https://api.fashn.ai/v1";

/** Version du texte de consentement en vigueur : la changer fait redemander
 * le consentement à tous les membres. */
export const TRYON_CONSENT_VERSION = "2026-11-v1";

export interface TryonConfig {
  provider: TryonProviderName;
  /** Clé secrète de FASHN (fournisseur « fashn » seulement) ; jamais journalisée. */
  apiKey: string | null;
  apiBaseUrl: string;
  freePerMonth: number;
  bonusPerPurchase: number;
  bonusValidityDays: number;
  requireBuyLink: boolean;
  monthlyBudgetUsd: number;
  alertThreshold: number;
  pricePerCreditUsd: number;
  minProviderCredits: number;
  timeZone: string;
}

/** Éteint (interrupteur coupé), invalide (variables à corriger : nom et
 * raison fixe, jamais la valeur) ou prêt. */
export type TryonConfigState = { state: "off" } | { state: "invalid"; problems: string[] } | { state: "ready"; config: TryonConfig };

/** Les variables lues (celles de src/env.ts). */
export type TryonEnvSource = Pick<
  typeof env,
  | "TRYON_ENABLED"
  | "TRYON_PROVIDER"
  | "FASHN_API_KEY"
  | "FASHN_API_BASE_URL"
  | "TRYON_FREE_PER_MONTH"
  | "TRYON_BONUS_PER_PURCHASE"
  | "TRYON_BONUS_VALIDITY_DAYS"
  | "TRYON_REQUIRE_BUY_LINK"
  | "TRYON_MONTHLY_BUDGET_USD"
  | "TRYON_ALERT_THRESHOLD"
  | "TRYON_PRICE_PER_CREDIT_USD"
  | "TRYON_MIN_FASHN_CREDITS"
  | "TRYON_TIMEZONE"
>;

// Nombres écrits simplement (« 5 », « 0.075 ») : ni exposant, ni
// hexadécimal, ni signe. Une virgule décimale est refusée (« 0,8 ») plutôt
// que mal lue.
const INTEGER = /^(?:0|[1-9]\d{0,8})$/;
const DECIMAL = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
// Même forme que celle acceptée par les fonctions de la base (0042).
const TIME_ZONE_NAME = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
// Une clé d'API : caractères visibles seulement (elle part dans un en-tête HTTP).
const API_KEY = /^[\x21-\x7e]{8,512}$/;

interface NumberRule {
  integer: boolean;
  min: number;
  max: number;
  fallback: number;
}

const NUMBER_RULES = {
  TRYON_FREE_PER_MONTH: { integer: true, min: 0, max: 100, fallback: 5 },
  TRYON_BONUS_PER_PURCHASE: { integer: true, min: 1, max: 100, fallback: 5 },
  TRYON_BONUS_VALIDITY_DAYS: { integer: true, min: 1, max: 3650, fallback: 365 },
  TRYON_MONTHLY_BUDGET_USD: { integer: false, min: 0.01, max: 100_000, fallback: 100 },
  TRYON_ALERT_THRESHOLD: { integer: false, min: 0.01, max: 1, fallback: 0.8 },
  TRYON_PRICE_PER_CREDIT_USD: { integer: false, min: 0.001, max: 10, fallback: 0.075 },
  TRYON_MIN_FASHN_CREDITS: { integer: true, min: 0, max: 1_000_000, fallback: 20 },
} as const satisfies Record<string, NumberRule>;

type NumberSetting = keyof typeof NUMBER_RULES;

/** Une valeur absente ou vide : celle par défaut ; sinon elle doit être lisible et dans ses bornes. */
function readNumber(name: NumberSetting, raw: string | undefined, problems: string[]): number {
  const rule: NumberRule = NUMBER_RULES[name];
  const text = raw?.trim();
  if (!text) return rule.fallback;
  const parsed = z
    .string()
    .regex(rule.integer ? INTEGER : DECIMAL)
    .transform(Number)
    .pipe(z.number().min(rule.min).max(rule.max))
    .safeParse(text);
  if (parsed.success) return parsed.data;
  problems.push(`${name} : nombre illisible ou hors des bornes (${rule.min} à ${rule.max})`);
  return rule.fallback;
}

function readProvider(raw: string | undefined, problems: string[]): TryonProviderName {
  const text = raw?.trim() || "fake";
  const parsed = z.enum(TRYON_PROVIDER_NAMES).safeParse(text);
  if (parsed.success) return parsed.data;
  problems.push("TRYON_PROVIDER : fournisseur inconnu (fake ou fashn)");
  return "fake";
}

function readBuyLinkRule(raw: string | undefined, problems: string[]): boolean {
  const text = raw?.trim();
  if (!text) return true;
  const parsed = z.enum(["true", "false"]).safeParse(text);
  if (parsed.success) return parsed.data === "true";
  problems.push("TRYON_REQUIRE_BUY_LINK : true ou false attendu");
  return true;
}

/** L'adresse de l'API, sans « / » final : https, sans identifiants, ni paramètres. */
function readBaseUrl(raw: string | undefined, problems: string[]): string {
  const text = raw?.trim() || DEFAULT_FASHN_API_BASE_URL;
  const parsed = z.url({ protocol: /^https$/ }).safeParse(text);
  if (parsed.success) {
    const url = new URL(parsed.data);
    if (!url.username && !url.password && !url.search && !url.hash) return url.toString().replace(/\/+$/, "");
  }
  problems.push("FASHN_API_BASE_URL : adresse https attendue, sans identifiants ni paramètres");
  return DEFAULT_FASHN_API_BASE_URL;
}

/** Vrai pour un fuseau horaire connu (nom IANA, comme « Europe/Paris »). */
export function isKnownTimeZone(name: string): boolean {
  if (!TIME_ZONE_NAME.test(name)) return false;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function readTimeZone(raw: string | undefined, problems: string[]): string {
  const text = raw?.trim() || "Europe/Paris";
  if (isKnownTimeZone(text)) return text;
  problems.push("TRYON_TIMEZONE : fuseau horaire inconnu (nom IANA attendu, par exemple Europe/Paris)");
  return "Europe/Paris";
}

/** La clé FASHN, lue SEULEMENT ici, et seulement pour le fournisseur « fashn ». */
function readApiKey(source: TryonEnvSource, problems: string[]): string | null {
  const key = source.FASHN_API_KEY;
  if (!key) {
    problems.push("FASHN_API_KEY : absente (obligatoire avec TRYON_PROVIDER=fashn)");
    return null;
  }
  if (!API_KEY.test(key)) {
    problems.push("FASHN_API_KEY : forme invalide");
    return null;
  }
  return key;
}

/** Les réglages sans la clé ni l'interrupteur. */
export type TryonSettings = Omit<TryonConfig, "apiKey">;

/** Les réglages de l'essayage, hors interrupteur et hors clé (jamais lue
 * ici) : les scripts du fondateur s'en servent même essayage éteint
 * (rapport du mois, essais offerts). Chaque valeur invalide ajoute une
 * raison à `problems` et prend sa valeur par défaut. */
export function readTryonSettings(source: TryonEnvSource, problems: string[]): TryonSettings {
  return {
    provider: readProvider(source.TRYON_PROVIDER, problems),
    apiBaseUrl: readBaseUrl(source.FASHN_API_BASE_URL, problems),
    freePerMonth: readNumber("TRYON_FREE_PER_MONTH", source.TRYON_FREE_PER_MONTH, problems),
    bonusPerPurchase: readNumber("TRYON_BONUS_PER_PURCHASE", source.TRYON_BONUS_PER_PURCHASE, problems),
    bonusValidityDays: readNumber("TRYON_BONUS_VALIDITY_DAYS", source.TRYON_BONUS_VALIDITY_DAYS, problems),
    requireBuyLink: readBuyLinkRule(source.TRYON_REQUIRE_BUY_LINK, problems),
    monthlyBudgetUsd: readNumber("TRYON_MONTHLY_BUDGET_USD", source.TRYON_MONTHLY_BUDGET_USD, problems),
    alertThreshold: readNumber("TRYON_ALERT_THRESHOLD", source.TRYON_ALERT_THRESHOLD, problems),
    pricePerCreditUsd: readNumber("TRYON_PRICE_PER_CREDIT_USD", source.TRYON_PRICE_PER_CREDIT_USD, problems),
    minProviderCredits: readNumber("TRYON_MIN_FASHN_CREDITS", source.TRYON_MIN_FASHN_CREDITS, problems),
    timeZone: readTimeZone(source.TRYON_TIMEZONE, problems),
  };
}

/** Le serveur de production ? NODE_ENV=production, ou SENTRY_ENVIRONMENT=
 * production (réglage exigé chez Render, voir .env.example) : dans le doute,
 * production. */
export function isProductionServer(nodeEnv: string | undefined, sentryEnvironment: string | undefined): boolean {
  return nodeEnv === "production" || sentryEnvironment === "production";
}

/** Réglages de l'essayage, vérifiés. `production` : le faux fournisseur y
 * est refusé (isProductionServer). */
export function readTryonConfig(source: TryonEnvSource, production: boolean): TryonConfigState {
  if (source.TRYON_ENABLED !== true) return { state: "off" };
  const problems: string[] = [];
  const settings = readTryonSettings(source, problems);
  if (settings.provider === "fake" && production) {
    problems.push("TRYON_PROVIDER : le faux fournisseur est refusé en production");
  }
  const apiKey = settings.provider === "fashn" ? readApiKey(source, problems) : null;
  const config: TryonConfig = { ...settings, apiKey };
  return problems.length > 0 ? { state: "invalid", problems } : { state: "ready", config };
}

interface WarnLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Une ligne de journal, une seule fois au démarrage, si les réglages sont
 * invalides : les variables à corriger, jamais leur valeur. */
export function logTryonConfigState(state: TryonConfigState, log: WarnLog): void {
  if (state.state === "invalid") log.warn({ problems: state.problems }, "Essayage virtuel éteint : réglages invalides");
}
