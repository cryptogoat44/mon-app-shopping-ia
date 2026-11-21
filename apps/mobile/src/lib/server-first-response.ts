// Première réponse du serveur à chaque ouverture (lot « mesure du parcours ») :
// combien de membres tombent sur le serveur endormi (offre gratuite de
// Render : jusqu'à une minute d'attente au réveil). Une ouverture est celle
// que compte « app_opened » (app-opening.ts) :
// - au lancement, la première requête depuis le démarrage de l'app — souvent
//   partie avant que l'accord aux statistiques soit lu : sa durée attend en
//   mémoire, et ne part qu'une fois « app_opened » compté, par track (même
//   accord que tout le reste) ;
// - au retour dans l'app, la première partie après « app_opened ».
// Jamais la durée d'un compte sous un autre, ni celle d'un compte sans
// accord : déconnexion ou changement de compte (components/analytics-session.tsx)
// oublient ce qui attend, requêtes encore en route comprises ; un lancement
// refusé faute d'accord (app-opening.ts) ne fera jamais partir sa mesure,
// même si l'accord arrive ensuite.
// Mesurée dans authorizedFetch (api.ts), point commun des requêtes au
// serveur, du départ de la requête à sa réponse ou à son échec (réseau). Une
// requête abandonnée (« Annuler », écran quitté, essai trop long relancé) ne
// compte pas : la première suivante qui aboutit ou échoue la remplace. Une
// seule mesure par ouverture : la durée, l'ouverture et un oui/non, rien
// d'autre. Horloge injectable (tests). Imports relatifs : vitest.
import { track } from "./analytics";
import { waitNow } from "./wait-clock";

export type OpeningContext = "launch" | "resume";
/** Issue d'une requête : réponse 2xx, échec (réseau, réponse en erreur) ou abandon. */
export type RequestOutcome = "ok" | "failed" | "cancelled";

export interface FirstResponse {
  wait_ms: number;
  context: OpeningContext;
  ok: boolean;
}

interface Opening {
  context: OpeningContext;
  /** Comptée par app_opened. */
  counted: boolean;
  first: { waitMs: number; ok: boolean } | null;
  /** Partie, ou à ne jamais envoyer (lancement refusé faute d'accord). */
  sent: boolean;
}

export interface FirstResponseMeter {
  /** Une requête part ; la fonction rendue est appelée une fois, à son issue. */
  requestStarted(): (outcome: RequestOutcome) => void;
  /** Ouverture comptée par app_opened. */
  openingCounted(context: OpeningContext): void;
  /** Lancement refusé faute d'accord (ou de clé) : sa mesure ne partira jamais. */
  launchRefused(): void;
  /** Déconnexion ou autre compte : ce qui attend est oublié, requêtes en route comprises. */
  forget(): void;
}

/** Le lancement : toutes les requêtes depuis le démarrage de l'app, ou depuis le dernier changement de compte. */
const launchOpening = (): Opening => ({ context: "launch", counted: false, first: null, sent: false });

export function createFirstResponseMeter(now: () => number, send: (event: FirstResponse) => void): FirstResponseMeter {
  let opening: Opening = launchOpening();

  function flush(): void {
    if (!opening.counted || !opening.first || opening.sent) return;
    opening.sent = true;
    send({ wait_ms: opening.first.waitMs, context: opening.context, ok: opening.first.ok });
  }

  return {
    requestStarted() {
      const startedAt = now();
      const during = opening;
      return (outcome) => {
        // Partie avant cette ouverture, ouverture déjà mesurée, ou requête abandonnée : rien.
        if (opening !== during || during.first || outcome === "cancelled") return;
        during.first = { waitMs: now() - startedAt, ok: outcome === "ok" };
        flush();
      };
    },
    openingCounted(context) {
      if (context === "resume") opening = { context, counted: true, first: null, sent: false };
      // Le lancement ne se compte qu'une fois, avant tout retour (app-opening.ts).
      else if (opening.context === "launch") opening.counted = true;
      flush();
    },
    launchRefused() {
      // Compte sans accord : ni la durée déjà mesurée, ni une suivante, même compté plus tard.
      if (opening.context === "launch" && !opening.counted) opening.sent = true;
    },
    forget() {
      // Les requêtes parties avant restent liées à l'ancienne ouverture : ignorées (opening !== during).
      opening = launchOpening();
    },
  };
}

const appMeter = () => createFirstResponseMeter(waitNow, (event) => track("server_first_response", { ...event }));
let meter = appMeter();

/** authorizedFetch : une requête part vers le serveur. */
export function serverRequestStarted(): (outcome: RequestOutcome) => void {
  return meter.requestStarted();
}

/** app-opening.ts : une ouverture vient d'être comptée par app_opened. */
export function serverOpeningCounted(context: OpeningContext): void {
  meter.openingCounted(context);
}

/** app-opening.ts : lancement refusé, statistiques inactives (pas d'accord, ou pas de clé). */
export function serverLaunchRefused(): void {
  meter.launchRefused();
}

/** components/analytics-session.tsx : compte déconnecté ou changé. */
export function forgetServerFirstResponse(): void {
  meter.forget();
}

/** Tests uniquement : comme au démarrage de l'app. */
export function __resetServerFirstResponse(): void {
  meter = appMeter();
}
