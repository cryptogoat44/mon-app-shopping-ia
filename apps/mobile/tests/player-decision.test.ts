import { describe, expect, it } from "vitest";
import { afterPlayerFailure, decidePlayer, openingPath, playerOffered, playerPossible, type PlayerDecisionInput } from "../src/lib/player-decision";

// Mission « liens vidéo » : lecteur officiel ou écran de secours ? Option du
// build × interrupteur du serveur × module de l'instantané × accord ×
// plateforme. Le serveur ne peut que couper : jamais allumer un lecteur
// absent du build.
const ON = { tiktok: true, instagram: true };
const base: PlayerDecisionInput = {
  platform: "tiktok",
  os: "ios",
  build: { tiktokPlayer: true, instagramPlayer: true },
  server: ON,
  snapshotReady: true,
  consent: true,
};
const decide = (patch: Partial<PlayerDecisionInput>) => decidePlayer({ ...base, ...patch });

describe("lecteur ou écran de secours", () => {
  it("tout est allumé, accord donné : le lecteur", () => {
    expect(decide({})).toEqual({ kind: "player" });
    expect(decide({ platform: "instagram" })).toEqual({ kind: "player" });
  });

  it("accord jamais donné : on le demande ; refusé : écran de secours", () => {
    expect(decide({ consent: false })).toEqual({ kind: "consent" });
    expect(decide({ consent: "refused" })).toEqual({ kind: "fallback", reason: "consent_refused" });
  });

  it("option du build coupée pour cette plateforme : écran de secours, même serveur allumé et accord donné", () => {
    expect(decide({ build: { tiktokPlayer: false, instagramPlayer: true } })).toEqual({ kind: "fallback", reason: "build_off" });
    expect(decide({ build: { tiktokPlayer: false, instagramPlayer: true }, platform: "instagram" })).toEqual({ kind: "player" });
    expect(decide({ build: { tiktokPlayer: true, instagramPlayer: false }, platform: "instagram" })).toEqual({ kind: "fallback", reason: "build_off" });
  });

  it("le serveur ne peut jamais allumer une plateforme absente du build", () => {
    for (const build of [
      { tiktokPlayer: false, instagramPlayer: false },
      { tiktokPlayer: false, instagramPlayer: true },
    ]) {
      for (const consent of [true, false, "refused"] as const) {
        expect(decide({ build, server: ON, consent }).kind).toBe("fallback");
      }
    }
  });

  it("interrupteur du serveur coupé, ou inconnu (réponse perdue) : écran de secours ; l'autre plateforme reste ouverte", () => {
    expect(decide({ server: { tiktok: false, instagram: true } })).toEqual({ kind: "fallback", reason: "server_off" });
    expect(decide({ server: { tiktok: false, instagram: true }, platform: "instagram" })).toEqual({ kind: "player" });
    expect(decide({ server: null })).toEqual({ kind: "fallback", reason: "server_unknown" });
  });

  it("module de l'instantané absent de l'app installée : écran de secours (« Spotter ce moment » ne marcherait pas)", () => {
    expect(decide({ snapshotReady: false })).toEqual({ kind: "fallback", reason: "no_snapshot" });
  });

  it("site : jamais de lecteur ; Android : écran de secours", () => {
    expect(decide({ os: "web" })).toEqual({ kind: "web" });
    expect(decide({ os: "web", build: { tiktokPlayer: false, instagramPlayer: false } })).toEqual({ kind: "web" });
    expect(decide({ os: "android" })).toEqual({ kind: "fallback", reason: "not_ios" });
  });

  it("toutes les combinaisons : le lecteur seulement si build ET serveur ET module ET accord, sur iPhone", () => {
    for (const platform of ["tiktok", "instagram"] as const) {
      for (const buildOn of [true, false]) {
        for (const serverOn of [true, false, null]) {
          for (const snapshotReady of [true, false]) {
            for (const consent of [true, false, "refused"] as const) {
              const build = { tiktokPlayer: platform === "tiktok" ? buildOn : true, instagramPlayer: platform === "instagram" ? buildOn : true };
              const server = serverOn === null ? null : { ...ON, [platform]: serverOn };
              const decision = decide({ platform, build, server, snapshotReady, consent });
              const expected = buildOn && serverOn === true && snapshotReady && consent === true;
              expect(decision.kind === "player", JSON.stringify({ platform, buildOn, serverOn, snapshotReady, consent })).toBe(expected);
            }
          }
        }
      }
    }
  });
});

