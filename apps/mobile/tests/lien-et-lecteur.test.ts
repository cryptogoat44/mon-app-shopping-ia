import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeProps } from "../src/lib/analytics-events";
import { afterPlayerFailure } from "../src/lib/player-decision";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";

// Retours du build 2 (24 novembre 2026, essais du fondateur sur son iPhone) :
// - « le lecteur intégré ne fonctionne pas » : sur l'app iPhone, la vidéo
//   d'abord (accord, puis lecteur), « Trouver la pièce automatiquement » en
//   bouton sous « Spotter ce moment », la recherche automatique si le lecteur
//   échoue ou est refusé ; un lecteur qui attend un toucher n'est plus
//   remplacé au bout de 12 s ;
// - point 6 : le champ du lien toujours visible, « Coller » ouvre la vidéo ;
// - point 11 : la carte « Votre dernière vidéo » repliée (retours du build 3,
//   point 3 : la croix est remplacée par « réduire », la carte se replie en une
//   ligne fine au lieu de disparaître).
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
/** Code sans ses commentaires de ligne. */
const code = (path: string) => source(path).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("écran « vidéo partagée » : la vidéo d'abord sur iPhone", () => {
  const screen = code("app/(app)/spot/lecteur.tsx");

  it("le minuteur de 12 s s'arrête dès que le lecteur a répondu (même s'il attend un toucher) ; « Spotter ce moment » attend toujours la lecture", () => {
    expect(screen).toContain('if (alive.current && !answered.current) fallback("no_answer");');
    expect(screen).not.toContain('if (alive.current && !readyRef.current) fallback("no_answer");');
    expect(screen).toContain("if (isPlayerAnswer(hostMessage)) answered.current = true;");
    // Retours du build 3 : la même règle, nommée (spotDisabled).
    expect(screen).toContain("const spotDisabled = !ready || busy !== null;");
    expect(screen).toContain("disabled={spotDisabled}");
    // Remis à zéro avec un nouveau lecteur et au redémarrage de la vue web.
    expect(screen.match(/answered\.current = false;/g)).toHaveLength(2);
  });

  it("sous « Spotter ce moment », un vrai bouton « Trouver la pièce automatiquement » (analyse allumée), puis la phrase de confidentialité", () => {
    const player = screen.slice(screen.indexOf("<EmbeddedPlayer"));
    const spot = player.indexOf("onPress={() => void spotMoment()}");
    const auto = player.indexOf("onPress={playerToAuto}");
    // Retours du build 3 : la phrase de confidentialité d'avant, ou celle de l'image du moment par le serveur.
    const privacy = player.indexOf("t.player.privacy(name)}");
    expect(spot).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(spot);
    expect(privacy).toBeGreaterThan(auto);
    expect(player.slice(spot, privacy)).toContain("analysisEnabled ? (");
    expect(player.slice(spot, privacy)).toContain("style={styles.secondary}");
    // Le lien discret d'avant n'est plus sous le lecteur (le même geste deux fois).
    expect(player.slice(0, player.indexOf("</View>\n    );"))).not.toContain("{autoLink}");
    expect(screen).toContain('track("player_to_ai", { platform, from: "player", link_platform: platform });');
  });

  it("accord : analyse allumée, « Non merci, chercher automatiquement » (vers l'analyse) ; coupée, « Non merci » (écran de secours)", () => {
    const consent = screen.slice(screen.indexOf('stage.kind === "consent"'), screen.indexOf('stage.kind === "fallback"'));
    expect(consent).toContain('{afterPlayerFailure({ os: Platform.OS, analysis: analysisEnabled, aiFailed: auto.phase.kind === "failed" }) === "ai" ? t.player.gate.refuseAuto : t.player.gate.refuse}');
    expect(consent).not.toContain("{autoLink}");
    expect(screen).toContain('if (reason !== "consent_refused") setPlayerBroken(reason);');
  });

  it("refusé : « Non merci, chercher automatiquement » après un échec de l'analyse (le refus mène à l'écran de secours) ; permis : ce libellé quand l'analyse n'a pas échoué", () => {
    const consent = screen.slice(screen.indexOf('stage.kind === "consent"'), screen.indexOf('stage.kind === "fallback"'));
    // Le libellé ne se choisit plus sur la seule analyse allumée.
    expect(consent).not.toContain("{analysisEnabled ? t.player.gate.refuseAuto");
    // Même règle que fallback() : refus → écran de secours quand l'analyse a déjà échoué.
    expect(afterPlayerFailure({ os: "ios", analysis: true, aiFailed: true })).toBe("screenshot");
    expect(afterPlayerFailure({ os: "ios", analysis: true, aiFailed: false })).toBe("ai");
  });

  it("l'écran de l'analyse dit pourquoi il prend le relais, et ne repropose pas le lecteur qui vient d'échouer", () => {
    // Retours du build 3 : l'instantané flou (snapshot_blurry) dit la même phrase que l'instantané en échec.
    expect(screen).toContain('playerBroken === "snapshot_failed" || playerBroken === "snapshot_blurry" ? t.videoLinkAuto.playerLead.snapshot : t.videoLinkAuto.playerLead.notHere');
    expect(screen).toContain("const playerButton = withPlayer && playerStaysOffered(playerBroken) ? (");
    expect(screen).toContain("AccessibilityInfo.announceForAccessibility(playerBroken === \"snapshot_failed\" || playerBroken === \"snapshot_blurry\"");
    // Instantané flou sans l'analyse : l'écran de secours propose aussi de revenir au lecteur (un autre moment).
    const fallbackStage = screen.slice(screen.indexOf('} else if (stage.kind === "fallback") {'), screen.indexOf('} else if (stage.kind === "web") {'));
    expect(fallbackStage).toContain('{stage.reason === "snapshot_blurry" ? playerButton : null}');
    expect(fallbackStage).not.toContain("        {playerButton}");
  });

  it("refusé : lecteur en échec après un échec de l'analyse, ni l'ancien échec réaffiché ni « l'IA peut chercher » dit par VoiceOver ; permis : la phrase dite quand la question s'affiche", () => {
    const fallbackFn = screen.slice(screen.indexOf("function fallback(reason: FallbackReason)"), screen.indexOf("async function startPlayer("));
    expect(fallbackFn).toContain('aiFailed: phaseRef.current === "failed"');
    expect(fallbackFn).toContain('setStage({ kind: "fallback", reason });');
    expect(screen).toContain("phaseRef.current = auto.phase.kind;");
    expect(screen).toContain('const playerLeadShown = playerBroken !== null && stage.kind === "auto" && auto.phase.kind === "ask";');
    expect(screen).toContain("if (playerLeadShown && playerBroken) AccessibilityInfo.announceForAccessibility(");
    expect(screen).not.toContain("if (playerBroken) AccessibilityInfo.announceForAccessibility(");
  });
});

