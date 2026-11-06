// Alertes du serveur (lot garde-fous, points 6 et 15 de la feuille de route
// V1) : être prévenu quand quelque chose casse, sans lire les journaux à la
// main. Chaque alerte écrit une ligne « Alerte » dans le journal de Render et
// envoie un avertissement à Sentry (si SENTRY_DSN est réglé), avec le tag
// « alerte » : une seule règle dans Sentry prévient le fondateur (e-mail ou
// téléphone). Jamais de compte, d'adresse ni de contenu : le type de
// l'alerte, et des valeurs de listes fermées.
// Les alertes :
// - disjoncteur : la recherche par image est en pause (pannes du fournisseur) ;
// - plafond_recherches : plafond du jour ou du mois atteint, Spotter fermé à tous ;
// - plafond_ia : plafond du jour de l'IA d'Anthropic atteint ;
// - echecs_repetes : 5 échecs ou plus en 15 minutes chez un fournisseur
//   (IA de l'analyse vidéo, IA de la voie C, Google Shopping).
// Les signalements (« signalement », « masquage_auto ») portent le même tag
// mais partent de captureModerationEvent (lib/sentry.ts, chantier 3) : une
// seule alerte par signalement.
// Mémoire : la répétition d'une même alerte est évitée en mémoire ; après un
// redémarrage, une alerte peut être envoyée une seconde fois (sans risque).
import { randomUUID } from "node:crypto";
import { captureAlert } from "./sentry.js";

export type AlertKind = "disjoncteur" | "plafond_recherches" | "plafond_ia" | "echecs_repetes";

export const ALERT_LOG_MESSAGE = "Alerte";

export interface AlertLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface Alert {
  kind: AlertKind;
  /** Texte de l'alerte dans Sentry : jamais de donnée personnelle. */
  message: string;
  /** Valeurs de listes fermées seulement (fournisseur, motif, plafond…). */
  tags?: Record<string, string>;
  /** Même clé : une seule alerte pendant `onceMs` (sinon, chaque appel alerte). */
  onceKey?: string;
  onceMs?: number;
}

type AlertSink = (message: string, tags: Record<string, string>, fingerprint: string[]) => void;

const DAY_MS = 24 * 60 * 60 * 1000;
const sentUntil = new Map<string, number>();

/** Envoie l'alerte ; false si la même clé a déjà alerté pendant sa durée. */
export function raiseAlert(log: AlertLog, alert: Alert, now = Date.now(), send: AlertSink = captureAlert): boolean {
  if (alert.onceKey) {
    const until = sentUntil.get(alert.onceKey);
    if (until !== undefined && until > now) return false;
    sentUntil.set(alert.onceKey, now + (alert.onceMs ?? DAY_MS));
    // Le tableau ne grossit pas sans fin : les clés échues sont oubliées.
    for (const [key, end] of sentUntil) if (end <= now) sentUntil.delete(key);
  }
  const tags = { alerte: alert.kind, ...alert.tags };
  log.warn({ ...tags }, ALERT_LOG_MESSAGE);
  send(alert.message, tags, [alert.kind, alert.onceKey ?? randomUUID()]);
  return true;
}

/** Fournisseurs suivis pour les échecs répétés (Lens a son disjoncteur). */
export type FailureSource = "ia_video" | "ia_voie_c" | "google_shopping";

export const REPEATED_FAILURES = {
  /** 5 échecs… */
  count: 5,
  /** … en 15 minutes… */
  windowMs: 15 * 60 * 1000,
  /** … au plus une alerte par heure et par fournisseur. */
  alertEveryMs: 60 * 60 * 1000,
} as const;

const failuresBySource = new Map<FailureSource, number[]>();

/** Note un échec chez un fournisseur ; alerte au 5e en 15 minutes (une fois par heure au plus). */
export function noteFailure(log: AlertLog, source: FailureSource, now = Date.now(), send: AlertSink = captureAlert): boolean {
  const recent = (failuresBySource.get(source) ?? []).filter((at) => now - at < REPEATED_FAILURES.windowMs);
  recent.push(now);
  failuresBySource.set(source, recent);
  if (recent.length < REPEATED_FAILURES.count) return false;
  const hour = Math.floor(now / REPEATED_FAILURES.alertEveryMs);
  return raiseAlert(
    log,
    {
      kind: "echecs_repetes",
      message: `Échecs répétés : ${FAILURE_LABELS[source]} (${recent.length} en 15 minutes)`,
      tags: { source },
      onceKey: `echecs_repetes:${source}:${hour}`,
      onceMs: REPEATED_FAILURES.alertEveryMs,
    },
    now,
    send
  );
}

const FAILURE_LABELS: Record<FailureSource, string> = {
  ia_video: "analyse automatique des vidéos (IA d'Anthropic)",
  ia_voie_c: "requête des boutiques écrite par l'IA (voie C)",
  google_shopping: "Google Shopping (voie C)",
};

/** Tests seulement : oublie les alertes déjà envoyées et les échecs notés. */
export function resetAlertsForTests(): void {
  sentUntil.clear();
  failuresBySource.clear();
}
