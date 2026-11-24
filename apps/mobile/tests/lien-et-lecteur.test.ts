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
// - point 11 : la carte « Votre dernière vidéo » repliée, avec une croix.
const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
/** Code sans ses commentaires de ligne. */
const code = (path: string) => source(path).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("écran « vidéo partagée » : la vidéo d'abord sur iPhone", () => {
  const screen = code("app/(app)/spot/lecteur.tsx");

  it("le minuteur de 12 s s'arrête dès que le lecteur a répondu (même s'il attend un toucher) ; « Spotter ce moment » attend toujours la lecture", () => {
    expect(screen).toContain('if (alive.current && !answered.current) fallback("no_answer");');
    expect(screen).not.toContain('if (alive.current && !readyRef.current) fallback("no_answer");');
    expect(screen).toContain("if (isPlayerAnswer(hostMessage)) answered.current = true;");
    expect(screen).toContain("disabled={!ready || busy !== null}");
    // Remis à zéro avec un nouveau lecteur et au redémarrage de la vue web.
    expect(screen.match(/answered\.current = false;/g)).toHaveLength(2);
  });

  it("sous « Spotter ce moment », un vrai bouton « Trouver la pièce automatiquement » (analyse allumée), puis la phrase de confidentialité", () => {
    const player = screen.slice(screen.indexOf("<EmbeddedPlayer"));
    const spot = player.indexOf("onPress={() => void spotMoment()}");
    const auto = player.indexOf("onPress={playerToAuto}");
    const privacy = player.indexOf("{t.player.privacy(name)}");
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
    expect(screen).toContain('playerBroken === "snapshot_failed" ? t.videoLinkAuto.playerLead.snapshot : t.videoLinkAuto.playerLead.notHere');
    expect(screen).toContain("const playerButton = withPlayer && playerBroken === null ? (");
    expect(screen).toContain("AccessibilityInfo.announceForAccessibility(playerBroken === \"snapshot_failed\"");
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
    expect(fr.spotter.latestVideoDismissed).toContain("Vous pouvez réactiver");
    expect(fr.spotter.latestVideoDismissed).toContain("Réglages");
    expect(en.spotter.latestVideoDismissed).toContain("Settings");
    expect(fr.spotter.latestVideoDismiss).toBe("Ne plus proposer ma dernière vidéo");
    expect(en.spotter.latestVideoExpand).toBe("Search this video");
  });
});

describe("carte « Votre dernière vidéo » : repliée, et une croix pour en sortir (point 11)", () => {
  const card = code("components/spot-entry.tsx");
  const home = code("app/(app)/(tabs)/index.tsx");

  it("une ligne : vignette, « Votre dernière vidéo · 0:27 », croix de 44 pt nommée pour VoiceOver ; toucher la ligne déplie les mots et « Rechercher »", () => {
    expect(card).toContain("const title = duration ? `${t.spotter.latestVideo} · ${duration}` : t.spotter.latestVideo;");
    expect(card).toContain("accessibilityLabel={t.spotter.latestVideoDismiss}");
    expect(card).toContain('dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }');
    expect(card).toContain("accessibilityState={{ expanded: open, disabled: !canExpand }}");
    expect(card).toMatch(/\{open \? \(\s*<>\s*<QueryInput/);
  });

  it("la croix éteint la proposition exactement comme Réglages (« no »), puis une note pour cette visite avec un lien vers Réglages", () => {
    expect(home).toContain('await saveLatestVideoChoice(userId, "no");');
    expect(home).toContain('<LatestVideoDismissedNote onSettings={() => router.push("/settings")} />');
    expect(card).toContain("AccessibilityInfo.announceForAccessibility(t.spotter.latestVideoDismissed);");
    // Visite suivante : la note disparaît, la carte (si elle revient par Réglages) est repliée.
    const refresh = home.slice(home.indexOf("const refresh = useCallback"), home.indexOf("return load();", home.indexOf("const refresh = useCallback")));
    expect(refresh).toContain('setDismissal((current) => (current === "saving" ? current : "idle"));');
    expect(refresh).toContain("setExpanded(false);");
  });

  it("refusé : un échec de l'enregistrement ne fait pas disparaître la carte ; il est dit", () => {
    expect(home).toMatch(/catch \{\s*return setDismissal\("failed"\);\s*\}/);
    expect(card).toContain("{dismissFailed ? <ErrorMessage style={styles.notice}>{t.spotter.latestVideoChoiceFailed}</ErrorMessage> : null}");
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
