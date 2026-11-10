import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("me", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "mea");
    other = await createTestUser(app, "meb");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the profile with zeroed follow counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.username).toBe(user.username);
    expect(body.followersCount).toBe(0);
    expect(body.followingCount).toBe(0);
  });

  it("rejects an invalid username format", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: "AB", displayName: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing displayName", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: user.username },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates displayName and bio", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: user.username, displayName: "Updated Name", bio: "hello there" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Updated Name");
    expect(res.json().bio).toBe("hello there");
  });

  it("rejects a username already taken by another user", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: other.username, displayName: "Trying to steal" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("records the interface language (lot 3)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload: { locale: "en" } });
    expect(res.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.json().locale).toBe("en");
    const back = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload: { locale: "fr" } });
    expect(back.statusCode).toBe(204);
  });

  it("rejects an unsupported or missing language, and an anonymous request", async () => {
    for (const payload of [{ locale: "de" }, { locale: 1 }, {}]) {
      const res = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload });
      expect(res.statusCode).toBe(400);
    }
    const anonymous = await app.inject({ method: "PUT", url: "/api/me/locale", payload: { locale: "en" } });
    expect(anonymous.statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.json().locale).toBe("fr");
  });

  // Lot « profil et icône des réglages » : contre spotto-dev-2 (Mac du fondateur).
  it("bio : lignes vides et espaces retirés, 160 caractères et 3 lignes au plus", async () => {
    const patch = (bio: string) =>
      app.inject({ method: "PATCH", url: "/api/me", headers: authHeaders(user.token), payload: { username: user.username, displayName: "Updated Name", bio } });
    const tidy = await patch("  Mode lente  \n\n\n\nParis  ");
    expect(tidy.statusCode).toBe(200);
    expect(tidy.json().bio).toBe("Mode lente\n\nParis");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.json().bio).toBe("Mode lente\n\nParis");

    expect((await patch("a".repeat(161))).json().error).toBe("bio_too_long");
    expect((await patch("1\n2\n3\n4")).json().error).toBe("bio_too_many_lines");
    expect((await patch("salope")).json().error).toBe("content_not_allowed");
    const still = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(still.json().bio).toBe("Mode lente\n\nParis");
  });

  it("photo de profil : carré sans métadonnées, ancienne effacée, « Supprimer ma photo » efface le fichier", async () => {
    const files = async () => {
      const { data, error } = await app.supabaseAdmin.storage.from("avatars").list(user.id, { limit: 100 });
      expect(error).toBeNull();
      return (data ?? []).map((file) => file.name);
    };
    const send = async (image: Buffer) => {
      const { payload, headers } = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: image });
      return app.inject({ method: "POST", url: "/api/me/avatar", headers: { ...authHeaders(user.token), ...headers }, payload });
    };
    const withGps = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#806040" } })
      .withExif({ IFD0: { Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100" } })
      .jpeg()
      .toBuffer();

    const first = await send(withGps);
    expect(first.statusCode).toBe(200);
    const firstName = String(first.json().avatarUrl).split("/").pop()!;
    expect(firstName).toMatch(/^avatar-[0-9a-f-]{36}\.jpg$/);
    const { data: stored } = await app.supabaseAdmin.storage.from("avatars").download(`${user.id}/${firstName}`);
    const meta = await sharp(Buffer.from(await stored!.arrayBuffer())).metadata();
    expect([meta.width, meta.height, meta.exif]).toEqual([512, 512, undefined]);

    const second = await send(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#123" } }).jpeg().toBuffer());
    expect(second.statusCode).toBe(200);
    const secondName = String(second.json().avatarUrl).split("/").pop()!;
    expect(await files()).toEqual([secondName]);

    const removed = await app.inject({ method: "DELETE", url: "/api/me/avatar", headers: authHeaders(user.token) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().avatarUrl).toBeNull();
    expect(await files()).toEqual([]);
  });
});
