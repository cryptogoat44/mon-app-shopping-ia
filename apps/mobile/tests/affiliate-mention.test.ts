import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { affiliateMentionForm, isAffiliateLink, type AffiliateMentionForm } from "../src/lib/affiliate-link";

// Lot « mention Lien affilié » : la mention est VISIBLE partout où un lien
// vers une boutique est montré, ouvert ou partagé — et nulle part tant
// qu'aucun lien n'est affilié (aujourd'hui : le serveur renvoie toujours le
// lien du marchand). Pas de rendu de composants ici (vitest.config.ts) : la
// règle et la forme de la mention sont exécutées, et chaque écran est lu pour
// vérifier qu'il leur confie bien son lien.
const SRC = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

// Trois liens : un vrai lien affilié, le lien du marchand tel quel (tous les
// liens d'aujourd'hui), et aucun lien affilié du tout.
const affiliated = { affiliateUrl: "https://reseau.example/clic?id=1", merchantUrl: "https://marchand.example/p" };
const direct = { affiliateUrl: "https://marchand.example/p", merchantUrl: "https://marchand.example/p" };
const none = { affiliateUrl: null, merchantUrl: "https://marchand.example/p" };

const mention = read("components/affiliate-mention.tsx");
const button = read("components/merchant-link-button.tsx");

describe("la mention visible : un seul composant, qui ne décide rien", () => {
  it("sans lien affilié, rien à l'écran — quelle que soit la forme demandée, ancien serveur compris", () => {
    for (const options of [{}, { explain: true }, { inline: true }, { explain: true, inline: true }]) {
      expect(affiliateMentionForm(false, options)).toBe("none");
      expect(affiliateMentionForm(undefined, options)).toBe("none");
    }
    expect(mention).toContain("const form = affiliateMentionForm(isAffiliate, { explain, inline });");
    expect(mention).toContain('if (form === "none") return null;');
  });

  it("avec un lien affilié : le texte seul, à la suite d'un libellé, ou dépliable", () => {
    expect(affiliateMentionForm(true)).toBe("plain");
    expect(affiliateMentionForm(true, { inline: true })).toBe("inline");
    expect(affiliateMentionForm(true, { explain: true })).toBe("explain");
    // Les trois formes écrivent le même texte, du catalogue.
    expect(mention.match(/\{t\.result\.affiliateDisclosure\}/g)).toHaveLength(3);
  });

  it("touchée, elle déplie « Comment Spotto se rémunère » et ce que signifie « lien affilié »", () => {
    expect(mention).toContain('accessibilityRole="button"');
    expect(mention).toContain("accessibilityState={{ expanded: open }}");
    expect(mention).toContain("accessibilityHint={t.result.affiliateHint}");
    const explanation = mention.slice(mention.indexOf("{open ? ("));
    expect(explanation).toContain("{t.settings.howWeEarn}");
    expect(explanation).toContain("{t.result.affiliateExplanation}");
    // Zone tactile : 32 points de haut et 12 de marge, soit 44.
    expect(mention).toContain("hitSlop={{ top: 2, bottom: 10, left: 10, right: 10 }}");
    expect(mention).toContain("toggle: { minHeight: 32,");
  });

  it("aucun autre fichier n'écrit la mention à l'écran", () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((file) => file.endsWith(".tsx") && !file.endsWith("affiliate-mention.tsx"));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      expect(read(file), file).not.toMatch(/>\s*\{t\.result\.affiliateDisclosure\}/);
    }
  });
});

describe("« Voir chez le marchand » (bouton commun) : la mention sous le bouton, plein ou compact", () => {
  it("le bouton affiche lui-même la mention, sans condition sur sa forme", () => {
    expect(button).toContain("<AffiliateMention isAffiliate={isAffiliate} explain={explain} centered={!compact} />");
    expect(button).toContain("explain = true,");
    expect(button).not.toContain("!compact && isAffiliate");
  });

  it("VoiceOver lit aussi la mention avec le lien", () => {
    expect(button).toContain("accessibilityLabel={isAffiliate ? `${label}, ${t.result.affiliateDisclosure}` : label}");
  });
});

