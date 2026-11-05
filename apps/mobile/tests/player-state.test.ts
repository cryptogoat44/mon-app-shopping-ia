import { describe, expect, it } from "vitest";
import type { FrameSample } from "../src/lib/frame-sample";
import {
  CAPTURE_MEMORY_MAX_AGE_MS,
  captureErrorKind,
  captureFailure,
  captureOrder,
  captureOutcome,
  checkForbidsPlayer,
  embedHeight,
  isBlankFrame,
  isPlaybackSignal,
  noAnswerReason,
  parseCaptureMemory,
  parseHostMessage,
  parsePlayerConsent,
  playerCommand,
  playerLayout,
  rememberAttempts,
  reportBlack,
  runCaptureChain,
  seekCommand,
  tiktokErrorAction,
  type AttemptOutcome,
  type CaptureMemory,
  type CaptureMethod,
} from "../src/lib/player-state";

// Lot « lecteur intégré » : messages du lecteur, image noire, choix de la
// méthode de capture, accord préalable, taille du lecteur.
const host = (payload: object) => JSON.stringify({ source: "spotto-player", ...payload });
const NOW = 1_800_000_000_000;

describe("messages de la page hôte (catalogue fermé)", () => {
  it("événements du lecteur TikTok (note R1 §2) et des codes d'intégration", () => {
    expect(parseHostMessage(host({ kind: "tiktok", type: "onPlayerReady", value: null }))).toEqual({ kind: "ready" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: 2 }))).toEqual({ kind: "state", state: "paused" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: -1 }))).toEqual({ kind: "state", state: "init" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onCurrentTime", value: { currentTime: 3.2, duration: 15 } }))).toEqual({ kind: "time", currentTime: 3.2, duration: 15 });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onPlayerError", value: { errorCode: 1001, errorType: "INVALID_VIDEO" } }))).toEqual({ kind: "error", code: 1001 });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onMute", value: true }))).toEqual({ kind: "muted", muted: true });
    expect(parseHostMessage(host({ kind: "embed", type: "embedReady", value: null }))).toEqual({ kind: "embedReady" });
    expect(parseHostMessage(host({ kind: "embed", type: "size", value: 742 }))).toEqual({ kind: "size", height: 742 });
  });

  it("messages étrangers ou abîmés : ignorés ; événement imprévu : journalisé", () => {
    expect(parseHostMessage("pas du JSON")).toBeNull();
    expect(parseHostMessage(JSON.stringify({ kind: "tiktok", type: "onPlayerReady" }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: 9 }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onCurrentTime", value: { currentTime: "3" } }))).toBeNull();
    expect(parseHostMessage(host({ kind: "embed", type: "size", value: -4 }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onImageChange", value: 1, origin: "https://www.tiktok.com" }))).toEqual({
      kind: "other",
      type: "onImageChange",
      origin: "https://www.tiktok.com",
    });
  });

  it("« prêt » seulement sur une lecture constatée ; oEmbed qui refuse : indisponible (contre-expertise n° 14)", () => {
    expect(isPlaybackSignal({ kind: "ready" })).toBe(false);
    expect(isPlaybackSignal({ kind: "state", state: "init" })).toBe(false);
    expect(isPlaybackSignal({ kind: "error", code: 1001 })).toBe(false);
    expect(isPlaybackSignal({ kind: "state", state: "playing" })).toBe(true);
    expect(isPlaybackSignal({ kind: "time", currentTime: 0.2, duration: 9 })).toBe(true);
    expect(checkForbidsPlayer("not_public")).toBe("not_public");
    expect(checkForbidsPlayer("not_a_video")).toBe("not_a_video");
    expect(checkForbidsPlayer("ok")).toBeNull();
    expect(checkForbidsPlayer("no_answer")).toBeNull();
  });

  it("commandes : aucune valeur, sauf seekTo (secondes, jamais négatives)", () => {
    expect(playerCommand("pause")).toBe('{"type":"pause"}');
    expect(seekCommand(12.5)).toBe('{"type":"seekTo","value":12.5}');
    expect(seekCommand(-2)).toBe('{"type":"seekTo","value":0}');
  });

  it("erreurs du lecteur TikTok (note R1 §4) ; repli par le code d'intégration (contre-expertise n° 9)", () => {
    expect(tiktokErrorAction(3002, false)).toBe("tap_to_play");
    expect(tiktokErrorAction(1001, false)).toBe("not_public");
    expect(tiktokErrorAction(2001, false)).toBe("reload");
    expect(tiktokErrorAction(3001, true, false)).toBe("fallback");
    expect(tiktokErrorAction(2001, true)).toBe("no_answer");
    expect(tiktokErrorAction(3001, true)).toBe("player_error");
    expect(noAnswerReason("not_public")).toBe("not_public");
    expect(noAnswerReason("ok")).toBe("player_error");
    expect(noAnswerReason("skipped")).toBe("no_answer");
  });
});

describe("image noire ou blanche (contre-expertise n° 3)", () => {
  const W = 96;
  const H = 171;
  const frame = (pixel: (x: number, y: number) => number): FrameSample => {
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) gray[y * W + x] = pixel(x, y);
    return { gray, width: W, height: H, colors: [] };
  };

  it("vidéo noire sous les boutons blancs du lecteur TikTok (en-tête, colonne, bouton lecture) : image vide", () => {
    const chrome = frame((x, y) => (y < 20 || x > 80 || (Math.abs(x - 48) < 8 && Math.abs(y - 85) < 8) ? 255 : 0));
    expect(isBlankFrame(chrome)).toBe(true);
  });

  it("noir bruité (≤ 24/255) et rectangle blanc (WebKit 161450) : images vides", () => {
    expect(isBlankFrame(frame((x, y) => (x + y) % 20))).toBe(true);
    expect(isBlankFrame(frame(() => 250))).toBe(true);
  });

  it("vraie image, même sombre : gardée", () => {
    expect(isBlankFrame(frame((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 200 : 60)))).toBe(false);
    expect(isBlankFrame(frame((x, y) => ((x * 13 + y * 7) % 50) + 10))).toBe(false);
  });

  it("mur uni bien éclairé, sans bruit : gardé (l'ancienne règle « unie » le jetait)", () => {
    expect(isBlankFrame(frame(() => 182))).toBe(false);
    expect(isBlankFrame(frame((x) => 175 + (x % 2)))).toBe(false);
  });

  it("fond de studio noir, personne au centre-droit : gardé", () => {
    expect(isBlankFrame(frame((x, y) => (x > 50 && x < 74 && y > 30 && y < 150 ? 140 : 12)))).toBe(false);
  });
});

