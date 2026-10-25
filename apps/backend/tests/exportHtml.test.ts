import { describe, expect, it, vi } from "vitest";
import { MODERATION_ACTION_TYPES, SEARCH_FAILURE_MESSAGES } from "@monapp/shared-types";
import type { ExportDataKey } from "../src/lib/exportData.js";
import { formatPrice, localDay, resolveTimeZone, summarizeUserAgent } from "../src/lib/exportFormat.js";
import { EXPORT_APPENDIX_ID, escapeHtml, renderExportHtml, type ExportHtmlOptions } from "../src/lib/exportHtml.js";
import { EXPORT_COLUMNS, EXPORT_SECTIONS, EXPORT_TEXT, MODERATION_ACTION_LABELS, REPORT_HANDLED_LABELS, type Bilingual } from "../src/lib/exportText.js";
import { chunks, readAll, type PagedQuery, type PageResult } from "../src/lib/pagedReads.js";
import { BLOCKED, FRIEND, GOOGLE_THUMB, SELF, STORAGE, decodeHtml, fixture, lookups, own, sectionHtml, visibleText } from "./exportFixture.js";

// Fichier lisible de l'export RGPD, sur des données en mémoire (aucune base,
// aucun réseau) : dates dans le fuseau de la personne, prix tels que la base
// les enregistre (devise complétée par des espaces, symboles), images de notre
// seul stockage, comptes en relation de blocage jamais nommés (sauf dans
// « Comptes bloqués »), décision de modération jamais montrée à l'auteur d'un
// signalement, tout échappé.

const options = (overrides: Partial<ExportHtmlOptions> = {}): ExportHtmlOptions => ({
  locale: "fr",
  timeZone: "Europe/Paris",
  storageOrigin: STORAGE,
  ...overrides,
});

/** Espaces insécables (Intl) ramenées à des espaces simples. */
const spaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
const decode = decodeHtml;

const render = (overrides: Partial<ExportHtmlOptions> = {}, data = fixture()) => renderExportHtml(data, lookups(), options(overrides));

describe("export lisible : dates et fuseau horaire", () => {
  it("écrit les dates dans le fuseau de la personne, et le nomme", () => {
    const paris = visibleText(render());
    expect(paris).toContain("13 octobre 2026 à 01:19");
    expect(paris).toContain("Europe/Paris");
    expect(paris).toContain("Compte créé le 1er septembre 2026 à 10:00");
    const utc = visibleText(render({ locale: "en", timeZone: "UTC" }));
    expect(utc).toContain("October 12, 2026 at 11:19 PM");
    expect(utc).toContain("time zone: UTC");
  });

  it("refuse un fuseau inconnu ou mal formé : Europe/Paris en français, UTC en anglais", () => {
    expect(resolveTimeZone("America/New_York", "fr")).toBe("America/New_York");
    expect(resolveTimeZone("Mars/Olympus", "fr")).toBe("Europe/Paris");
    expect(resolveTimeZone("Mars/Olympus", "en")).toBe("UTC");
    expect(resolveTimeZone("Europe/Paris<script>", "en")).toBe("UTC");
    expect(resolveTimeZone(`Europe/${"x".repeat(70)}`, "fr")).toBe("Europe/Paris");
    expect(resolveTimeZone(undefined, "fr")).toBe("Europe/Paris");
    expect(resolveTimeZone(["Asia/Tokyo", "UTC"], "fr")).toBe("Asia/Tokyo");
  });

  it("date du nom de fichier dans le fuseau de la personne", () => {
    const late = new Date("2026-10-12T23:19:27.659Z");
    expect(localDay(late, "Europe/Paris")).toBe("2026-10-13");
    expect(localDay(late, "UTC")).toBe("2026-10-12");
  });
});

describe("export lisible : prix et indice de confiance", () => {
  it("garde la devise d'origine, sans les espaces du char(3), Intl seulement pour un code ISO", () => {
    expect(spaces(formatPrice(49.99, "EUR", "fr"))).toBe("49,99 €");
    expect(spaces(formatPrice(49.99, "EUR", "en"))).toBe("€49.99");
    expect(formatPrice(60, "$  ", "fr")).toBe("60 $");
    expect(formatPrice(25, "€  ", "en")).toBe("25 €");
    expect(formatPrice(30, "$US", "fr")).toBe("30 $US");
    expect(formatPrice(12.5, null, "fr")).toBe("12,50");
  });

  it("affiche les fourchettes et n'écrit l'indice de confiance que s'il existe", () => {
    const fr = visibleText(render());
    expect(fr).toContain("49,99 € à 79,99 €");
    expect(fr).toContain("60 $");
    expect(fr).toContain("25 €");
    expect(fr).toContain("30 $US");
    expect(fr.match(/Indice de confiance/g)).toHaveLength(1);
    expect(fr).toContain("Indice de confiance 87 %");
    expect(visibleText(render({ locale: "en" }))).toContain("€49.99 to €79.99");
  });
});