// Chaque endroit où un lien vers une boutique est montré ou ouvert.
// `flag` : ce que l'écran confie à la mention, pour un lien donné — la règle
// de l'app quand il a les deux liens, sinon `isAffiliate` du serveur (même
// règle, testée dans apps/backend/tests/affiliateLinkRule.test.ts).
type Links = { affiliateUrl: string | null; merchantUrl: string | null };
const appRule = (links: Links) => isAffiliateLink(links);
const serverFlag = (links: Links) => links.affiliateUrl !== null && links.affiliateUrl !== links.merchantUrl;

interface Surface {
  name: string;
  file: string;
  /** Ce que le fichier doit contenir : le lien confié à la règle, puis à la mention. */
  wiring: string[];
  flag: (links: Links) => boolean;
  options: { explain?: boolean; inline?: boolean };
  form: AffiliateMentionForm;
}

const viaButton = { explain: true };
const surfaces: Surface[] = [
  {
    name: "Résultat — la grande carte",
    file: "app/(app)/spot/result.tsx",
    wiring: ["<AffiliateMention isAffiliate={isAffiliateLink(piece)} explain centered />"],
    flag: appRule,
    options: { explain: true },
    form: "explain",
  },
  {
    name: "Résultat — la carte ou la ligne d'une proposition",
    file: "components/proposal-card.tsx",
    wiring: ["const isAffiliate = isAffiliateLink(piece);", "<AffiliateMention isAffiliate={isAffiliate} />", "isAffiliate ? t.result.affiliateDisclosure : null"],
    flag: appRule,
    options: {},
    form: "plain",
  },
  {
    name: "Envies — la vignette de la grille",
    file: "components/wishlist-panel.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={isAffiliateLink(item)}", "explain={false}"],
    flag: appRule,
    options: { explain: false },
    form: "plain",
  },
  {
    name: "Envie — la fiche",
    file: "app/(app)/envie.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={isAffiliateLink(item)}"],
    flag: appRule,
    options: viaButton,
    form: "explain",
  },
  {
    name: "Vault — la fiche d'une pièce",
    file: "app/(app)/vault-item/[id].tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={isAffiliateLink(item)}"],
    flag: appRule,
    options: viaButton,
    form: "explain",
  },
  {
    name: "Publication — l'envie publiée",
    file: "components/post-card.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={post.wish.isAffiliate}"],
    flag: serverFlag,
    options: viaButton,
    form: "explain",
  },
  {
    name: "Publication — une pièce taguée",
    file: "components/post-card.tsx",
    wiring: ["<AffiliateMention isAffiliate={piece.isAffiliate} inline />", "piece.isAffiliate ? t.result.affiliateDisclosure : null,"],
    flag: serverFlag,
    options: { inline: true },
    form: "inline",
  },
  {
    name: "Collection d'un ami — une envie",
    file: "app/(app)/collection-ami.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={item.isAffiliate}"],
    flag: serverFlag,
    options: viaButton,
    form: "explain",
  },
  {
    name: "Messages — l'envie jointe",
    file: "components/message-wish-card.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={card.isAffiliate}"],
    flag: serverFlag,
    options: viaButton,
    form: "explain",
  },
  {
    name: "Pièces reçues — une pièce",
    file: "components/received-pieces.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={piece.isAffiliate}"],
    flag: serverFlag,
    options: viaButton,
    form: "explain",
  },
  {
    // Mission « liens vidéo » : « isAffiliate » calculé par le serveur pour chaque pièce de la mémoire collective.
    name: "Vidéo partagée — pièce déjà repérée",
    file: "components/video-products.tsx",
    wiring: ["<MerchantLinkButton", "isAffiliate={product.isAffiliate}"],
    flag: serverFlag,
    options: viaButton,
    form: "explain",
  },
];

