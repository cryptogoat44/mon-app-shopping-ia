// Première réponse du serveur à chaque ouverture (lot « mesure du parcours ») :
// combien de membres tombent sur le serveur endormi (offre gratuite de
// Render : jusqu'à une minute d'attente au réveil). Une ouverture est celle
// que compte « app_opened » (app-opening.ts) :
// - au lancement, la première requête depuis le démarrage de l'app — souvent
//   partie avant que l'accord aux statistiques soit lu : sa durée attend en
//   mémoire, et ne part qu'une fois « app_opened » compté, par track (même
//   accord que tout le reste) ;
// - au retour dans l'app, la première partie après « app_opened ».
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
  sent: boolean;
}

export interface FirstResponseMeter {
  /** Une requête part ; la fonction rendue est appelée une fois, à son issue. */
  requestStarted(): (outcome: RequestOutcome) => void;
  /** Ouverture comptée par app_opened. */
  openingCounted(context: OpeningContext): void;
}

export function createFirstResponseMeter(now: () => number, send: (event: FirstResponse) => void): FirstResponseMeter {
  // Au lancement : toutes les requêtes depuis le démarrage de l'app.
  let opening: Opening = { context: "launch", counted: false, first: null, sent: false };

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

/** Tests uniquement : comme au démarrage de l'app. */
export function __resetServerFirstResponse(): void {
  meter = appMeter();
}
