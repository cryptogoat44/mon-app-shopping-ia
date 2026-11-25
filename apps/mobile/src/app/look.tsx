import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Head from "expo-router/head";
import type { LookOffer, PublicLook } from "@monapp/shared-types";
import { getActiveLocale, t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { CONTACT_EMAIL } from "@/lib/contact";
import { formatLongDate } from "@/lib/format";
import {
  lookDateNote,
  lookPriceText,
  lookReportMailto,
  lookShopLinkLabel,
  lookStockText,
  lookTokenFrom,
  lookVerdictSentence,
  markSignupFromLook,
} from "@/lib/look-page";
import { fetchPublicLook, wakeServer } from "@/lib/look-public";
import { WAKING_NOTICE_AFTER_MS } from "@/lib/root-route";
import { SpotImage } from "@/components/spot-image";
import { AffiliateMention } from "@/components/affiliate-mention";
import { OfferMarkNote } from "@/components/offer-mark";
import { PUBLIC_WEB_URL } from "@/constants/brand";
import { ConnectingNotice } from "@/components/connecting";
import { color, font, radius, serifFont, serifLineHeight, size, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { themedStyles } from "@/theme/themed-styles";

// La page look (lot « page look », migration 0057, décisions du fondateur du
// 23 novembre 2026) : ce qu'un visiteur SANS compte voit d'un lien partagé.
// Hors des groupes protégés (layout racine), adresse /look?l=<jeton> : un
// paramètre, retiré des rapports d'erreur (lib/sentry-scrub.ts). Un seul
// appel à l'affichage, la route publique du serveur (lib/look-public.ts),
// sans session ; tant que le serveur dort, l'attente habituelle
// (« Spotto se réveille… »). Jamais le nom ni la photo du membre ; rien n'est
// compté ni écrit sur l'appareil du visiteur ; page non proposée aux moteurs
// de recherche. Les liens des boutiques s'ouvrent dans un nouvel onglet (site)
// ou le navigateur (iPhone), sans enregistrer de clic.

type ScreenState = { kind: "loading" } | { kind: "found"; look: PublicLook } | { kind: "gone" } | { kind: "error" };

/** Titre d'onglet et « noindex » : site seulement (expo-router/head, comme components/web-title.tsx). */
function LookHead() {
  if (Platform.OS !== "web") return null;
  return (
    <Head>
      <title>{t.look.pageTitle}</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
    </Head>
  );
}

/** Lien d'une boutique : nouvel onglet sur le site, navigateur sur iPhone ; aucun clic enregistré. */
function openShop(url: string): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  Linking.openURL(url).catch(() => undefined);
}

function announce(message: string): void {
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

export default function LookScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { l } = useLocalSearchParams<{ l?: string | string[] }>();
  const token = lookTokenFrom(l);
  const [state, setState] = useState<ScreenState>(() => (token ? { kind: "loading" } : { kind: "gone" }));
  const [waking, setWaking] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Jeton mal formé : introuvable, sans rien demander au serveur.
    if (!token) {
      setState({ kind: "gone" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    setWaking(false);
    const timer = setTimeout(() => setWaking(true), WAKING_NOTICE_AFTER_MS);
    fetchPublicLook(token, controller.signal).then((result) => {
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      setState(result.kind === "found" ? { kind: "found", look: result.look } : result);
    });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, attempt]);

  useEffect(() => {
    if (state.kind === "found") announce(state.look.piece.name);
    else if (state.kind === "gone") announce(t.look.goneTitle);
    else if (state.kind === "error") announce(t.look.loadError);
  }, [state]);

  // « Trouver la mienne » : un seul appel à /health, au toucher, pour réveiller le serveur pendant l'inscription.
  const findMine = useCallback(() => {
    wakeServer();
    if (session) {
      router.replace("/");
      return;
    }
    markSignupFromLook();
    router.push("/sign-up");
  }, [router, session]);

  const discover = useCallback(() => router.replace("/"), [router]);

  return (
    <SafeAreaView style={styles.screen}>
      <LookHead />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>{t.look.pageTitle}</Text>
        {state.kind === "loading" ? (
          <View accessibilityLiveRegion="polite" style={styles.block}>
            {waking ? <ConnectingNotice state="waking" /> : <Text style={styles.body}>{t.look.loading}</Text>}
          </View>
        ) : null}
        {state.kind === "gone" ? (
          <View accessibilityLiveRegion="polite" style={styles.block}>
            <Text style={styles.title} accessibilityRole="header">
              {t.look.goneTitle}
            </Text>
            <Text style={styles.body}>{t.look.goneBody}</Text>
            <Pressable style={styles.primary} onPress={discover} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.look.discover}</Text>
            </Pressable>
          </View>
        ) : null}
        {state.kind === "error" ? (
          <View accessibilityLiveRegion="polite" style={styles.block}>
            <Text style={styles.title} accessibilityRole="header">
              {t.look.loadError}
            </Text>
            <Pressable style={styles.primary} onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t.result.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {state.kind === "found" ? <LookContentView look={state.look} onFindMine={findMine} /> : null}
        <LookFooter look={state.kind === "found" ? state.look : null} token={token} onDocument={(path) => router.push(path)} />
      </ScrollView>
    </SafeAreaView>
  );
}

function LookContentView({ look, onFindMine }: { look: PublicLook; onFindMine: () => void }) {
  const locale = getActiveLocale();
  const [shared, ...others] = look.offers;
  if (!shared) return null;
  const verdict = look.verdict ? lookVerdictSentence(look.verdict, look.searchedOn, t, locale) : null;
  return (
    <View accessibilityLiveRegion="polite">
      {verdict ? <Text style={[styles.verdict, look.verdict?.level === "identified" ? styles.affirmed : null]}>{verdict}</Text> : null}
      <View style={styles.card}>
        {look.piece.image ? (
          <View style={styles.hero}>
            <SpotImage fallbackUri={look.piece.image} style={styles.fill} accessibilityLabel={look.piece.name} />
          </View>
        ) : null}
        <Text style={styles.title} accessibilityRole="header">
          {look.piece.name}
        </Text>
        {look.piece.brand ? <Text style={styles.brand}>{look.piece.brand}</Text> : null}
        <OfferLines offer={shared} searchedOn={look.searchedOn} />
        <Pressable
          style={styles.primary}
          onPress={() => openShop(shared.url)}
          accessibilityRole="link"
          accessibilityLabel={lookShopLinkLabel(shared, look.searchedOn, t.look, locale)}
        >
          <Text style={styles.primaryLabel}>{t.result.viewAt(shared.shop)}</Text>
        </Pressable>
        <AffiliateMention isAffiliate={shared.affiliate} explain centered />
      </View>

      {others.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t.result.complementTitleAi}
          </Text>
          {others.map((offer, index) => (
            <View key={`${offer.url}-${index}`} style={styles.row}>
              <Pressable onPress={() => openShop(offer.url)} accessibilityRole="link" accessibilityLabel={lookShopLinkLabel(offer, look.searchedOn, t.look, locale)} hitSlop={6}>
                <Text style={styles.link}>{t.result.viewAt(offer.shop)}</Text>
              </Pressable>
              <OfferLines offer={offer} searchedOn={look.searchedOn} />
              <AffiliateMention isAffiliate={offer.affiliate} />
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.note}>{lookDateNote(look.searchedOn, t.look, locale)}</Text>

      <View style={styles.block}>
        <Pressable style={styles.primary} onPress={onFindMine} accessibilityRole="button" accessibilityHint={t.look.findMineHint}>
          <Text style={styles.primaryLabel}>{t.look.findMine}</Text>
        </Pressable>
        <Text style={styles.body}>{t.look.findMineExplain}</Text>
      </View>
    </View>
  );
}

/** Boutique, prix daté, mention, stock daté : jamais un prix sans sa date. */
function OfferLines({ offer, searchedOn }: { offer: LookOffer; searchedOn: string }) {
  const locale = getActiveLocale();
  const stock = lookStockText(offer, searchedOn, t.look, locale);
  return (
    <View style={styles.lines}>
      <Text style={styles.body}>
        {offer.shop} · {lookPriceText(offer, searchedOn, t.look, t.result.priceOnSite, locale)}
      </Text>
      {/* La mention, touchable comme sur le résultat (même feuille d'explication). */}
      {offer.mark ? <OfferMarkNote piece={{ offerMark: offer.mark }} /> : null}
      {stock ? <Text style={styles.small}>{stock}</Text> : null}
    </View>
  );
}

function LookFooter({ look, token, onDocument }: { look: PublicLook | null; token: string | null; onDocument: (path: "/conditions" | "/confidentialite" | "/aide") => void }) {
  const report = useCallback(() => {
    // Le lien de la page, reconstruit depuis le jeton (rien d'autre de l'adresse).
    const mailto = token ? lookReportMailto(CONTACT_EMAIL, `${PUBLIC_WEB_URL}/look?l=${token}`, t.look) : null;
    if (mailto) Linking.openURL(mailto).catch(() => onDocument("/aide"));
    else onDocument("/aide");
  }, [onDocument, token]);
  return (
    <View style={styles.footer}>
      {look ? <Text style={styles.small}>{t.look.footer(formatLongDate(look.expiresOn, getActiveLocale()))}</Text> : null}
      {look ? (
        <Pressable onPress={report} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.footerLink}>{t.look.report}</Text>
        </Pressable>
      ) : null}
      <View style={styles.footerRow}>
        <Pressable onPress={() => onDocument("/conditions")} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.footerLink}>{t.settings.terms}</Text>
        </Pressable>
        <Text style={styles.small}> · </Text>
        <Pressable onPress={() => onDocument("/confidentialite")} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.footerLink}>{t.settings.privacyPolicy}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Une colonne, aucune largeur fixe : tout passe à la ligne sur 320 points et en grand texte.
const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl, maxWidth: size.contentMaxWidth, alignSelf: "center", width: "100%" },
  kicker: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  block: { marginTop: space.lg },
  card: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, gap: space.xs },
  hero: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden", marginBottom: space.sm },
  fill: { width: "100%", height: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  brand: { fontSize: font.secondary, color: color.acier },
  verdict: { fontSize: font.secondary, color: color.encre, lineHeight: 21, marginBottom: space.md },
  affirmed: { fontWeight: "600" },
  lines: { gap: 2 },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  small: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  sectionTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, lineHeight: serifLineHeight.body, color: color.encre, marginBottom: space.sm },
  row: { borderTopWidth: 1, borderTopColor: color.filet, paddingVertical: space.sm, gap: 2 },
  link: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600", minHeight: 32 },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.lg },
  primary: { backgroundColor: color.encre, borderRadius: radius.sm, minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.sm },
  primaryLabel: { color: color.porcelaine, fontSize: font.body, fontWeight: "600", textAlign: "center" },
  footer: { marginTop: space.xl, gap: space.sm, borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.md },
  footerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  footerLink: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "600" },
}));
