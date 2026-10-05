// Suivi des erreurs du site : Sentry chargé à part, après le démarrage
// (voir sentry-web.ts). Version iPhone : error-tracking.ts.
export {
  initWebSentry as initErrorTracking,
  setWebSentryUser as setErrorTrackingUser,
  reportWebError as reportUnexpectedError,
} from "./sentry-web";