describe("export lisible : recherches", () => {
  it("une pièce signalée « Résultat incohérent » porte la mention, le motif et la date ; la mesure reste dans le JSON", () => {
    const fr = spaces(visibleText(render()));
    expect(fr).toContain("Signalée comme incohérente");
    expect(fr).toMatch(/Prix faux ou absent, le 15 octobre 2026/);
    expect(fr.match(/Signalée comme incohérente/g)).toHaveLength(1);
    const en = spaces(visibleText(render({ locale: "en" })));
    expect(en).toContain("Reported as inconsistent");
    expect(en).toMatch(/Wrong or missing price, on October 15, 2026/);
    // Les nombres de la mesure ne sont jamais dans le texte lisible.
    expect(fr).not.toContain("mesure de qualité");
  });

  it("explique une recherche jamais lancée et la suppression de l'image analysée", () => {
    const fr = visibleText(render());
    expect(fr).toContain(EXPORT_TEXT.pendingExplained.fr);
    expect(fr).toContain(EXPORT_TEXT.analysedImageDeleted.fr);
    expect(fr).toContain("Aucune pièce identifiée sur cette image.");
    expect(fr).toContain("Pièces proposées (5)");
    const en = visibleText(render({ locale: "en" }));
    expect(en).toContain("No piece was identified in this image.");
    expect(en).not.toContain(SEARCH_FAILURE_MESSAGES.noMatch);
  });

  it("montre une colonne inconnue sous son nom brut, et la journalise sans sa valeur", () => {
    const data = fixture();
    data.profile!.nouvelle_colonne = "valeur-nouvelle";
    data.productSearches[0]!.status = "archived";
    const onUnknownColumn = vi.fn();
    const page = render({ onUnknownColumn }, data);
    const text = visibleText(page);
    expect(text).toContain("Autres informations");
    expect(text).toContain("nouvelle_colonne valeur-nouvelle");
    expect(text).toContain("État archived");
    expect(onUnknownColumn).toHaveBeenCalledTimes(1);
    expect(onUnknownColumn).toHaveBeenCalledWith("profile", "nouvelle_colonne");
    expect(JSON.stringify(onUnknownColumn.mock.calls)).not.toContain("valeur-nouvelle");
  });
});

