import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TryonStatus } from "@monapp/shared-types";

// Essayage virtuel photo (site) : les appels au serveur (chemins, méthodes,
// corps, champs de l'envoi de la photo) et l'état partagé (demandé une fois
// par compte, remis à « éteint » au changement de compte). Le réseau est
// remplacé par un double d'authorizedFetch : aucun appel ne part, et aucun
// appel à un service d'essayage n'existe côté site.
const { authorizedFetch } = vi.hoisted(() => ({ authorizedFetch: vi.fn() }));
vi.mock("../src/lib/api", () => ({ authorizedFetch }));

const ITEM = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const REMAINING = { free: 4, bonus: 0, nextReset: "2026-11-30T23:00:00.000Z" };
const ON: TryonStatus = { enabled: true, ageGate: "adult", consent: { required: false, version: "2026-11-v1" }, remaining: REMAINING };
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Modules relus à neuf : chaque test part de l'état « éteint », sans compte. */
async function modules() {
  vi.resetModules();
  const api = await import("../src/lib/tryon-api.web");
  const status = await import("../src/lib/tryon-status.web");
  const { ApiError } = await import("../src/lib/api-error");
  return { api, status, ApiError };
}

beforeEach(() => {
  authorizedFetch.mockReset();
});

describe("appels au serveur", () => {
  it("statut : GET /api/tryon/status, jamais mis en cache ; illisible : éteint", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(json(ON));
    expect(await api.fetchTryonStatus()).toEqual(ON);
    expect(authorizedFetch).toHaveBeenCalledWith("/api/tryon/status", { cache: "no-store" });
    authorizedFetch.mockResolvedValueOnce(new Response("pas du JSON", { status: 200 }));
    expect(await api.fetchTryonStatus()).toEqual({ enabled: false });
  });

  it("porte d'âge : POST de la date seule ; réponse illisible : erreur", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(json({ ageGate: "adult" }));
    expect(await api.submitBirthDate("1990-06-15")).toBe("adult");
    expect(authorizedFetch).toHaveBeenCalledWith("/api/tryon/age-gate", { method: "POST", body: JSON.stringify({ birthDate: "1990-06-15" }) });
    authorizedFetch.mockResolvedValueOnce(json({ ageGate: "unknown" }));
    await expect(api.submitBirthDate("1990-06-15")).rejects.toBeInstanceOf(api.TryonResponseError);
  });

  it("lecture du consentement (Réglages) : GET /api/tryon/consent, jamais mis en cache ; illisible : erreur", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(json({ consent: { given: true, version: "2026-11-v1" } }));
    expect(await api.fetchTryonConsent()).toEqual({ given: true, version: "2026-11-v1" });
    expect(authorizedFetch).toHaveBeenCalledWith("/api/tryon/consent", { cache: "no-store" });
    authorizedFetch.mockResolvedValueOnce(json({ consent: { required: true, version: "2026-11-v1" } }));
    await expect(api.fetchTryonConsent()).rejects.toBeInstanceOf(api.TryonResponseError);
  });

  it("consentement : POST de la version lue ; retrait : DELETE sans corps", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(json({ consent: { required: false, version: "2026-11-v1" } }));
    expect(await api.acceptTryonConsent("2026-11-v1")).toEqual({ required: false, version: "2026-11-v1" });
    expect(authorizedFetch).toHaveBeenLastCalledWith("/api/tryon/consent", { method: "POST", body: JSON.stringify({ version: "2026-11-v1" }) });
    authorizedFetch.mockResolvedValueOnce(json({ consent: { required: true, version: "2026-11-v1" } }));
    expect(await api.withdrawTryonConsent()).toEqual({ required: true, version: "2026-11-v1" });
    expect(authorizedFetch).toHaveBeenLastCalledWith("/api/tryon/consent", { method: "DELETE" });
  });

  it("essai : multipart (pièce, attestation, puis la photo en mémoire), réponse relue", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(json({ image: IMAGE, remaining: { ...REMAINING, free: 3 } }));
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const controller = new AbortController();
    const result = await api.runTryon({ itemId: ITEM, photo, attestSelf: true, signal: controller.signal });
    expect(result).toEqual({ image: IMAGE, remaining: { ...REMAINING, free: 3 } });
    const [path, init] = authorizedFetch.mock.calls[0]!;
    expect(path).toBe("/api/tryon");
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(controller.signal);
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(["itemId", "attestSelf", "photo"]);
    expect(form.get("itemId")).toBe(ITEM);
    expect(form.get("attestSelf")).toBe("true");
    const sent = form.get("photo") as File;
    expect(sent.name).toBe("photo.jpg");
    expect(sent.type).toBe("image/jpeg");
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it("essai : jamais sans identifiant valide ni attestation ; image illisible : erreur", async () => {
    const { api } = await modules();
    const photo = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    await expect(api.runTryon({ itemId: "https://ailleurs.test/image.jpg", photo, attestSelf: true })).rejects.toBeInstanceOf(api.TryonResponseError);
    await expect(api.runTryon({ itemId: ITEM, photo, attestSelf: false as true })).rejects.toBeInstanceOf(api.TryonResponseError);
    expect(authorizedFetch).not.toHaveBeenCalled();
    authorizedFetch.mockResolvedValueOnce(json({ image: "https://cdn.exemple.test/out.png", remaining: REMAINING }));
    await expect(api.runTryon({ itemId: ITEM, photo, attestSelf: true })).rejects.toBeInstanceOf(api.TryonResponseError);
  });

  it("signalement : POST du motif et du commentaire, réponse 204 sans corps", async () => {
    const { api } = await modules();
    authorizedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.reportTryonResult({ itemId: ITEM, reason: "poor_quality", comment: "Flou." });
    expect(authorizedFetch).toHaveBeenCalledWith("/api/tryon/report", { method: "POST", body: JSON.stringify({ itemId: ITEM, reason: "poor_quality", comment: "Flou." }) });
  });

  it("les erreurs du serveur remontent telles quelles (ApiError)", async () => {
    const { api, ApiError } = await modules();
    const refusal = new ApiError(429, { error: "tryon_quota_exhausted", message: "Plus d'essais." });
    authorizedFetch.mockRejectedValueOnce(refusal);
    const photo = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    await expect(api.runTryon({ itemId: ITEM, photo, attestSelf: true })).rejects.toBe(refusal);
  });
});