describe("bouton « Regarder la vidéo dans le lecteur » (lot « vidéo auto »)", () => {
  const { consent: _consent, ...offer } = base;
  it("proposé seulement si le lecteur peut s'ouvrir ; l'accord est demandé au toucher", () => {
    expect(playerOffered(offer)).toBe(true);
    expect(playerOffered({ ...offer, platform: "instagram" })).toBe(true);
  });

  it("interrupteur du serveur coupé, serveur inconnu, module de l'instantané absent, build coupé, site : pas de bouton", () => {
    expect(playerOffered({ ...offer, server: { tiktok: false, instagram: true } })).toBe(false);
    expect(playerOffered({ ...offer, server: null })).toBe(false);
    expect(playerOffered({ ...offer, snapshotReady: false })).toBe(false);
    expect(playerOffered({ ...offer, build: { tiktokPlayer: false, instagramPlayer: true } })).toBe(false);
    expect(playerOffered({ ...offer, os: "web" })).toBe(false);
    expect(playerOffered({ ...offer, os: "android" })).toBe(false);
  });
});

describe("lecteur possible dans ce build (sans le serveur ni l'accord)", () => {
  it("app iPhone et option allumée seulement", () => {
    expect(playerPossible("ios", { tiktokPlayer: true, instagramPlayer: false })).toBe(true);
    expect(playerPossible("ios", { tiktokPlayer: true, instagramPlayer: false }, "instagram")).toBe(false);
    expect(playerPossible("ios", { tiktokPlayer: false, instagramPlayer: false })).toBe(false);
    expect(playerPossible("web", { tiktokPlayer: true, instagramPlayer: true })).toBe(false);
  });
});

describe("la vidéo d'abord (retours du build 2) : premier écran d'un lien reconnu", () => {
  it("permis : app iPhone, lecteur possible, analyse allumée → l'accord puis le lecteur", () => {
    expect(openingPath({ os: "ios", offered: true, analysis: true })).toBe("decide");
    expect(openingPath({ os: "ios", offered: true, analysis: false })).toBe("decide");
  });

  it("refusé : jamais le lecteur d'abord sur le site, même si on prétend qu'il est proposé", () => {
    expect(openingPath({ os: "web", offered: true, analysis: true })).toBe("auto");
    expect(openingPath({ os: "web", offered: false, analysis: false })).toBe("decide");
  });

  it("lecteur impossible (coupé par le build ou le serveur) : comme avant, l'analyse si elle est allumée", () => {
    expect(openingPath({ os: "ios", offered: false, analysis: true })).toBe("auto");
    expect(openingPath({ os: "ios", offered: false, analysis: false })).toBe("decide");
  });

  it("interrupteur du serveur coupé (TIKTOK_PLAYER_ENABLED=false) : la recherche automatique revient, sans nouveau build", () => {
    const offered = playerOffered({ platform: "tiktok", os: "ios", build: { tiktokPlayer: true, instagramPlayer: true }, server: { tiktok: false, instagram: true }, snapshotReady: true });
    expect(openingPath({ os: "ios", offered, analysis: true })).toBe("auto");
  });
});

describe("après un lecteur en échec ou refusé (retours du build 2)", () => {
  it("permis : app, analyse allumée → la recherche automatique", () => {
    expect(afterPlayerFailure({ os: "ios", analysis: true })).toBe("ai");
  });

  it("refusé : analyse coupée, ou site → l'écran de secours, comme avant", () => {
    expect(afterPlayerFailure({ os: "ios", analysis: false })).toBe("screenshot");
    expect(afterPlayerFailure({ os: "web", analysis: true })).toBe("screenshot");
  });
});