describe("méthodes de capture : ordre, chaîne, mémoire", () => {
  const picture = { uri: "file:///cache/a.jpg", width: 1029, height: 1830 };
  const memory = (partial: Partial<CaptureMemory>): CaptureMemory => ({ os: "26.1", savedAt: NOW, winner: null, failed: [], reports: {}, ...partial });

  function scripted(outcomes: Partial<Record<CaptureMethod, AttemptOutcome[]>>) {
    const calls: string[] = [];
    const attempt = async (method: CaptureMethod, tryIndex: number): Promise<AttemptOutcome> => {
      calls.push(`${method}:${tryIndex}`);
      return outcomes[method]?.shift() ?? { kind: "blank" };
    };
    return { calls, attempt };
  }

  it("pdf vide deux fois, photo directe réussie : on la retient, pdf passe en fin de liste", async () => {
    const { calls, attempt } = scripted({ pdf: [{ kind: "blank" }, { kind: "blank" }], snapshot: [{ kind: "ok", frame: picture }] });
    const result = await runCaptureChain(["pdf", "snapshot", "screen"], attempt, async () => "go");
    expect(calls).toEqual(["pdf:0", "pdf:1", "snapshot:0"]);
    expect(result.method).toBe("snapshot");
    expect(captureOutcome(result)).toBe("ok");
    const remembered = rememberAttempts(null, "18.5", result.attempts, NOW);
    expect(remembered).toEqual({ os: "18.5", savedAt: NOW, winner: "snapshot", failed: ["pdf"], reports: {} });
    expect(captureOrder(remembered, "18.5", NOW)).toEqual(["snapshot", "screen", "pdf"]);
  });

  it("enregistrement refusé : arrêt, rien n'est relégué", async () => {
    const { attempt } = scripted({ screen: [{ kind: "error", error: "declined" }] });
    const result = await runCaptureChain(["screen", "pdf"], attempt, async () => "go");
    expect(result.frame).toBeNull();
    expect(result.attempts).toEqual([{ method: "screen", outcome: "declined" }]);
    expect(captureOutcome(result)).toBe("declined");
    expect(captureFailure(result.attempts)).toBe("declined");
    expect(rememberAttempts(null, "18.5", result.attempts, NOW)).toEqual({ os: "18.5", savedAt: NOW, winner: null, failed: [], reports: {} });
  });

  it("« Faire une capture moi-même » : arrêt avant l'alerte d'iOS", async () => {
    const { calls, attempt } = scripted({});
    const result = await runCaptureChain(["pdf", "snapshot", "screen"], attempt, async () => "cancelled");
    expect(calls).toEqual(["pdf:0", "pdf:1", "snapshot:0"]);
    expect(captureFailure(result.attempts)).toBe("cancelled");
  });

  it("écran quitté pendant la prise : la chaîne s'arrête (contre-expertise n° 2)", async () => {
    let wanted = true;
    const calls: string[] = [];
    const result = await runCaptureChain(
      ["pdf", "snapshot", "screen"],
      async (method, tryIndex) => {
        calls.push(`${method}:${tryIndex}`);
        wanted = false;
        return { kind: "blank" };
      },
      async () => "go",
      () => wanted
    );
    expect(calls).toEqual(["pdf:0"]);
    expect(result.frame).toBeNull();
  });

  it("toutes noires : rien ne change (la scène est peut-être sombre)", async () => {
    const { attempt } = scripted({ screen: [{ kind: "blank" }] });
    const result = await runCaptureChain(["pdf", "snapshot", "screen"], attempt, async () => "go");
    expect(captureOutcome(result)).toBe("blank");
    expect(rememberAttempts(memory({ winner: "screen" }), "26.1", result.attempts, NOW)).toEqual(memory({ winner: "screen" }));
  });

  it("ReplayKit indisponible : la chaîne finit sans alerte", async () => {
    const { attempt } = scripted({});
    const result = await runCaptureChain(["screen"], attempt, async () => "unavailable");
    expect(result.attempts).toEqual([{ method: "screen", outcome: "unavailable" }]);
    expect(captureFailure(result.attempts)).toBe("failed");
  });

  it("ordre : la méthode retenue d'abord ; autre version d'iOS, ou mémoire de plus de 30 jours : ordre de départ", () => {
    const known = memory({ winner: "screen", failed: ["snapshot"] });
    expect(captureOrder(known, "26.1", NOW)).toEqual(["screen", "pdf", "snapshot"]);
    expect(captureOrder(known, "27.0", NOW)).toEqual(["pdf", "snapshot", "screen"]);
    expect(captureOrder(known, "26.1", NOW + CAPTURE_MEMORY_MAX_AGE_MS + 1)).toEqual(["pdf", "snapshot", "screen"]);
    expect(captureOrder(null, "26.1", NOW)).toEqual(["pdf", "snapshot", "screen"]);
  });

  it("image noire signalée (contre-expertise n° 15) : un toucher ne suffit pas, au deuxième la méthode passe en fin de liste, jamais retirée", () => {
    const once = reportBlack(memory({ winner: "pdf" }), "26.1", "pdf", NOW);
    expect(once).toMatchObject({ winner: "pdf", failed: [], reports: { pdf: 1 } });
    expect(captureOrder(once, "26.1", NOW)).toEqual(["pdf", "snapshot", "screen"]);
    const twice = reportBlack(once, "26.1", "pdf", NOW);
    expect(twice).toMatchObject({ winner: null, failed: ["pdf"], reports: { pdf: 2 } });
    expect(captureOrder(twice, "26.1", NOW)).toEqual(["snapshot", "screen", "pdf"]);
    let all = twice;
    for (const method of ["snapshot", "snapshot", "screen", "screen"] as const) all = reportBlack(all, "26.1", method, NOW);
    expect(captureOrder(all, "26.1", NOW)).toEqual(["pdf", "snapshot", "screen"]);
  });

  it("mémoire illisible : ignorée ; ancienne forme sans date : considérée comme périmée", () => {
    expect(parseCaptureMemory(null)).toBeNull();
    expect(parseCaptureMemory("{")).toBeNull();
    expect(parseCaptureMemory('{"os":"26.1","winner":"laser","failed":["pdf","x"],"reports":{"pdf":2,"x":1}}')).toEqual({
      os: "26.1",
      savedAt: 0,
      winner: null,
      failed: ["pdf"],
      reports: { pdf: 2 },
    });
    expect(captureOrder(parseCaptureMemory('{"os":"26.1","winner":"screen","failed":[]}'), "26.1", NOW)).toEqual(["pdf", "snapshot", "screen"]);
  });

  it("codes d'erreur du module natif", () => {
    expect(captureErrorKind("ERR_SCREEN_RECORDING_DECLINED")).toBe("declined");
    expect(captureErrorKind("ERR_SCREEN_RECORDING_PHONE_CALL")).toBe("phone_call");
    expect(captureErrorKind("ERR_SCREEN_RECORDING_CANCELLED")).toBe("timeout");
    expect(captureErrorKind("ERR_WEB_VIEW_NOT_FOUND")).toBe("not_ready");
    expect(captureErrorKind("ERR_TIMEOUT")).toBe("timeout");
    expect(captureErrorKind("ERR_CAPTURE_FAILED")).toBe("failed");
    expect(captureErrorKind(null)).toBe("failed");
  });
});