describe("champ du lien toujours visible sur l'accueil (point 6)", () => {
  const home = code("app/(app)/(tabs)/index.tsx");
  const entry = code("components/link-entry.tsx");

  it("plus de question à déplier ; ordre : messages, champ du lien, tuiles, dernière vidéo, « Récemment spottées »", () => {
    expect(home).not.toContain("linkQuestion");
    expect(home).not.toContain("function LinkHelp");
    const order = ["<ScreenshotHelp", "<LinkEntry onHelp={entries.showLinkHelp} />", "<EntryTiles", "<LatestVideoCard", "<LatestVideoQuestion", "<HistoryHeader history={history} />"].map((part) => home.indexOf(part));
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fr.player).not.toHaveProperty("linkQuestion");
    expect(en.spotter).not.toHaveProperty("linkQuestion");
  });

  it("refusé : champ vide, ni pastille ni « Ouvrir la vidéo » ; permis : champ rempli, les deux", () => {
    expect(entry).toContain("{link.length > 0 ? <DetectionCard detection={detection} /> : null}");
    expect(entry).toMatch(/\{link\.length > 0 \? \(\s*<Pressable\s+style=\{\[styles\.primary/);
  });

  it("« Coller » sur un lien de vidéo TikTok ou Instagram l'ouvre tout de suite ; un autre lien remplit seulement le champ ; le presse-papiers n'est lu qu'au toucher", () => {
    expect(entry).toContain('if (linkStep(pasted).kind === "video") await openPasted(pasted);');
    expect(entry).toContain('const outcome = await openLink(text, "paste");');
    expect(entry.match(/Clipboard\.getStringAsync\(\)/g)).toHaveLength(1);
    expect(entry).not.toMatch(/useEffect|useFocusEffect|addListener/);
    // Un lien tapé garde le bouton et la touche « Aller ».
    expect(entry).toContain("onSubmitEditing={handleContinue}");
  });

  it("refusé : un second toucher pendant la lecture du presse-papiers (une seule vidéo ouverte) ; permis : un nouveau toucher une fois le premier fini", () => {
    const paste = entry.slice(entry.indexOf("async function handlePaste()"), entry.indexOf("function handleClear()"));
    const guard = paste.indexOf("if (opening.current || busy) return;\n    opening.current = true;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(paste.indexOf("Clipboard.getStringAsync()"));
    expect(paste).toMatch(/\} finally \{\s*opening\.current = false;\s*\}\s*\}/);
    const go = entry.slice(entry.indexOf("async function handleContinue()"), entry.indexOf("return (", entry.indexOf("async function handleContinue()")));
    expect(go).toContain('if (detection.kind !== "supported" || opening.current || busy) return;');
    expect(go).toMatch(/\} finally \{\s*opening\.current = false;\s*\}/);
  });

  it("aucune promesse du lecteur sur l'app avant de savoir s'il s'ouvre : plus de ligne d'aide, sauf la consigne du site", () => {
    expect(entry).toContain('{Platform.OS === "web" ? <Text style={styles.hint}>{t.player.linkHintWeb}</Text> : null}');
    expect(fr.player).not.toHaveProperty("linkHint");
    expect(en.player).not.toHaveProperty("linkHint");
  });
});

describe("textes vrais que le lecteur s'ouvre, que l'IA prenne le relais ou que l'écran de secours s'affiche", () => {
  it("refusé : « vous la mettrez en pause » comme seule issue ; permis : une phrase vraie dans tous les cas", () => {
    for (const catalog of [fr, en]) {
      expect(catalog.player.linkNotice.body).not.toMatch(/mettrez en pause|you'll pause it/);
      expect(catalog.player.howItWorksSteps("x")[1]).toMatch(/autre moyen|another way/);
    }
    expect(fr.player.linkNotice.title).toBe("Ce lien peut s'ouvrir dans Spotto");
    expect(en.player.linkNotice.title).toBe("This link can open in Spotto");
  });

  it("bandeau du site : l'anglais dit la même chose que le français (« dans la vidéo »)", () => {
    // Permis : la vidéo nommée dans les deux langues, « la » / “it” renvoient à elle.
    expect(fr.player.linkNotice.bodyWeb).toContain("déjà repérées dans la vidéo");
    expect(en.player.linkNotice.bodyWeb).toContain("already spotted in the video");
    // Refusé : sous le titre « This link… », “how to spot it” sans la vidéo renverrait au lien.
    expect(en.player.linkNotice.bodyWeb).not.toMatch(/already spotted, and how to spot it/);
  });

  it("les nouveaux textes existent en français (« vous ») et en anglais", () => {
    expect(fr.player.gate.refuseAuto).toBe("Non merci, chercher automatiquement");
    expect(en.player.gate.refuseAuto).toBe("No thanks, search automatically");
    expect(fr.videoLinkAuto.playerLead.notHere).toBe("La vidéo n'a pas pu être lue ici : l'IA peut chercher la pièce pour vous.");
    expect(fr.videoLinkAuto.playerLead.snapshot).toContain("n'a pas pu prendre l'image de ce moment");
    expect(en.videoLinkAuto.playerLead.snapshot).toContain("couldn't take the frame of this moment");
    expect(en.spotter.latestVideoExpand).toBe("Search this video");
  });
});

describe("carte « Votre dernière vidéo » : réduire au lieu de supprimer (retours du build 3, point 3)", () => {
  const card = code("components/spot-entry.tsx");
  const home = code("app/(app)/(tabs)/index.tsx");
  const cardFn = card.slice(card.indexOf("export function LatestVideoCard("), card.indexOf("export function LatestVideoQuestion("));
  const hook = home.slice(home.indexOf("function useLatestVideo()"), home.indexOf("function useSpotterEntries("));

  it("la carte entière : vignette, « Votre dernière vidéo · 0:27 », toucher la ligne déplie les mots et « Rechercher »", () => {
    expect(card).toContain("const title = duration ? `${t.spotter.latestVideo} · ${duration}` : t.spotter.latestVideo;");
    expect(card).toContain("accessibilityState={{ expanded: open, disabled: !canExpand }}");
    expect(card).toMatch(/\{open \? \(\s*<>\s*<QueryInput/);
  });

  it("refusé : la croix, sa note et son lien vers Réglages ; permis : un bouton « réduire » de 44 pt, nommé pour VoiceOver, à la même place", () => {
    for (const gone of ["latestVideoDismiss", "LatestVideoDismissedNote", "×", "onDismiss", "dismissFailed", "latestVideoSettingsLink"]) {
      expect(card, gone).not.toContain(gone);
      expect(home, gone).not.toContain(gone);
    }
    expect(card).toContain('reduce: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }');
    expect(cardFn).toContain('<Pressable onPress={onReduce} style={styles.reduce} accessibilityRole="button" accessibilityLabel={t.spotter.latestVideoReduce}>');
    expect(cardFn).toContain('<ChevronIcon direction="up" size={18} tint={color.acier} />');
  });

  it("repliée : une ligne fine de 44 pt, toute touchable, qui rouvre la carte ; petite vignette, titre sur une ligne, « Rouvrir » souligné", () => {
    const slim = cardFn.slice(cardFn.indexOf("if (reduced) {"), cardFn.indexOf("return (\n    <View style={styles.card}>"));
    expect(slim).toContain("onPress={onReveal}");
    expect(slim).toContain('accessibilityRole="button"');
    // Le mot visible « Rouvrir » est dans le nom (WCAG 2.5.3) ; le titre seul est refusé.
    expect(slim).toContain("accessibilityLabel={`${title}, ${t.spotter.latestVideoShow}`}");
    expect(slim).not.toContain("accessibilityLabel={title}");
    expect(slim).toContain("accessibilityHint={t.spotter.latestVideoReveal}");
    expect(slim).toContain("accessibilityState={{ expanded: false }}");
    expect(slim).toContain("numberOfLines={1}");
    expect(slim).toContain("{t.spotter.latestVideoShow}");
    // Un seul geste dans la ligne : « Rouvrir » n'est pas un second bouton.
    expect(slim.match(/<Pressable/g)).toHaveLength(1);
    expect(card).toMatch(/slim: \{[^}]*minHeight: 44,/);
    expect(card).toMatch(/slim: \{[^}]*borderColor: color\.filet,/);
    expect(card).toContain("slimThumb: { width: 32, height: 32, borderRadius: radius.pieceThumb,");
    expect(card).toContain('slimLabel: { flex: 1, fontSize: font.secondary, color: color.encre, fontVariant: ["tabular-nums"] }');
    expect(card).toContain("slimLink: { ...lienSouligne,");
  });

  it("refusé : réduire éteint la proposition (« no ») ; permis : la seule écriture de « no » est la réponse à la question, et Réglages", () => {
    expect(home).not.toContain('saveLatestVideoChoice(userId, "no")');
    expect(home.match(/saveLatestVideoChoice\(/g)).toHaveLength(1);
    expect(hook).toContain("await saveLatestVideoChoice(userId, choice);");
    const setter = hook.slice(hook.indexOf("function setCardReduced("), hook.indexOf("const note ="));
    expect(setter).toContain("void saveLatestVideoReduced(userId, next).catch(() => {});");
    expect(setter).not.toContain("saveLatestVideoChoice");
    expect(setter).toContain("setExpanded(false);");
    expect(hook).toContain("reduce: () => setCardReduced(true),");
    expect(hook).toContain("reveal: () => setCardReduced(false),");
  });

  it("la forme retenue est lue AVEC l'état, avant d'afficher (jamais grande puis petite) ; un geste pendant la relecture l'emporte", () => {
    const load = hook.slice(hook.indexOf("const load = useCallback("), hook.indexOf("const refresh = useCallback("));
    expect(load).toContain("await Promise.all([loadLatestVideo(userId), userId ? loadLatestVideoReduced(userId).catch(() => false) : Promise.resolve(false)])");
    expect(load.indexOf("setReduced(isReduced)")).toBeLessThan(load.indexOf("setState(next)"));
    expect(load).toContain("if (touches === reducedTouches.current) setReduced(isReduced);");
    // Retour sur Spotter : la carte repliée (champ des mots fermé), sa forme gardée.
    const refresh = hook.slice(hook.indexOf("const refresh = useCallback"), hook.indexOf("async function choose("));
    expect(refresh).toContain("setExpanded(false);");
    expect(refresh).not.toContain("setReduced");
    expect(home).toContain("reduced={latestVideo.reduced}");
    expect(home).toContain("onReduce={latestVideo.reduce}");
    expect(home).toContain("onReveal={latestVideo.reveal}");
  });

  it("textes : les trois nouveaux en français et en anglais ; les textes de la croix retirés ; mêmes clés dans les deux langues", () => {
    for (const lang of [fr, en]) {
      for (const gone of ["latestVideoDismiss", "latestVideoDismissed", "latestVideoSettingsLink"]) expect(lang.spotter).not.toHaveProperty(gone);
    }
    expect(fr.spotter.latestVideoReduce).toBe("Réduire la carte « Votre dernière vidéo »");
    expect(en.spotter.latestVideoReduce).toBe("Collapse the “Your latest video” card");
    expect(fr.spotter.latestVideoReveal).toBe("Affiche la carte en entier");
    expect(en.spotter.latestVideoReveal).toBe("Shows the full card");
    expect(fr.spotter.latestVideoShow).toBe("Rouvrir");
    expect(en.spotter.latestVideoShow).toBe("Show");
    expect(Object.keys(fr.spotter).sort()).toEqual(Object.keys(en.spotter).sort());
    // Inchangé : la question dit toujours où changer d'avis.
    expect(fr.spotter.latestVideoAskNote).toContain("Modifiable à tout moment dans Réglages");
  });
});

describe("statistiques : ajouts seulement, listes fermées", () => {
  it("player_unavailable.next : « ai » ou « screenshot » gardés, une autre valeur jetée", () => {
    expect(sanitizeProps("player_unavailable", { platform: "tiktok", reason: "no_answer", next: "ai", link_platform: "tiktok" })).toMatchObject({ next: "ai" });
    expect(sanitizeProps("player_unavailable", { platform: "tiktok", reason: "no_answer", next: "screenshot", link_platform: "tiktok" })).toMatchObject({ next: "screenshot" });
    expect(sanitizeProps("player_unavailable", { next: "libre" })).not.toHaveProperty("next");
  });

  it("player_to_ai : from « player » gardé, autre valeur ou texte libre jetés", () => {
    expect(sanitizeProps("player_to_ai", { platform: "instagram", from: "player", link_platform: "instagram" })).toMatchObject({ from: "player", link_platform: "instagram" });
    expect(sanitizeProps("player_to_ai", { from: "x", url: "https://www.tiktok.com/@a/video/1" })).toEqual({});
  });
});