describe("export lisible : images et liens", () => {
  it("n'affiche que les images de notre stockage public ; les autres restent des liens courts", () => {
    const page = render();
    const sources = [...page.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => decode(m[1]!));
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src).toMatch(new RegExp(`^${STORAGE}/storage/v1/object/public/(post-media|avatars|vault-media)/`));
    expect(sources).toContain(own("post-media", "photo-mini.jpg"));
    expect(sources).toContain(own("vault-media", "montre.jpg"));
    for (const img of page.match(/<img [^>]*>/g) ?? []) {
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('referrerpolicy="no-referrer"');
    }
    expect(page).toContain(`<a href="${escapeHtml(new URL(GOOGLE_THUMB).href)}" rel="noopener noreferrer">Voir l&#39;image (gstatic.com)</a>`);
    const text = visibleText(page);
    expect(text).not.toContain("x-signature");
    expect(text).not.toContain("is_from_webapp");
    expect(text).not.toContain("utm_source");
    expect(text).toContain("Ouvrir la vidéo TikTok");
    expect(text).toContain("lien temporaire");
    expect(text).toContain("Voir la pièce chez Boutique");
  });

  it("une image d'un autre site ou d'un bucket non public n'est jamais intégrée", () => {
    const data = fixture();
    data.profile!.avatar_url = `https://ailleurs.example/storage/v1/object/public/avatars/${SELF}/a.jpg`;
    data.vaultItems[0]!.image_url = `${STORAGE}/storage/v1/object/public/screenshots/${SELF}/capture.jpg`;
    const page = render({}, data);
    expect(page).not.toContain('src="https://ailleurs.example');
    expect(page).not.toContain(`src="${STORAGE}/storage/v1/object/public/screenshots`);
    // Sans origine de stockage connue : aucune image du tout.
    expect(render({ storageOrigin: null })).not.toContain("<img");
  });

  it("CSP stricte, aucun script, liens en http(s) seulement", () => {
    const page = render();
    expect(page).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${STORAGE}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`
    );
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
    expect(page).toContain('<html lang="fr">');
    expect(page.toLowerCase()).not.toContain("<script");
    // Aucune balise avec un attribut on… (le texte échappé peut en contenir).
    expect(page).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    for (const href of page.matchAll(/href="([^"]+)"/g)) expect(href[1]).toMatch(/^(https?:\/\/|#)/);
    expect(visibleText(page)).toContain("adresse qui n'est pas un lien web : javascript:alert(1)");
  });
});

describe("export lisible : autres comptes et modération", () => {
  it("un compte qui a bloqué la personne n'est jamais nommé ; les comptes qu'elle a bloqués le sont", () => {
    const fr = visibleText(render());
    expect(fr).not.toContain("bloqueur");
    expect(fr).not.toContain("Nom Secret");
    expect(fr).toContain("Un compte Spotto vous a envoyé une pièce.");
    expect(fr).toContain("une publication d'un compte Spotto");
    expect(fr).toContain("une publication de @alexis (Alexis Martin)");
    expect(fr).toContain("@alexis (Alexis Martin) a commencé à vous suivre.");
    expect(fr).toContain("@importun");
    const en = visibleText(render({ locale: "en" }));
    expect(en).toContain("A Spotto account sent you a piece.");
    expect(en).not.toContain("bloqueur");
  });

  it("un compte que la personne a bloqué n'est nommé que dans « Comptes bloqués »", () => {
    const data = fixture();
    // Pièce reçue de ce compte avant le blocage, puis signalement du compte.
    data.piecesReceived[0]!.sender_id = BLOCKED;
    data.reportsSubmitted.push({
      ...data.reportsSubmitted[0]!,
      id: "re000000-0000-4000-8000-000000000002",
      target_type: "user",
      target_id: BLOCKED,
      note: null,
      handled_at: null,
      moderation_action_id: null,
    });
    data.following.push({ followee_id: BLOCKED, created_at: "2026-09-02T11:00:00+00:00" });
    const base = lookups();
    // Même si son nom arrivait jusqu'ici, le fichier ne l'écrit pas ailleurs.
    const withName = { ...base, people: new Map([...base.people, [BLOCKED, { username: "importun", displayName: "Importun" }]]) };
    for (const locale of ["fr", "en"] as const) {
      const page = renderExportHtml(data, withName, options({ locale }));
      expect(visibleText(sectionHtml(page, "blocked"))).toContain("@importun (Importun)");
      expect(visibleText(page.replace(sectionHtml(page, "blocked"), "")).toLowerCase()).not.toContain("importun");
      expect(visibleText(sectionHtml(page, "piecesReceived"))).toContain(`${EXPORT_COLUMNS.piecesReceived.sender_id.label[locale]} ${EXPORT_TEXT.someone[locale]}`);
      expect(visibleText(sectionHtml(page, "reports"))).toContain(`${EXPORT_COLUMNS.reportsSubmitted.target_id.label[locale]} ${EXPORT_TEXT.someone[locale]}`);
    }
  });

  it("une pièce reçue masquée après son signalement : ni son état, ni la note, ni son image (la décision reste secrète)", () => {
    const data = fixture();
    const hiddenAt = "2026-10-02T08:00:00+00:00";
    // La personne signale la pièce reçue ; la modération la masque, avec sa
    // notification (moderation_set_hidden), au moment où le signalement est traité.
    data.piecesReceived[0]!.hidden_at = hiddenAt;
    data.notifications[2]!.hidden_at = hiddenAt;
    data.reportsSubmitted[0] = { ...data.reportsSubmitted[0]!, target_type: "piece", target_id: data.piecesReceived[0]!.id, handled_at: hiddenAt };
    for (const locale of ["fr", "en"] as const) {
      const page = render({ locale }, data);
      const text = visibleText(page);
      expect(text).toContain("Pièce reçue");
      expect(text).toContain(REPORT_HANDLED_LABELS.piece[locale]);
      expect(text).not.toContain(EXPORT_COLUMNS.piecesSent.hidden_at.label[locale]);
      expect(text).not.toContain(EXPORT_COLUMNS.notifications.hidden_at.label[locale]);
      expect(text).not.toContain(EXPORT_TEXT.hiddenWithContent[locale]);
      for (const id of ["piecesReceived", "notifications"]) expect(visibleText(sectionHtml(page, id)), id).not.toMatch(/masqu|hidden/i);
      // Image d'une pièce reçue (copie rangée chez l'expéditeur) : un lien,
      // pour toutes les pièces reçues, masquées ou non.
      expect(sectionHtml(page, "piecesReceived")).not.toContain("<img");
    }
    expect(sectionHtml(render({}, data), "piecesReceived")).toContain("Voir l&#39;image (supabase.co)");
    expect(sectionHtml(render(), "piecesReceived")).not.toContain("<img");
  });

  it("une pièce envoyée masquée : la personne qui l'a envoyée lit la décision, image comprise", () => {
    const data = fixture();
    data.piecesSent.push({
      ...data.piecesReceived[0]!,
      id: "4e000000-0000-4000-8000-000000000002",
      sender_id: SELF,
      recipient_id: FRIEND,
      title: "Pièce envoyée",
      image_url: own("post-media", "envoi.jpg"),
      image_thumb_url: own("post-media", "envoi-mini.jpg"),
      hidden_at: "2026-10-02T08:00:00+00:00",
    });
    const sent = sectionHtml(render({}, data), "piecesSent");
    expect(visibleText(sent)).toContain("Masquée par la modération le 2 octobre 2026 à 10:00");
    expect(visibleText(sent)).toContain("Envoyée à @alexis (Alexis Martin)");
    expect(sent).toContain(`src="${own("post-media", "envoi-mini.jpg")}"`);
  });

  it("notification masquée : écrite seulement avec une publication masquée de la personne, jamais pour le commentaire d'un autre", () => {
    const data = fixture();
    const ownPost = data.posts[0]!;
    // Commentaire d'un autre compte sur la publication de la personne, masqué
    // après un signalement : sa notification aussi.
    data.notifications.push({
      ...data.notifications[1]!,
      id: "n4000000-0000-4000-8000-000000000001",
      type: "comment",
      actor_id: FRIEND,
      post_id: ownPost.id,
      comment_id: "c0000000-0000-4000-8000-000000000009",
      hidden_at: "2026-10-03T08:00:00+00:00",
    });
    const commentOnly = visibleText(sectionHtml(render({}, data), "notifications"));
    expect(commentOnly).toContain("@alexis (Alexis Martin) a commenté votre publication.");
    expect(commentOnly).not.toMatch(/masqu/i);

    // La publication elle-même est masquée plus tôt : la notification le dit,
    // avec la date de cette décision (jamais celle du commentaire).
    ownPost.hidden_at = "2026-10-02T08:00:00+00:00";
    const page = render({}, data);
    const withPost = visibleText(sectionHtml(page, "notifications"));
    expect(withPost).toContain(`${EXPORT_COLUMNS.notifications.hidden_at.label.fr} 2 octobre 2026 à 10:00`);
    expect(withPost).toContain(EXPORT_TEXT.hiddenWithContent.fr);
    expect(withPost).not.toContain("3 octobre 2026");
    expect(visibleText(sectionHtml(page, "posts"))).toContain("Masquée par la modération le 2 octobre 2026 à 10:00");
    expect(visibleText(sectionHtml(render({ locale: "en" }, data), "notifications"))).toContain(EXPORT_TEXT.hiddenWithContent.en);
  });

  it("l'auteur d'un signalement apprend qu'il a été traité, jamais la décision", () => {
    const fr = visibleText(render());
    expect(fr).toContain("Votre signalement d'une publication a été traité.");
    expect(fr).toContain("Traité le 21 septembre 2026");
    for (const action of MODERATION_ACTION_TYPES) expect(fr).not.toContain(MODERATION_ACTION_LABELS[action].fr);
    expect(visibleText(render({ locale: "en" }))).toContain("Your report about a post was handled.");
  });

  it("clics : la pièce, l'endroit de l'app, le navigateur en clair (en-tête complet dans le JSON seulement)", () => {
    const page = render();
    const fr = visibleText(page);
    expect(fr).toContain("Sac cabas chez Boutique");
    expect(fr).toContain("Résultat d'une recherche");
    expect(fr).toContain("Chrome · Mac");
    expect(fr).not.toContain("AppleWebKit");
    expect(page).toContain("AppleWebKit");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toMatchObject({
      browser: "Safari",
      device: "iPhone",
    });
    expect(summarizeUserAgent("Spotto/1 CFNetwork/3826.500.131 Darwin/24.5.0")).toEqual({ browser: null, device: "iOS", app: true });
  });

  it("sections vides et exports précédents", () => {
    const fr = visibleText(render());
    expect(fr).toContain("Vos abonnés Les comptes qui suivent vos publications. Aucune donnée.");
    expect(fr).toContain(EXPORT_TEXT.currentExportNote.fr);
    expect(visibleText(render({ locale: "en" }))).toContain("Your followers The accounts that follow your posts. No data.");
  });
});

describe("export lisible : échappement et version technique", () => {
  it("échappe tout ce qui vient des personnes, et joint le JSON complet, échappé", () => {
    const data = fixture();
    const page = render({}, data);
    expect(page).not.toMatch(/<img src=x/i);
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const appendix = page.slice(page.indexOf(`<section id="${EXPORT_APPENDIX_ID}"`));
    expect(appendix).toContain("<details>");
    expect(appendix).not.toContain("<details open");
    expect(appendix).toContain("Version technique complète (JSON)");
    const pre = appendix.slice(appendix.indexOf("<pre>") + 5, appendix.indexOf("</pre>"));
    expect(JSON.parse(decode(pre))).toEqual(data);
  });

  it("aucun identifiant interne dans le texte visible", () => {
    const text = visibleText(render());
    expect(text).not.toContain(SELF);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

/** Toutes les feuilles { fr, en } d'un catalogue. */
function bilinguals(value: unknown, path = ""): [string, Bilingual][] {
  if (typeof value !== "object" || value === null) return [];
  if ("fr" in value && "en" in value && typeof value.fr === "string" && typeof value.en === "string") return [[path, value as Bilingual]];
  return Object.entries(value).flatMap(([key, child]) => bilinguals(child, path ? `${path}.${key}` : key));
}

describe("export lisible : textes", () => {
  const all = bilinguals(EXPORT_TEXT).concat(bilinguals(EXPORT_SECTIONS), bilinguals(EXPORT_COLUMNS));

  it("chaque section de l'export est présentée dans une seule section du fichier", () => {
    const keys = Object.keys(fixture()).filter((key) => key !== "exportedAt");
    const shown = Object.values(EXPORT_SECTIONS).flatMap((section) => [...section.keys]);
    expect([...shown].sort()).toEqual([...keys].sort());
    for (const key of keys) expect(Object.keys(EXPORT_COLUMNS), key).toContain(key as ExportDataKey);
  });

  it("chaque libellé a son français et son anglais", () => {
    for (const [path, label] of all) {
      expect(label.fr.trim(), path).not.toBe("");
      expect(label.en.trim(), path).not.toBe("");
    }
  });

  it("anglais sans accents français, français sans anglais oublié et au vouvoiement", () => {
    for (const [path, label] of all) {
      expect(label.en, path).not.toMatch(/[àâäçéèêëîïôöùûüÿœæ«»]/i);
      expect(label.fr, path).not.toMatch(/\b(the|your|you|and|with|data|search|post|posts|likes?|followers|settings|unknown|yes|of)\b/i);
      expect(label.fr, path).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
    }
    for (const [path, label] of bilinguals(EXPORT_TEXT).concat(bilinguals(EXPORT_SECTIONS))) {
      if (!["noData", "otherInfo"].includes(path) && label.fr.length > 12) expect(label.fr, path).not.toBe(label.en);
    }
  });

  it("le fichier français n'a pas de mot anglais, l'anglais pas d'accent (hors données de la personne)", () => {
    const fr = visibleText(render());
    expect(fr).not.toMatch(/\b(the|your|you|and|with|No data|Searches|Posts|Likes|Followers|Settings|Unknown|Yes)\b/);
    const data = fixture();
    // Données de la personne sans accent, pour ne vérifier que les textes du fichier.
    data.piecesReceived[0]!.title = "Received piece";
    data.wishlistItems[0]!.title = "Wish";
    data.profile!.bio = "Fashion";
    const en = visibleText(renderExportHtml(data, lookups(), options({ locale: "en", timeZone: "UTC" })));
    expect(en).not.toMatch(/[àâäçéèêëîïôöùûüÿœæ«»]/i);
    expect(en).toContain("Your Spotto data");
  });
});

/** Fausse requête : la base renvoie au plus `maxRows` lignes par requête,
 * avec le total demandé (count: "exact"). */
function fakeTable(rows: string[], { maxRows, count = rows.length, failAt }: { maxRows: number; count?: number | ((call: number) => number); failAt?: number }) {
  const ranges: [number, number][] = [];
  const orders: string[] = [];
  let calls = 0;
  const makeQuery = (): PagedQuery => {
    const query: PagedQuery = {
      order(column) {
        orders.push(column);
        return query;
      },
      range(from, to): PromiseLike<PageResult> {
        calls += 1;
        ranges.push([from, to]);
        if (failAt === calls) return Promise.resolve({ data: null, error: { message: "panne" }, count: null });
        const total = typeof count === "function" ? count(calls) : count;
        const end = Math.min(to + 1, from + maxRows);
        return Promise.resolve({ data: rows.slice(from, end).map((id) => ({ id })), error: null, count: total });
      },
    };
    return query;
  };
  return { makeQuery, ranges, orders };
}

describe("lectures complètes (pagination)", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  it("« Max rows » (2) plus petit que la page (3) : toutes les lignes, dans l'ordre", async () => {
    const table = fakeTable(ids, { maxRows: 2 });
    const rows = await readAll<{ id: string }>("test", table.makeQuery, ["created_at", "id"], 3);
    expect(rows.map((row) => row.id)).toEqual(ids);
    expect(table.ranges).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
    ]);
    expect(table.orders.slice(0, 2)).toEqual(["created_at", "id"]);
  });

  it("total annoncé jamais atteint, total modifié, panne ou total inconnu : erreur, jamais une liste tronquée", async () => {
    await expect(readAll("test", fakeTable(ids, { maxRows: 2, count: 8 }).makeQuery, ["id"], 3)).rejects.toThrow("7 lignes lues sur 8");
    await expect(readAll("test", fakeTable(ids, { maxRows: 2, count: (call) => (call === 1 ? 7 : 8) }).makeQuery, ["id"], 3)).rejects.toThrow("modifiées");
    await expect(readAll("test", fakeTable(ids, { maxRows: 2, failAt: 2 }).makeQuery, ["id"], 3)).rejects.toThrow("lecture impossible");
    const unknownTotal: PagedQuery = { order: () => unknownTotal, range: () => Promise.resolve({ data: [], error: null, count: null }) };
    await expect(readAll("test", () => unknownTotal, ["id"])).rejects.toThrow("inconnu");
  });

  it("table vide : une seule requête", async () => {
    const table = fakeTable([], { maxRows: 2 });
    expect(await readAll("test", table.makeQuery, ["id"], 3)).toEqual([]);
    expect(table.ranges).toHaveLength(1);
  });

  it("découpe les listes d'identifiants en paquets de 100", () => {
    const list = Array.from({ length: 250 }, (_, i) => i);
    expect(chunks(list).map((part) => part.length)).toEqual([100, 100, 50]);
    expect(chunks([])).toEqual([]);
  });
});

describe("colonnes de la migration 0027, décrites d'avance", () => {
  // La base migrée renvoie ces colonnes même au serveur d'avant (mise en ligne) :
  // chacune doit déjà avoir son libellé, sinon l'export ne serait plus complet.
  it("recherches et propositions : chaque nouvelle colonne a son libellé en français et en anglais", () => {
    const attendues: [keyof typeof EXPORT_COLUMNS, string][] = [
      ["productSearches", "provider"],
      ["productSearches", "provider_status_code"],
      ["productSearches", "run_started_at"],
      ["productMatches", "provider_page_token"],
      ["productMatches", "provider_product_id"],
      ["productMatches", "stores"],
      ["productMatches", "stores_requested_at"],
    ];
    for (const [section, colonne] of attendues) {
      const libelle = (EXPORT_COLUMNS[section] as Record<string, { label: Bilingual }>)[colonne]?.label;
      expect(libelle?.fr.trim(), `${section}.${colonne}`).toBeTruthy();
      expect(libelle?.en.trim(), `${section}.${colonne}`).toBeTruthy();
    }
  });
});