describe("accord préalable (contre-expertise n° 5)", () => {
  it("par plateforme ; illisible : aucun accord", () => {
    expect(parsePlayerConsent(null)).toEqual({ tiktok: false, instagram: false });
    expect(parsePlayerConsent('{"tiktok":true,"instagram":"oui"}')).toEqual({ tiktok: true, instagram: false });
    expect(parsePlayerConsent("{")).toEqual({ tiktok: false, instagram: false });
  });
});

describe("taille du lecteur (9:16, jamais sous 325 × 578 quand l'écran le permet)", () => {
  it("iPhone SE : disposition compacte", () => {
    expect(playerLayout(375, 647)).toEqual({ mode: "compact", width: 325, height: 579 });
  });

  it("iPhone 15 : disposition compacte, lecteur plus grand", () => {
    expect(playerLayout(393, 759)).toEqual({ mode: "compact", width: 344, height: 613 });
  });

  it("iPhone 15 Pro Max : disposition normale (barre, consigne, bouton et mention à l'écran)", () => {
    expect(playerLayout(430, 839)).toEqual({ mode: "regular", width: 353, height: 628 });
  });

  it("code d'intégration : sa hauteur, dans la place disponible ; plus haut : défilement", () => {
    expect(embedHeight(null, 600)).toEqual({ height: 600, scroll: false });
    expect(embedHeight(480.2, 600)).toEqual({ height: 481, scroll: false });
    expect(embedHeight(900, 600)).toEqual({ height: 600, scroll: true });
  });
});