describe.each(surfaces)("$name", ({ file, wiring, flag, options, form }) => {
  it("lien affilié (différent du lien du marchand) : la mention est visible", () => {
    const source = read(file);
    for (const line of wiring) expect(source).toContain(line);
    expect(affiliateMentionForm(flag(affiliated), options)).toBe(form);
  });

  it("lien du marchand tel quel, ou aucun lien affilié : rien", () => {
    expect(affiliateMentionForm(flag(direct), options)).toBe("none");
    expect(affiliateMentionForm(flag(none), options)).toBe("none");
  });
});

describe("aucun endroit oublié", () => {
  it("tout fichier qui ouvre une boutique figure dans la liste ci-dessus (ou est le bouton commun)", () => {
    const openers = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => /openMerchantLink\(|<MerchantLinkButton/.test(read(file)))
      .map((file) => file.split("\\").join("/"))
      .sort();
    const known = [...new Set([...surfaces.map((surface) => surface.file), "components/merchant-link-button.tsx"])].sort();
    expect(openers).toEqual(known);
  });

  it("les fichiers qui ouvrent une boutique sans passer par le bouton commun affichent la mention eux-mêmes", () => {
    for (const file of ["app/(app)/spot/result.tsx", "components/proposal-card.tsx", "components/post-card.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("openMerchantLink(");
      expect(source, file).toContain("<AffiliateMention isAffiliate={");
    }
  });
});

describe("liens partagés : la mention voyage avec le lien", () => {
  it("proposition partagée depuis le Résultat : la règle, puis le texte (français et anglais)", () => {
    expect(read("app/(app)/spot/result.tsx")).toContain("t.result.shareMessage(piece.name, url, isAffiliateLink(piece))");
    expect(fr.result.shareMessage("Veste", affiliated.affiliateUrl, isAffiliateLink(affiliated))).toBe("Veste\nhttps://reseau.example/clic?id=1 (lien affilié)\n\nRepérée avec Spotto.");
    expect(en.result.shareMessage("Jacket", affiliated.affiliateUrl, isAffiliateLink(affiliated))).toBe("Jacket\nhttps://reseau.example/clic?id=1 (affiliate link)\n\nSpotted with Spotto.");
    for (const links of [direct, none]) {
      expect(fr.result.shareMessage("Veste", links.merchantUrl, isAffiliateLink(links))).toBe("Veste\nhttps://marchand.example/p\n\nRepérée avec Spotto.");
      expect(en.result.shareMessage("Jacket", links.merchantUrl, isAffiliateLink(links))).toBe("Jacket\nhttps://marchand.example/p\n\nSpotted with Spotto.");
    }
  });

  it("envie partagée hors de Spotto : la règle aussi (texte testé dans share-wish.test.ts)", () => {
    const share = read("lib/share-wish.ts");
    expect(share).toContain("return isAffiliateLink(item);");
    expect(share).toContain("wishShareIsAffiliate(item) ? ` ${t.wishlistItem.affiliateMention}` : \"\"");
    expect(read("app/(app)/envie.tsx")).toContain("await shareWishOutside(item);");
  });
});

describe("textes de la mention, en français et en anglais", () => {
  it("la mention, son explication, son titre et son aide existent dans les deux langues", () => {
    expect(fr.result.affiliateDisclosure).toBe("Lien affilié");
    expect(en.result.affiliateDisclosure).toBe("Affiliate link");
    expect(fr.settings.howWeEarn).toBe("Comment Spotto se rémunère");
    expect(en.settings.howWeEarn).toBe("How Spotto earns money");
    for (const catalogue of [fr, en]) {
      expect(catalogue.result.affiliateExplanation.length).toBeGreaterThan(40);
      expect(catalogue.result.affiliateHint.length).toBeGreaterThan(10);
      expect(catalogue.wishlistItem.affiliateMention.length).toBeGreaterThan(5);
    }
  });

  it("« Comment Spotto se rémunère » n'est plus un texte orphelin : il titre l'explication", () => {
    expect(mention).toContain("{t.settings.howWeEarn}");
  });
});