describe("état partagé de l'essayage", () => {
  it("commence éteint ; demandé une seule fois par compte, même par plusieurs écrans", async () => {
    const { status } = await modules();
    expect(status.tryonStatus()).toEqual({ enabled: false });
    authorizedFetch.mockResolvedValue(json(ON));
    await Promise.all([status.ensureTryonStatus("compte-a"), status.ensureTryonStatus("compte-a")]);
    await status.ensureTryonStatus("compte-a");
    expect(authorizedFetch).toHaveBeenCalledTimes(1);
    expect(status.tryonStatus()).toEqual(ON);
  });

  it("rien n'est demandé sans compte connecté", async () => {
    const { status } = await modules();
    await status.ensureTryonStatus(null);
    expect(authorizedFetch).not.toHaveBeenCalled();
  });

  it("changement de compte : retour immédiat à « éteint », puis nouvelle demande pour le nouveau compte", async () => {
    const { status } = await modules();
    authorizedFetch.mockResolvedValueOnce(json(ON));
    await status.ensureTryonStatus("compte-a");
    const seen: TryonStatus[] = [];
    status.onTryonStatus((next) => seen.push(next));
    let answer!: (response: Response) => void;
    authorizedFetch.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const pending = status.ensureTryonStatus("compte-b");
    // Avant toute réponse pour le compte B : rien du compte A n'est montré.
    expect(status.tryonStatus()).toEqual({ enabled: false });
    expect(seen).toEqual([{ enabled: false }]);
    answer(json({ ...ON, ageGate: "unknown", consent: { required: true, version: "2026-11-v1" } }));
    await pending;
    expect(status.tryonStatus()).toMatchObject({ enabled: true, ageGate: "unknown" });
  });

  it("déconnexion : éteint", async () => {
    const { status } = await modules();
    authorizedFetch.mockResolvedValueOnce(json(ON));
    await status.ensureTryonStatus("compte-a");
    await status.ensureTryonStatus(null);
    expect(status.tryonStatus()).toEqual({ enabled: false });
  });

  it("hors ligne : l'état connu reste et sera redemandé ; autre erreur (route absente) : éteint", async () => {
    const { status, ApiError } = await modules();
    authorizedFetch.mockResolvedValueOnce(json(ON));
    await status.ensureTryonStatus("compte-a");
    authorizedFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(status.refreshTryonStatus()).rejects.toBeInstanceOf(TypeError);
    expect(status.tryonStatus()).toEqual(ON);
    authorizedFetch.mockRejectedValueOnce(new ApiError(404, { error: "not_found", message: "Page introuvable." }));
    expect(await status.refreshTryonStatus()).toEqual({ enabled: false });
    expect(status.tryonStatus()).toEqual({ enabled: false });
  });

  it("réponse d'une action : l'état suit sans relecture ; sans effet quand l'essayage est éteint", async () => {
    const { status } = await modules();
    status.updateTryonStatus({ ageGate: "adult" });
    expect(status.tryonStatus()).toEqual({ enabled: false });
    authorizedFetch.mockResolvedValueOnce(json({ ...ON, consent: { required: true, version: "2026-11-v1" } }));
    await status.ensureTryonStatus("compte-a");
    const seen: TryonStatus[] = [];
    const stop = status.onTryonStatus((next) => seen.push(next));
    status.updateTryonStatus({ consent: { required: false, version: "2026-11-v1" } });
    status.updateTryonStatus({ consent: { required: false, version: "2026-11-v1" } });
    status.updateTryonStatus({ remaining: { ...REMAINING, free: 3 } });
    expect(seen).toHaveLength(2);
    expect(status.tryonStatus()).toEqual({ ...ON, remaining: { ...REMAINING, free: 3 } });
    stop();
    status.updateTryonStatus({ remaining: { ...REMAINING, free: 2 } });
    expect(seen).toHaveLength(2);
  });
});
