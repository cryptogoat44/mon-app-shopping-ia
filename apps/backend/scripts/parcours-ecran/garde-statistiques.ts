// Garde-fou « statistiques » des parcours à l'écran (lot 4 ter, demande du
// fondateur après l'incident du 2026-10-07 : un `page.unrouteAll` avait retiré
// l'interception de PostHog, et trois parcours ont envoyé des requêtes, avec
// une clé factice, au vrai PostHog).
//
// Toute requête du navigateur vers un hôte de statistiques ou de suivi des
// erreurs (PostHog, Sentry) que le scénario n'a pas interceptée lui-même est
// BLOQUÉE — elle ne part pas — et notée ; le parcours échoue alors franchement
// (à l'étape suivante, et à la fin). Deux mécanismes indépendants :
// 1. une route posée sur le CONTEXTE du navigateur : les routes d'une page
//    (celles des scénarios, qui répondent à la place de PostHog) passent avant
//    celles du contexte (règle de Playwright) ; la garde ne voit donc que ce
//    qui serait réellement sorti ;
// 2. un contrôle de chaque réponse : si une réponse d'un hôte de statistiques
//    vient d'un vrai serveur (adresse connue), la requête est partie — même si
//    la route avait été retirée.
// Seule exception : les hôtes qu'un scénario envoie VOLONTAIREMENT
// (`sentry-site`, région UE de Sentry).
import type { BrowserContext, Request } from "playwright-core";

/** Hôtes de statistiques et de suivi des erreurs (le domaine et ses sous-domaines). */
export const HOTES_STATISTIQUES = ["posthog.com", "sentry.io"] as const;

function hoteDe(adresse: string): string | null {
  try {
    return new URL(adresse).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function dansDomaine(hote: string, domaine: string): boolean {
  return hote === domaine || hote.endsWith(`.${domaine}`);
}

export function versStatistiques(adresse: string): boolean {
  const hote = hoteDe(adresse);
  return hote !== null && HOTES_STATISTIQUES.some((domaine) => dansDomaine(hote, domaine));
}

export interface Fuite {
  /** « bloquee » : arrêtée avant de partir ; « partie » : une réponse est venue d'un vrai serveur. */
  issue: "bloquee" | "partie";
  methode: string;
  hote: string;
  chemin: string;
}

export class GardeStatistiques {
  readonly fuites: Fuite[] = [];

  /** `autorises` : hôtes envoyés volontairement par le scénario (ex. « ingest.de.sentry.io »). */
  constructor(private readonly autorises: readonly string[] = []) {}

  private autorise(adresse: string): boolean {
    const hote = hoteDe(adresse);
    return hote !== null && this.autorises.some((domaine) => dansDomaine(hote, domaine));
  }

  private noter(issue: Fuite["issue"], requete: Request): void {
    const adresse = new URL(requete.url());
    this.fuites.push({ issue, methode: requete.method(), hote: adresse.hostname, chemin: adresse.pathname });
  }

  /** À poser sur chaque contexte du navigateur, avant d'y ouvrir une page. */
  async proteger(contexte: BrowserContext): Promise<void> {
    await contexte.route(
      (url) => versStatistiques(url.href),
      async (route) => {
        if (this.autorise(route.request().url())) return route.fallback();
        this.noter("bloquee", route.request());
        await route.abort("blockedbyclient");
      }
    );
    contexte.on("requestfinished", (requete) => void this.controlerReponse(requete));
  }

  private async controlerReponse(requete: Request): Promise<void> {
    if (!versStatistiques(requete.url()) || this.autorise(requete.url())) return;
    const reponse = await requete.response().catch(() => null);
    // Réponse fabriquée par le scénario (route.fulfill) : aucune adresse de serveur.
    const serveur = reponse ? await reponse.serverAddr().catch(() => null) : null;
    if (serveur) this.noter("partie", requete);
  }

  /** Échoue franchement à la moindre requête vers un hôte de statistiques non interceptée. */
  verifier(): void {
    if (this.fuites.length === 0) return;
    const detail = this.fuites.map((f) => `${f.methode} ${f.hote}${f.chemin} (${f.issue === "bloquee" ? "bloquée" : "PARTIE"})`).join(" ; ");
    throw new Error(
      `Garde-fou statistiques : ${this.fuites.length} requête(s) vers PostHog ou Sentry non interceptée(s) par le scénario — ${detail}. Parcours en échec.`
    );
  }
}

/** Le code compilé ne contient pas l'adresse Sentry du projet (`dsn`, lue
 * dans apps/mobile/.env, jamais affichée) : il n'enverrait rien pendant les
 * parcours. On cherche CETTE adresse : la bibliothèque Sentry contient
 * elle-même des adresses de diagnostic qui ne sont pas celles du projet. */
export function codeSansSentry(code: string, dsn: string | undefined): boolean {
  const adresse = dsn?.trim();
  return !adresse || !code.includes(adresse);
}
