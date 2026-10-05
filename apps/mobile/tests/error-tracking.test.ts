import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { init, captureException, setUser } = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), setUser: vi.fn() }));
vi.mock("@sentry/react-native", () => ({ init, captureException, setUser }));

const DSN_UE = "https://0123abcd@o4500000000000000.ingest.de.sentry.io/4500000000000001";

// Module rechargé à chaque test : il garde en mémoire son activation.
async function chargerSuivi(dsn: string) {
  vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", dsn);
  vi.resetModules();
  const suivi = await import("../src/lib/error-tracking");
  suivi.initErrorTracking();
  return suivi;
}

describe("suivi des erreurs de l'app iPhone (lot 3bis)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("sans adresse Sentry de la région UE : rien n'est activé ni envoyé", async () => {
    const suivi = await chargerSuivi("https://0123abcd@o4500000000000000.ingest.us.sentry.io/4500000000000001");
    suivi.reportUnexpectedError(new Error("essai"), "spot_analysis");
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("mêmes protections que le site, plus les traces automatiques de la partie native coupées", async () => {
    await chargerSuivi(DSN_UE);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]![0]).toMatchObject({
      dsn: DSN_UE,
      sendDefaultPii: false,
      enableAutoSessionTracking: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoBreadcrumbTracking: false,
      enableNetworkBreadcrumbs: false,
    });
  });

  it("un échec imprévu rattrapé par un écran est signalé, avec le parcours concerné", async () => {
    const suivi = await chargerSuivi(DSN_UE);
    // Cas réel du lot 3bis : photo refusée à l'envoi, avant tout appel au serveur.
    const erreur = new TypeError("Unsupported FormDataPart implementation");
    suivi.reportUnexpectedError(erreur, "spot_analysis");
    expect(captureException).toHaveBeenCalledWith(erreur, { tags: { where: "spot_analysis" } });
  });
});
