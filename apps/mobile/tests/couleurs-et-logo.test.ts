import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Lot « couleurs et logo » (« Noir et ivoire », validé par le fondateur le
// 25 novembre 2026) : l'accent (jeton `vert`) a la couleur du texte. Ce
// fichier lit le source de l'app pour vérifier ce que cela entraîne.

const SRC = join(__dirname, "../src");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

const sources = fichiers(SRC).map((chemin) => ({ fichier: relative(SRC, chemin), code: readFileSync(chemin, "utf8") }));

/** Les interrupteurs (`<Switch …/>`) d'un source. */
function interrupteurs(code: string): string[] {
  return [...code.matchAll(/<Switch\b[\s\S]*?\/>/g)].map((match) => match[0]);
}

/** La règle : l'interrupteur a une valeur, prend couleursInterrupteur(cette valeur), et aucune piste ni curseur écrits à la main. */
function interrupteurConforme(bloc: string): boolean {
  // Sans accolade dans la valeur : sinon, sur une seule ligne, la capture avalerait la suite du bloc.
  const valeur = bloc.match(/\bvalue=\{([^{}\n]*)\}/)?.[1];
  return !!valeur && bloc.includes(`{...couleursInterrupteur(${valeur})}`) && !/trackColor|thumbColor/.test(bloc);
}

describe("interrupteurs : couleurs communes (theme/accent.ts)", () => {
  it("chaque interrupteur de l'app prend couleursInterrupteur(sa valeur), jamais une piste écrite à la main", () => {
    const tous = sources.flatMap(({ fichier, code }) => interrupteurs(code).map((bloc) => ({ fichier, bloc })));
    expect(tous.length).toBeGreaterThanOrEqual(11);
    for (const { fichier, bloc } of tous) {
      expect(interrupteurConforme(bloc), `${fichier} : ${bloc}`).toBe(true);
    }
  });

  it("le garde-fou refuse une piste écrite à la main (le curseur blanc d'iOS se perdrait sur l'ivoire)", () => {
    const [bloc] = interrupteurs(`<Switch value={on} trackColor={{ true: color.vert, false: color.filet }} />`);
    expect(bloc).toBeDefined();
    expect(interrupteurConforme(bloc!)).toBe(false);
    // Même avec les couleurs communes, une piste ajoutée en plus est refusée.
    expect(interrupteurConforme(`<Switch value={on} {...couleursInterrupteur(on)} thumbColor="#FFFFFF" />`)).toBe(false);
    // Couleurs communes prises sur une autre valeur que celle de l'interrupteur : refusé.
    expect(interrupteurConforme(`<Switch value={on} {...couleursInterrupteur(autre)} />`)).toBe(false);
  });

  it("le garde-fou permet un interrupteur qui prend couleursInterrupteur(sa valeur)", () => {
    const [bloc] = interrupteurs(`<Switch value={on} {...couleursInterrupteur(on)} />`);
    expect(bloc).toBeDefined();
    expect(interrupteurConforme(bloc!)).toBe(true);
  });

  it("allumé : curseur `blanc` du thème ; éteint : blanc ; sur le site, le curseur allumé suit (activeThumbColor)", () => {
    const accent = readFileSync(join(SRC, "theme/accent.ts"), "utf8");
    expect(accent).toContain("const curseur = allume ? color.blanc : color.surImage;");
    expect(accent).toContain("trackColor: { true: color.vert, false: color.filet }");
    expect(accent).toContain("activeThumbColor: color.blanc");
  });
});

/** Styles d'un source écrits avec l'accent comme couleur de texte : « clé » et définition (une ligne). */
function textesEnAccent(code: string): { cle: string; definition: string }[] {
  return [...code.matchAll(/^\s*(\w+): \{([^\n]*\bcolor: color\.vert\b[^\n]*)\},?$/gm)].map((match) => ({ cle: match[1]!, definition: match[2]! }));
}

// Textes en accent qui ne sont PAS des liens, donc pas soulignés : libellés
// d'un bouton encadré (filet) ou plein, textes d'état qu'on ne touche pas,
// mentions « ⓘ » qui ouvrent une explication (le signe dit qu'on peut toucher).
const PAS_DES_LIENS: Record<string, string> = {
  "app/(app)/(tabs)/activite.tsx:secondaryLabel": "bouton encadré",
  "app/(app)/collection-ami.tsx:actionLabel": "bouton encadré",
  "app/(app)/enregistrees.tsx:moreLabel": "bouton encadré",
  "app/(app)/envie.tsx:secondaryLabel": "bouton encadré",
  "app/(app)/messages.tsx:secondaryLabel": "bouton encadré",
  "app/(app)/moderation.tsx:secondaryLabel": "bouton encadré",
  "components/collection-settings-sheet.tsx:buttonLabel": "bouton encadré",
  "components/load-failure.tsx:buttonLabel": "bouton encadré",
  "components/member-list.tsx:moreLabel": "bouton encadré",
  "components/moderation-item.tsx:actionLabel": "bouton encadré",
  "components/piece-extra-actions.web.tsx:label": "bouton encadré",
  "components/private-account-setting.tsx:buttonLabel": "bouton encadré",
  "components/received-pieces.tsx:loadMoreLabel": "bouton encadré",
  "components/robot-check.tsx:retryLabel": "bouton encadré",
  "components/signup-help.tsx:buttonLabel": "bouton encadré",
  "components/tryon-ui.web.tsx:secondaryLabel": "bouton encadré",
  "components/wish-alert-sheet.tsx:buttonLabel": "bouton encadré",
  "components/wish-bought-button.tsx:label": "bouton encadré",
  "components/wishlist-panel.tsx:chipNewLabel": "puce encadrée en pointillés",
  "app/(app)/envie.tsx:priceDrop": "texte d'état",
  "app/(app)/moderation.tsx:lookOk": "texte d'état",
  "app/(app)/vault-item/[id].tsx:verifiedBadgeText": "texte d'état",
  "components/add-to-collection-sheet.tsx:badge": "texte d'état",
  "components/link-entry.tsx:detectedLabel": "texte d'état",
  "components/wishlist-panel.tsx:priceDrop": "texte d'état, dans une vignette",
  "components/offer-mark.tsx:known": "mention ⓘ",
  "components/stock-note.tsx:inStock": "mention ⓘ",
};

// Actions d'une barre de titre ou de l'en-tête d'une feuille (décision du
// 25 novembre 2026) : reconnues à leur place, comme partout sur iPhone, elles
// ne sont PAS soulignées ; elles restent en demi-gras (600). Les liens dans le
// corps d'un écran, eux, restent soulignés.
const ACTIONS_DE_BARRE: Record<string, string> = {
  "app/(app)/post-item/new.tsx:publishLabel": "« Publier », en haut à droite de l'écran de publication",
  "components/tryon-sheet.web.tsx:closeLabel": "« Fermer », dans l'en-tête de la feuille d'essayage du site",
};

const souligne = (definition: string) => definition.includes("...lienSouligne");
/** Une action de barre : jamais soulignée, toujours en demi-gras. */
const actionDeBarreConforme = (definition: string) => !souligne(definition) && !definition.includes("textDecorationLine") && definition.includes('fontWeight: "600"');

describe("liens : soulignés, puisque l'accent a la couleur du texte", () => {
  const tous = sources.flatMap(({ fichier, code }) => textesEnAccent(code).map(({ cle, definition }) => ({ id: `${fichier}:${cle}`, definition })));

  it("chaque texte en accent est soit souligné (lien), soit une action de barre, soit un libellé de bouton ou un texte d'état listé ici", () => {
    expect(tous.length).toBeGreaterThanOrEqual(80);
    const nonClasses = tous.filter(({ id, definition }) => !souligne(definition) && !(id in PAS_DES_LIENS) && !(id in ACTIONS_DE_BARRE)).map(({ id }) => id);
    expect(nonClasses).toEqual([]);
    // Un texte listé comme « pas un lien » n'est pas souligné, et la liste ne garde rien de périmé.
    const ids = new Set(tous.map(({ id }) => id));
    expect(Object.keys(PAS_DES_LIENS).filter((id) => !ids.has(id))).toEqual([]);
    expect(tous.filter(({ id, definition }) => id in PAS_DES_LIENS && souligne(definition)).map(({ id }) => id)).toEqual([]);
    // Les quatre groupes ne se recoupent pas.
    expect(Object.keys(ACTIONS_DE_BARRE).filter((id) => id in PAS_DES_LIENS)).toEqual([]);
    // Au moins les liens des réglages, des documents et de l'inscription.
    expect(tous.filter(({ definition }) => souligne(definition)).length).toBeGreaterThanOrEqual(50);
  });

  it("actions de barre (« Publier », « Fermer » de la feuille d'essayage) : à leur place, sans soulignement, en demi-gras", () => {
    const parId = new Map(tous.map(({ id, definition }) => [id, definition]));
    for (const id of Object.keys(ACTIONS_DE_BARRE)) {
      const definition = parId.get(id);
      expect(definition, id).toBeDefined();
      expect(actionDeBarreConforme(definition!), id).toBe(true);
    }
    // Elles sont bien dans une barre : à côté du titre de l'écran ou de la feuille.
    const publication = readFileSync(join(SRC, "app/(app)/post-item/new.tsx"), "utf8");
    expect(publication.slice(publication.indexOf("<View style={styles.nav}>"), publication.indexOf("{/* Envoi des photos"))).toContain("styles.publishLabel");
    const essayage = readFileSync(join(SRC, "components/tryon-sheet.web.tsx"), "utf8");
    expect(essayage.slice(essayage.indexOf("<View style={styles.header}>"), essayage.indexOf("<ScrollView"))).toContain("styles.closeLabel");
  });

  it("le garde-fou refuse une action de barre soulignée ou sans demi-gras, et accepte le demi-gras seul", () => {
    expect(actionDeBarreConforme(`...lienSouligne, fontSize: font.secondary, fontWeight: "600", color: color.vert `)).toBe(false);
    expect(actionDeBarreConforme(` fontSize: font.secondary, color: color.vert `)).toBe(false);
    expect(actionDeBarreConforme(` fontSize: font.secondary, fontWeight: "600", color: color.vert `)).toBe(true);
  });

  it("un seul style commun : plus de soulignement écrit à la main sur un texte en accent", () => {
    expect(tous.filter(({ definition }) => definition.includes("textDecorationLine")).map(({ id }) => id)).toEqual([]);
    const accent = readFileSync(join(SRC, "theme/accent.ts"), "utf8");
    expect(accent).toContain('textDecorationLine: "underline"');
    expect(accent).toContain("textUnderlineOffset: 3, textDecorationThickness: 1");
  });

  it("le garde-fou refuse un lien en accent sans soulignement, et accepte le style commun", () => {
    const [nu] = textesEnAccent(`  lienNu: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },`);
    const [ok] = textesEnAccent(`  lien: { ...lienSouligne, fontSize: font.secondary, color: color.vert },`);
    expect(nu && souligne(nu.definition)).toBe(false);
    expect(ok && souligne(ok.definition)).toBe(true);
    expect(textesEnAccent(`  plein: { backgroundColor: color.vert },`)).toEqual([]);
  });
});

describe("le « + » de la barre du bas : seule touche de couleur, aux couleurs du logo", () => {
  const onglets = readFileSync(join(SRC, "app/(app)/(tabs)/_layout.tsx"), "utf8");
  const plus = onglets.slice(onglets.indexOf('name="publish"'), onglets.indexOf('name="activite"'));

  it("disque vert anglais, cercle fin (1,5 point) et signe « + » dorés", () => {
    expect(plus).toContain("backgroundColor: color.vertAnglais,");
    expect(plus).toContain("borderWidth: 1.5,");
    expect(plus).toContain("borderColor: color.dorure,");
    expect(plus).toContain("<PlusIcon size={18} tint={color.dorure} />");
    // Refusé : l'accent, qui serait devenu un disque noir ou ivoire.
    expect(plus).not.toContain("color.vert,");
  });

  it("les deux couleurs de marque ne servent nulle part ailleurs dans l'app", () => {
    const ailleurs = sources
      .filter(({ fichier }) => fichier !== join("app", "(app)", "(tabs)", "_layout.tsx") && fichier !== join("theme", "tokens.ts"))
      .filter(({ code }) => /color\.(vertAnglais|dorure)\b/.test(code))
      .map(({ fichier }) => fichier);
    expect(ailleurs).toEqual([]);
    expect(/color\.(vertAnglais|dorure)\b/.test("<View style={{ backgroundColor: color.dorure }} />")).toBe(true);
  });
});
